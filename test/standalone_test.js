import {
  assert,
  exercisePaletteFixtures,
  fromHex,
  globalValue,
  hex,
  standalone,
  writeCapability,
  writePolicy,
  writeSourceRecord,
} from "./test-helpers.js";

const byteFixtures = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/color-byte-fixtures.json", import.meta.url),
  ),
).cases;
const outputFixtures = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/color-output-fixtures.json", import.meta.url),
  ),
).cases;
const paletteFixtures = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/color-palette-fixtures.json", import.meta.url),
  ),
);

Deno.test("standalone uniform palettes and RGBA8 indexing consume reviewed fixtures", async () => {
  exercisePaletteFixtures(await standalone(), paletteFixtures, "standalone");
});

Deno.test("standalone packing and source operations consume reviewed byte fixtures", async () => {
  const runtime = await standalone();
  for (const entry of byteFixtures) {
    const bytes = fromHex(entry.input);
    const expected = fromHex(entry.expected);
    const input = runtime.copyIn(bytes);
    const output = runtime.alloc(expected.length || 1);
    let record = 0;
    try {
      let status;
      if (entry.op === "pack-half") {
        status = runtime.exports.color_pack_half(
          input,
          bytes.length / 4,
          output,
          expected.length,
        );
      } else if (entry.op === "unpack-half") {
        status = runtime.exports.color_unpack_half(
          input,
          bytes.length / 2,
          output,
          expected.length,
        );
      } else if (entry.op === "pack-signal") {
        status = runtime.exports.color_pack_signal(
          input,
          bytes.length / 4,
          entry.bits,
          entry.channels,
          output,
          expected.length,
        );
      } else if (entry.op === "pack-image") {
        status = runtime.exports.color_pack_image(
          input,
          bytes.length,
          output,
          expected.length,
        );
      } else if (entry.op === "expand-samples") {
        status = runtime.exports.color_expand_samples(
          input,
          bytes.length,
          entry.width,
          entry.height,
          entry.stride,
          entry.sample,
          entry.layout,
          output,
          expected.length,
        );
      } else {
        record = runtime.alloc(
          globalValue(runtime.exports, "color_source_size"),
        );
        writeSourceRecord(runtime, record, {
          ...entry.source,
          length: bytes.length,
        }, input);
        status = entry.op === "source-linear"
          ? runtime.exports.color_source_linear(
            record,
            entry.destinationPrimaries,
            output,
            expected.length,
          )
          : runtime.exports[
            entry.op === "source-working"
              ? "color_source_working"
              : "color_source_degraded"
          ](record, output, expected.length);
      }
      assert(status === 0, `${entry.id} succeeds`);
      assert(
        hex(runtime.copyOut(output, expected.length)) === entry.expected,
        `${entry.id} bytes`,
      );
    } finally {
      runtime.free(record);
      runtime.free(output);
      runtime.free(input);
    }
  }
});

Deno.test("output policy defaults and capability combinations are explicit", async () => {
  const runtime = await standalone();
  const policy = runtime.alloc(
    globalValue(runtime.exports, "color_policy_size"),
  );
  try {
    const view = new DataView(runtime.memory.buffer);
    for (let transfer = 0; transfer <= 6; transfer += 1) {
      assert(
        runtime.exports.color_policy_init(policy, transfer) === 0,
        `transfer ${transfer}`,
      );
      const hdr = transfer === 3 || transfer === 4;
      assert(
        view.getUint32(
          policy + globalValue(runtime.exports, "color_policy_range"),
          true,
        ) ===
          (hdr ? 1 : 0),
        `transfer ${transfer} range`,
      );
      assert(
        view.getUint32(
          policy + globalValue(runtime.exports, "color_policy_tone"),
          true,
        ) ===
          (hdr ? 1 : 0),
        `transfer ${transfer} tone`,
      );
      for (const name of ["source_peak", "target_peak", "reference_white"]) {
        assert(
          view.getFloat64(
            policy + globalValue(runtime.exports, `color_policy_${name}`),
            true,
          ) ===
            203,
          `${name} default`,
        );
      }
    }
    assert(
      runtime.exports.color_policy_init(policy, 7) === 1,
      "ICC is not an output transfer",
    );
    assert(
      runtime.exports.color_error_field() ===
        globalValue(runtime.exports, "color_policy_transfer"),
      "invalid default transfer field",
    );
  } finally {
    runtime.free(policy);
  }
});

Deno.test("capabilities use the high encoding word and report version fields", async () => {
  const runtime = await standalone();
  const policy = runtime.alloc(
    globalValue(runtime.exports, "color_policy_size"),
  );
  const capability = runtime.alloc(
    globalValue(runtime.exports, "color_capability_size"),
  );
  try {
    writePolicy(runtime, policy, {
      primaries: 4,
      transfer: 6,
      depth: 16,
      alpha: 1,
      tone: 0,
      range: 0,
      sourcePeak: 203,
      targetPeak: 203,
      white: 0,
      referenceWhite: 203,
      gamut: 0,
      masteringPresent: 0,
      sourceMin: 0,
    });
    writeCapability(runtime, capability, {
      depthMask: 8,
      encodingLow: 0,
      encodingHigh: 1 << 6,
      alpha: 1,
      flags: 0,
    });
    assert(
      runtime.exports.color_validate_policy(policy, capability) === 0,
      "high-word pair",
    );
    new DataView(runtime.memory.buffer).setUint32(
      capability + globalValue(runtime.exports, "color_capability_version"),
      1,
      true,
    );
    assert(
      runtime.exports.color_validate_policy(policy, capability) === 1,
      "version rejection",
    );
    assert(
      runtime.exports.color_error_field() ===
        globalValue(runtime.exports, "color_capability_version"),
      "capability version field",
    );
  } finally {
    runtime.free(capability);
    runtime.free(policy);
  }
});

Deno.test("bulk output fixtures cover direct, tone, gamut, non-finite, and capability paths", async () => {
  const runtime = await standalone();
  for (const entry of outputFixtures) {
    const policy = runtime.alloc(
      globalValue(runtime.exports, "color_policy_size"),
    );
    const capability = runtime.alloc(
      globalValue(runtime.exports, "color_capability_size"),
    );
    let input = 0;
    let output = 0;
    try {
      writePolicy(runtime, policy, entry.policy);
      writeCapability(runtime, capability, entry.capability);
      if (entry.op === "validate") {
        const status = runtime.exports.color_validate_policy(
          policy,
          capability,
        );
        if (entry.error) {
          assert(status === entry.error.code, `${entry.id} error code`);
          assert(
            runtime.exports.color_error_field() === entry.error.field,
            `${entry.id} error field`,
          );
        } else {
          assert(status === 0, `${entry.id} policy succeeds`);
        }
        continue;
      }
      const bytes = fromHex(entry.input);
      input = runtime.copyIn(bytes);
      output = runtime.alloc(bytes.length);
      const status = runtime.exports.color_transform_output(
        input,
        bytes.length,
        bytes.length / 16,
        1,
        bytes.length,
        entry.working,
        entry.sourceAlpha,
        policy,
        capability,
        output,
        bytes.length,
      );
      assert(status === 0, `${entry.id} succeeds`);
      assert(
        hex(runtime.copyOut(output, bytes.length)) === entry.expected,
        `${entry.id} bytes`,
      );
    } finally {
      runtime.free(output);
      runtime.free(input);
      runtime.free(capability);
      runtime.free(policy);
    }
  }
});

Deno.test("packing reports sizes, capacity, overlap, and enum fields", async () => {
  const runtime = await standalone();
  assert(runtime.exports.color_packing_size(2, 3, 4) === 24, "packing size");
  assert(runtime.exports.color_packing_size(0, 3, 4) === 0, "zero dimension");
  assert(
    runtime.exports.color_packing_size(0x7fffffff, 2, 4) === 0,
    "size ceiling",
  );
  const input = runtime.copyIn(fromHex("0000003f0000803f"));
  const output = runtime.alloc(8);
  try {
    assert(
      runtime.exports.color_pack_signal(input, 2, 9, 4, output, 8) === 1,
      "depth enum",
    );
    assert(runtime.exports.color_error_field() === 2, "depth argument field");
    assert(
      runtime.exports.color_pack_signal(input, 2, 8, 4, output, 1) === 8,
      "capacity",
    );
    assert(
      runtime.exports.color_error_field() === 1,
      "capacity destination field",
    );
    assert(
      runtime.exports.color_pack_image(input, 8, input, 8) === 2,
      "overlap",
    );
  } finally {
    runtime.free(output);
    runtime.free(input);
  }
});

Deno.test("allocator grows, enforces its ceiling, reuses releases, and rejects stale frees", async () => {
  const runtime = await standalone();
  const originalBytes = runtime.memory.buffer.byteLength;
  const first = runtime.alloc(131072);
  new Uint8Array(runtime.memory.buffer, first, 4).set([1, 2, 3, 4]);
  assert(runtime.memory.buffer.byteLength > originalBytes, "memory grew");
  assert(
    hex(runtime.copyOut(first, 4)) === "01020304",
    "growth retained allocation bytes",
  );
  assert(runtime.free(first) === 0, "release succeeds");
  const reused = runtime.alloc(64);
  assert(reused === first, "released block reused");
  assert(runtime.free(reused) === 0, "reused block released");
  assert(runtime.free(reused) === 7, "double free is stale");
  assert(runtime.exports.color_error_code() === 7, "stale error reported");
  assert(
    runtime.exports.color_set_memory_limit(runtime.memory.buffer.byteLength) ===
      0,
    "limit set to current memory",
  );
  assert(
    runtime.exports.color_alloc(runtime.memory.buffer.byteLength) === 0,
    "ceiling blocks growth",
  );
  assert(runtime.exports.color_error_code() === 4, "allocation error reported");
});
