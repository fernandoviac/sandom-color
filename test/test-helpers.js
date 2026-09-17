export function assert(condition, message) {
  if (!condition) throw new Error(message);
}

export function fromHex(value) {
  assert(value.length % 2 === 0, "hex input has an even length");
  return Uint8Array.from(
    value.match(/../g) ?? [],
    (pair) => Number.parseInt(pair, 16),
  );
}

export function hex(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

export function globalValue(exports, name) {
  const value = exports[name];
  assert(value instanceof WebAssembly.Global, `${name} is an ABI global`);
  return value.value;
}

export async function standalone(
  source = new URL("../dist/color.wasm", import.meta.url),
) {
  const bytes = source instanceof Uint8Array
    ? source
    : await Deno.readFile(source);
  const { instance } = await WebAssembly.instantiate(bytes, {});
  instance.exports.color_init();
  return runtime(instance);
}

export function runtime(instance) {
  const exports = instance.exports;
  const memory = exports.memory;
  const alloc = (size) => {
    const pointer = exports.color_alloc(size || 1);
    assert(pointer !== 0, `allocation of ${size} bytes`);
    return pointer;
  };
  const copyIn = (bytes) => {
    const pointer = alloc(bytes.byteLength);
    new Uint8Array(memory.buffer, pointer, bytes.byteLength).set(bytes);
    return pointer;
  };
  const copyOut = (pointer, length) =>
    new Uint8Array(memory.buffer, pointer, length).slice();
  const free = (pointer) => pointer === 0 ? 0 : exports.color_free(pointer);
  return { instance, exports, memory, alloc, copyIn, copyOut, free };
}

export function writeSourceRecord(runtime, pointer, source, input) {
  const { exports, memory } = runtime;
  const view = new DataView(memory.buffer);
  const fields = {
    src: "color_source_src",
    length: "color_source_length",
    width: "color_source_width",
    height: "color_source_height",
    stride: "color_source_stride",
    sample: "color_source_sample",
    bits: "color_source_bits",
    layout: "color_source_layout",
    alpha: "color_source_alpha",
    transfer: "color_source_transfer",
    primaries: "color_source_primaries",
    mode: "color_source_mode",
  };
  for (const [name, exported] of Object.entries(fields)) {
    const value = name === "src"
      ? input
      : name === "length"
      ? source.length
      : source[name];
    view.setUint32(pointer + globalValue(exports, exported), value, true);
  }
  view.setFloat64(
    pointer + globalValue(exports, "color_source_gamma"),
    source.gamma,
    true,
  );
  view.setFloat64(
    pointer + globalValue(exports, "color_source_reference_white"),
    source.referenceWhite,
    true,
  );
}

export function writePolicy(runtime, pointer, policy) {
  const { exports, memory } = runtime;
  const view = new DataView(memory.buffer);
  const integers = [
    ["version", "color_policy_version"],
    ["primaries", "color_policy_primaries"],
    ["transfer", "color_policy_transfer"],
    ["depth", "color_policy_depth"],
    ["alpha", "color_policy_alpha"],
    ["tone", "color_policy_tone"],
    ["range", "color_policy_range"],
    ["white", "color_policy_white"],
    ["gamut", "color_policy_gamut"],
    ["masteringPresent", "color_policy_mastering_present"],
  ];
  for (const [name, exported] of integers) {
    view.setUint32(
      pointer + globalValue(exports, exported),
      name === "version"
        ? globalValue(exports, "color_abi_version_value")
        : policy[name],
      true,
    );
  }
  for (
    const [name, exported] of [
      ["sourcePeak", "color_policy_source_peak"],
      ["targetPeak", "color_policy_target_peak"],
      ["referenceWhite", "color_policy_reference_white"],
      ["sourceMin", "color_policy_source_min"],
    ]
  ) {
    view.setFloat64(
      pointer + globalValue(exports, exported),
      policy[name],
      true,
    );
  }
}

export function writeCapability(runtime, pointer, capability) {
  const { exports, memory } = runtime;
  const view = new DataView(memory.buffer);
  const values = {
    color_capability_version: globalValue(exports, "color_abi_version_value"),
    color_capability_depth_mask: capability.depthMask,
    color_capability_encoding_low: capability.encodingLow,
    color_capability_encoding_high: capability.encodingHigh,
    color_capability_alpha: capability.alpha,
    color_capability_flags: capability.flags,
  };
  for (const [name, value] of Object.entries(values)) {
    view.setUint32(pointer + globalValue(exports, name), value, true);
  }
}

export function writePaletteRecord(runtime, pointer, entry, entries = 0) {
  const { exports, memory } = runtime;
  const view = new DataView(memory.buffer);
  view.setUint32(
    pointer + globalValue(exports, "color_palette_red_levels"),
    entry.redLevels,
    true,
  );
  view.setUint32(
    pointer + globalValue(exports, "color_palette_green_levels"),
    entry.greenLevels,
    true,
  );
  view.setUint32(
    pointer + globalValue(exports, "color_palette_blue_levels"),
    entry.blueLevels,
    true,
  );
  view.setInt32(
    pointer + globalValue(exports, "color_palette_transparent"),
    entry.transparent,
    true,
  );
  view.setUint32(
    pointer + globalValue(exports, "color_palette_entries"),
    entries,
    true,
  );
}

export function exercisePaletteFixtures(runtime, fixture, label) {
  for (
    const [name, expected] of [
      ["color_palette_size", 20],
      ["color_palette_red_levels", 0],
      ["color_palette_green_levels", 4],
      ["color_palette_blue_levels", 8],
      ["color_palette_transparent", 12],
      ["color_palette_entries", 16],
      ["color_palette_transparent_none", -1],
      ["color_error_palette_levels", 17],
      ["color_error_palette_threshold", 18],
      ["color_error_palette_span", 19],
      ["color_error_palette_record", 20],
    ]
  ) {
    assert(
      globalValue(runtime.exports, name) === expected,
      `${label} ${name} ABI value`,
    );
  }
  const uniform = new Map(fixture.uniform.map((entry) => [entry.id, entry]));
  for (const entry of fixture.uniform) {
    const record = runtime.alloc(
      globalValue(runtime.exports, "color_palette_size"),
    );
    const expected = fromHex(entry.expected);
    const palette = runtime.alloc(expected.length);
    try {
      writePaletteRecord(runtime, record, entry);
      assert(
        runtime.exports.color_palette_uniform(
          record,
          palette,
          expected.length,
        ) === 1,
        `${label} ${entry.id} palette succeeds`,
      );
      assert(
        new DataView(runtime.memory.buffer).getUint32(
          record + globalValue(runtime.exports, "color_palette_entries"),
          true,
        ) === entry.entries,
        `${label} ${entry.id} entry count`,
      );
      assert(
        hex(runtime.copyOut(palette, expected.length)) === entry.expected,
        `${label} ${entry.id} exact palette`,
      );
      assert(
        runtime.exports.color_error_code() ===
          globalValue(runtime.exports, "color_error_success"),
        `${label} ${entry.id} clears error`,
      );
    } finally {
      runtime.free(palette);
      runtime.free(record);
    }
  }

  for (const entry of fixture.index) {
    const shape = uniform.get(entry.uniform);
    const record = runtime.alloc(
      globalValue(runtime.exports, "color_palette_size"),
    );
    const palette = runtime.alloc(fromHex(shape.expected).length);
    const input = runtime.copyIn(fromHex(entry.input));
    const output = runtime.alloc(fromHex(entry.expected).length);
    try {
      writePaletteRecord(runtime, record, shape);
      assert(
        runtime.exports.color_palette_uniform(
          record,
          palette,
          fromHex(shape.expected).length,
        ) === 1,
        `${label} ${entry.id} setup`,
      );
      assert(
        runtime.exports.color_index_palette(
          record,
          input,
          fromHex(entry.input).length,
          entry.threshold,
          output,
          fromHex(entry.expected).length,
        ) === 1,
        `${label} ${entry.id} indexing succeeds`,
      );
      assert(
        hex(runtime.copyOut(output, fromHex(entry.expected).length)) ===
          entry.expected,
        `${label} ${entry.id} exact indices`,
      );
    } finally {
      runtime.free(output);
      runtime.free(input);
      runtime.free(palette);
      runtime.free(record);
    }
  }

  for (const entry of fixture.errors) {
    const record = runtime.alloc(
      globalValue(runtime.exports, "color_palette_size"),
    );
    const shape = entry.uniform ? uniform.get(entry.uniform) : entry;
    let palette = 0;
    let input = 0;
    let output = 0;
    try {
      writePaletteRecord(runtime, record, shape);
      let status;
      if (entry.op === "uniform") {
        palette = runtime.alloc(Math.max(1, entry.capacity));
        status = runtime.exports.color_palette_uniform(
          record,
          palette,
          entry.capacity,
        );
      } else {
        palette = runtime.alloc(fromHex(shape.expected).length);
        assert(
          runtime.exports.color_palette_uniform(
            record,
            palette,
            fromHex(shape.expected).length,
          ) === 1,
          `${label} ${entry.id} setup`,
        );
        if (entry.op === "index-record") {
          new DataView(runtime.memory.buffer).setUint32(
            record + globalValue(runtime.exports, "color_palette_entries"),
            entry.entries,
            true,
          );
        }
        input = runtime.copyIn(fromHex(entry.input));
        output = runtime.alloc(Math.max(1, entry.capacity));
        status = runtime.exports.color_index_palette(
          record,
          input,
          fromHex(entry.input).length,
          entry.threshold,
          output,
          entry.capacity,
        );
      }
      assert(status === 0, `${label} ${entry.id} rejects`);
      assert(
        runtime.exports.color_error_code() === entry.code,
        `${label} ${entry.id} error code`,
      );
      assert(
        runtime.exports.color_error_field() === entry.field,
        `${label} ${entry.id} error field`,
      );
    } finally {
      runtime.free(output);
      runtime.free(input);
      runtime.free(palette);
      runtime.free(record);
    }
  }

  const recovery = uniform.get("2x2x2-no-transparency");
  const recoveryRecord = runtime.alloc(
    globalValue(runtime.exports, "color_palette_size"),
  );
  const recoveryPalette = runtime.alloc(fromHex(recovery.expected).length);
  try {
    writePaletteRecord(runtime, recoveryRecord, recovery);
    assert(
      runtime.exports.color_palette_uniform(
        recoveryRecord,
        recoveryPalette,
        fromHex(recovery.expected).length,
      ) === 1,
      `${label} palette succeeds after error`,
    );
    assert(
      runtime.exports.color_error_code() ===
        globalValue(runtime.exports, "color_error_success"),
      `${label} success clears palette error`,
    );
    assert(
      runtime.exports.color_error_field() === 0,
      `${label} success clears palette error field`,
    );
  } finally {
    runtime.free(recoveryPalette);
    runtime.free(recoveryRecord);
  }
}
