import {
  assert,
  fromHex,
  globalValue,
  hex,
  standalone,
} from "./test-helpers.js";

const fixture = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/color-kernel-fixtures.json", import.meta.url),
  ),
);

function f64Hex(value) {
  return hex(new Float64Array([value]));
}

function vector(runtime) {
  return new Float64Array(
    runtime.memory.buffer,
    globalValue(runtime.exports, "color_vec_offset"),
    3,
  );
}

Deno.test("kernel scalar transfers match reviewed exact f64 fixtures", async () => {
  const { exports } = await standalone();
  for (const entry of fixture.scalar) {
    assert(
      f64Hex(exports[entry.op](...entry.args)) === entry.expectedF64,
      `${entry.op} exact result`,
    );
  }
  assert(exports.pq_to_working(1) === 10000 / 203, "PQ working scale");
  assert(
    f64Hex(exports.working_to_pq(1)) ===
      fixture.scalar.find((entry) => entry.op === "luminance_to_pq_signal")
        .expectedF64,
    "working PQ uses the 203-candela reference white",
  );
});

Deno.test("tagged routes, missing values, and working selection are WAT-owned", async () => {
  const runtime = await standalone();
  const values = vector(runtime);
  for (const entry of fixture.tagged) {
    values.set(entry.input);
    assert(
      runtime.exports.color_convert_tagged_to_working(
        entry.primaries,
        entry.transfer,
        entry.gamma,
        entry.missing,
      ) === 1,
      `${entry.id} route accepted`,
    );
    assert(hex(values) === entry.expectedF64, `${entry.id} exact working RGB`);
  }
  assert(runtime.exports.color_working_code(0, 0) === 0, "standard code");
  assert(runtime.exports.color_working_code(2, 1) === 1, "HDR code");
  assert(
    runtime.exports.color_working_code(1, 0) === -1,
    "other encoding rejected",
  );
  values.set([0.25, 0.5, 0.75]);
  assert(
    runtime.exports.color_convert_tagged_to_standard(0, 0, 1, 0) === 1,
    "standard direct route",
  );
  assert(
    hex(values) === "000000000000d03f000000000000e03f000000000000e83f",
    "standard route preserves authored sRGB bits",
  );
  assert(
    runtime.exports.color_convert_tagged_to_working(0, 2, NaN, 0) === 0,
    "NaN gamma rejected",
  );
  assert(
    runtime.exports.color_convert_tagged_to_working(0, 2, Infinity, 0) === 0,
    "infinite gamma rejected",
  );
});

Deno.test("matrix, perceptual, tone, and gamut operations match reviewed bits", async () => {
  const runtime = await standalone();
  const values = vector(runtime);
  for (const entry of fixture.vector) {
    values.set(entry.input);
    runtime.exports[entry.op](...entry.args);
    assert(hex(values) === entry.expectedF64, `${entry.op} exact vector`);
  }
  const matrix = runtime.alloc(12 * 72);
  try {
    for (let index = 0; index < 12; index += 1) {
      assert(
        runtime.exports.color_matrix_read(index, matrix + index * 72, 72) === 1,
        `matrix ${index} copied`,
      );
    }
    const bytes = runtime.copyOut(matrix, 12 * 72);
    const actual = hex(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    );
    const expected = JSON.parse(
      await Deno.readTextFile(
        new URL("./fixtures/color-matrix-fixtures.json", import.meta.url),
      ),
    ).digest;
    assert(actual === expected, "derived matrix digest");
    assert(
      runtime.exports.color_matrix_read(16, matrix, 72) === 0,
      "matrix index bound",
    );
    assert(
      runtime.exports.color_matrix_read(0, matrix, 71) === 0,
      "matrix capacity bound",
    );
  } finally {
    runtime.free(matrix);
  }
});

Deno.test("CSS parser returns a complete ABI record with exact error statuses", async () => {
  const runtime = await standalone();
  const inputOffset = globalValue(runtime.exports, "color_parse_input_offset");
  const inputCapacity = globalValue(
    runtime.exports,
    "color_parse_input_capacity",
  );
  const resultOffset = globalValue(
    runtime.exports,
    "color_parse_result_offset",
  );
  const resultSize = globalValue(runtime.exports, "color_parse_result_size");
  assert(resultSize === 80, "complete parse record size");
  const encoder = new TextEncoder();
  for (const entry of fixture.css) {
    const bytes = encoder.encode(entry.text);
    new Uint8Array(runtime.memory.buffer, inputOffset, bytes.length).set(bytes);
    const status = runtime.exports.color_parse_css(bytes.length);
    assert(status === entry.status, `${entry.text} status`);
    if (status === 0) {
      assert(
        hex(new Uint8Array(runtime.memory.buffer, resultOffset, resultSize)) ===
          entry.expectedRecord,
        `${entry.text} complete record`,
      );
    }
  }
  assert(
    runtime.exports.color_parse_css(inputCapacity + 1) ===
      globalValue(runtime.exports, "color_css_error_structure"),
    "parser capacity error",
  );
  assert(
    fromHex(fixture.css[0].expectedRecord).length === resultSize,
    "fixture record width",
  );
});
