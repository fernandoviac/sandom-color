import { assert, globalValue, hex, standalone } from "./test-helpers.js";

const fixtures = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/icc-fixtures.json", import.meta.url),
  ),
);

async function compile(runtime, relative) {
  const bytes = await Deno.readFile(
    new URL(`./fixtures/${relative}`, import.meta.url),
  );
  const input = runtime.copyIn(bytes);
  const info = runtime.alloc(
    globalValue(runtime.exports, "color_profile_info_size"),
  );
  const status = runtime.exports.color_profile_compile(
    input,
    bytes.length,
    info,
  );
  return { bytes, input, info, status };
}

Deno.test("ICC accepted classes, curves, and LUT forms match reviewed results", async () => {
  const runtime = await standalone();
  for (const entry of fixtures.accepted) {
    const compiled = await compile(runtime, entry.file);
    let handle = 0;
    try {
      assert(compiled.status === 0, `${entry.file} compiles`);
      const info = new DataView(runtime.memory.buffer);
      handle = info.getUint32(
        compiled.info +
          globalValue(runtime.exports, "color_profile_info_handle"),
        true,
      );
      assert(handle > 0, `${entry.file} handle`);
      assert(
        info.getUint32(
          compiled.info +
            globalValue(runtime.exports, "color_profile_info_kind"),
          true,
        ) === entry.kind,
        `${entry.file} kind`,
      );
      assert(
        info.getUint32(
          compiled.info +
            globalValue(runtime.exports, "color_profile_info_srgb_like"),
          true,
        ) === entry.srgbLike,
        `${entry.file} sRGB compatibility`,
      );
      assert(
        info.getUint32(
          compiled.info +
            globalValue(runtime.exports, "color_profile_info_identity"),
          true,
        ) === entry.identity,
        `${entry.file} identity`,
      );
      assert(
        info.getUint32(
          compiled.info +
            globalValue(runtime.exports, "color_profile_info_revision"),
          true,
        ) === 1,
        `${entry.file} revision`,
      );
      assert(
        runtime.exports.color_profile_info(handle, compiled.info) === 0,
        "info refresh",
      );

      const xyz = runtime.alloc(24);
      const rgba = runtime.alloc(4);
      try {
        new Float64Array(runtime.memory.buffer, xyz, 3).set([0.25, 0.5, 0.75]);
        assert(
          runtime.exports.color_profile_transform_xyz(handle, xyz, 1) === 0,
          "XYZ transform",
        );
        assert(
          hex(runtime.copyOut(xyz, 24)) === entry.xyzF64,
          `${entry.file} XYZ bits`,
        );
        new Uint8Array(runtime.memory.buffer, rgba, 4).set([64, 128, 192, 128]);
        assert(
          runtime.exports.color_profile_convert_srgb(handle, rgba, 1) === 0,
          "sRGB transform",
        );
        assert(
          hex(runtime.copyOut(rgba, 4)) === entry.srgb,
          `${entry.file} sRGB bytes`,
        );
      } finally {
        runtime.free(rgba);
        runtime.free(xyz);
      }
    } finally {
      if (handle) {
        assert(runtime.exports.color_profile_release(handle) === 0, "release");
      }
      runtime.free(compiled.info);
      runtime.free(compiled.input);
    }
  }
});

Deno.test("ICC accepts valid matrix-profile chromatic adaptation metadata", async () => {
  const runtime = await standalone();
  for (const entry of fixtures.acceptedChad) {
    const compiled = await compile(runtime, entry.file);
    let handle = 0;
    try {
      assert(compiled.status === 0, `${entry.file} compiles`);
      const info = new DataView(runtime.memory.buffer);
      handle = info.getUint32(
        compiled.info +
          globalValue(runtime.exports, "color_profile_info_handle"),
        true,
      );
      assert(
        info.getUint32(
          compiled.info +
            globalValue(runtime.exports, "color_profile_info_kind"),
          true,
        ) === entry.kind,
        `${entry.file} kind`,
      );
      assert(
        info.getUint32(
          compiled.info +
            globalValue(runtime.exports, "color_profile_info_srgb_like"),
          true,
        ) === entry.srgbLike,
        `${entry.file} is not mislabeled as sRGB`,
      );
      const rgba = runtime.copyIn(new Uint8Array([64, 128, 192, 128]));
      try {
        assert(
          runtime.exports.color_profile_convert_srgb(handle, rgba, 1) === 0,
          `${entry.file} converts`,
        );
        assert(
          new Uint8Array(runtime.memory.buffer, rgba, 4)[3] === 128,
          `${entry.file} conversion preserves alpha`,
        );
      } finally {
        runtime.free(rgba);
      }
    } finally {
      if (handle) runtime.exports.color_profile_release(handle);
      runtime.free(compiled.info);
      runtime.free(compiled.input);
    }
  }
});

Deno.test("ICC exclusions have distinct codes and byte fields", async () => {
  const runtime = await standalone();
  for (const entry of fixtures.rejected) {
    const compiled = await compile(runtime, entry.file);
    try {
      assert(compiled.status === entry.code, `${entry.file} code`);
      assert(
        runtime.exports.color_error_code() === entry.code,
        `${entry.file} last code`,
      );
      assert(
        runtime.exports.color_error_field() === entry.field,
        `${entry.file} field`,
      );
    } finally {
      runtime.free(compiled.info);
      runtime.free(compiled.input);
    }
  }
});

Deno.test("profile preparation exposes XYZ D65 RGBA and preserves alpha", async () => {
  const runtime = await standalone();
  const compiled = await compile(runtime, "icc/matrix-para0.icc");
  let handle = 0;
  const input = runtime.copyIn(new Uint8Array([255, 0, 0, 128]));
  const output = runtime.alloc(16);
  try {
    assert(compiled.status === 0, "profile compiles");
    handle = new DataView(runtime.memory.buffer).getUint32(compiled.info, true);
    assert(
      runtime.exports.color_profile_prepare(
        handle,
        input,
        4,
        1,
        1,
        4,
        0,
        3,
        8,
        1,
        output,
        16,
      ) === 0,
      "profile plane preparation",
    );
    const pixel = new Float32Array(runtime.memory.buffer, output, 4);
    assert(pixel.slice(0, 3).every(Number.isFinite), "finite XYZ D65");
    assert(pixel[3] === Math.fround(128 / 255), "alpha preserved");
  } finally {
    if (handle) runtime.exports.color_profile_release(handle);
    runtime.free(output);
    runtime.free(input);
    runtime.free(compiled.info);
    runtime.free(compiled.input);
  }
});

Deno.test("profile failures publish nothing and stale handles cannot alias reuse", async () => {
  const runtime = await standalone();
  const first = await compile(runtime, "icc/mft1-xyz.icc");
  const firstHandle = new DataView(runtime.memory.buffer).getUint32(
    first.info,
    true,
  );
  const pixels = runtime.alloc(48);
  try {
    const values = new Float64Array(runtime.memory.buffer, pixels, 6);
    values.set([0.25, 0.5, 0.75, NaN, 0, 0]);
    const before = runtime.copyOut(pixels, 48);
    assert(
      runtime.exports.color_profile_transform_xyz(firstHandle, pixels, 2) === 3,
      "NaN error",
    );
    assert(
      runtime.exports.color_error_field() === ((1 * 4) << 26) + 1,
      "A-stage red lane and second sample",
    );
    assert(
      hex(runtime.copyOut(pixels, 48)) === hex(before),
      "failed batch is atomic",
    );
    assert(
      runtime.exports.color_profile_release(firstHandle) === 0,
      "first release",
    );

    const second = await compile(runtime, "icc/mab-lab.icc");
    const secondHandle = new DataView(runtime.memory.buffer).getUint32(
      second.info,
      true,
    );
    try {
      assert(
        secondHandle !== firstHandle,
        "handles do not alias reused blocks",
      );
      assert(
        runtime.exports.color_profile_info(firstHandle, first.info) === 7,
        "stale info",
      );
      assert(
        runtime.exports.color_profile_release(firstHandle) === 7,
        "double release",
      );
      assert(
        runtime.exports.color_profile_info(secondHandle, second.info) === 0,
        "live profile survives",
      );
    } finally {
      runtime.exports.color_profile_release(secondHandle);
      runtime.free(second.info);
      runtime.free(second.input);
    }
  } finally {
    runtime.free(pixels);
    runtime.free(first.info);
    runtime.free(first.input);
  }
});

Deno.test("profile release reuses all retained storage without growth", async () => {
  const runtime = await standalone();
  const bytes = await Deno.readFile(
    new URL("./fixtures/icc/mft2-lab.icc", import.meta.url),
  );
  const oneCycle = () => {
    const input = runtime.copyIn(bytes);
    const info = runtime.alloc(
      globalValue(runtime.exports, "color_profile_info_size"),
    );
    assert(
      runtime.exports.color_profile_compile(input, bytes.length, info) === 0,
      "compile cycle",
    );
    const handle = new DataView(runtime.memory.buffer).getUint32(info, true);
    assert(
      runtime.exports.color_profile_release(handle) === 0,
      "release cycle",
    );
    runtime.free(info);
    runtime.free(input);
  };
  oneCycle();
  const settled = runtime.memory.buffer.byteLength;
  for (let index = 0; index < 16; index += 1) oneCycle();
  assert(
    runtime.memory.buffer.byteLength === settled,
    "released storage prevents growth",
  );
});
