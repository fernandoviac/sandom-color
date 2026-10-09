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

Deno.test("color-mix interpolation follows CSS Color 4 and 5 in Chrome's single-precision arithmetic", async () => {
  const runtime = await standalone();
  const { exports, memory } = runtime;
  const g = (name) => globalValue(exports, name);
  const size = g("color_mix_operand_size");
  assert(size === 40, "operand size");
  const first = runtime.alloc(size);
  const second = runtime.alloc(size);
  const result = runtime.alloc(size);
  const space = {
    srgb: g("color_mix_space_srgb"),
    oklab: g("color_mix_space_oklab"),
    lab: g("color_mix_space_lab"),
    oklch: g("color_mix_space_oklch"),
    lch: g("color_mix_space_lch"),
    hsl: g("color_mix_space_hsl"),
    hwb: g("color_mix_space_hwb"),
  };
  const hue = {
    shorter: g("color_mix_hue_shorter"),
    longer: g("color_mix_hue_longer"),
    increasing: g("color_mix_hue_increasing"),
    decreasing: g("color_mix_hue_decreasing"),
  };
  const missingAlpha = g("color_mix_missing_alpha");
  const encoder = new TextEncoder();
  const operand = (text, pointer) => {
    const bytes = encoder.encode(text);
    new Uint8Array(memory.buffer, g("color_parse_input_offset"), bytes.length)
      .set(bytes);
    assert(exports.color_parse_css(bytes.length) === 0, `${text} parses`);
    assert(exports.color_mix_operand_from_parse(pointer) === 1, `${text} operand`);
  };
  const read = (pointer) => {
    const values = new Float64Array(memory.buffer, pointer, 4);
    const ints = new Int32Array(memory.buffer, pointer + 32, 2);
    return {
      components: [values[0], values[1], values[2]],
      alpha: values[3],
      missing: ints[0],
      space: ints[1],
    };
  };
  // Results are Chrome's float values exactly. f() rounds to single
  // precision; blend() is blink::Blend(float, float, double).
  const f = Math.fround;
  const blend = (a, b, progress) => f(a + f(b - a) * f(progress));
  const close = (actual, expected, label) =>
    assert(actual === expected, `${label}: ${actual} is not ${expected}`);
  const mix = (into, method, a, b, progress = 0.5, multiplier = 1) => {
    operand(a, first);
    operand(b, second);
    assert(exports.color_mix_convert(first, into, first) === 1, `${a} converts`);
    assert(exports.color_mix_convert(second, into, second) === 1, `${b} converts`);
    assert(
      exports.color_mix_interpolate(first, second, method, progress, multiplier, result) === 1,
      `${a} / ${b} interpolates`,
    );
    return read(result);
  };
  const expectMix = (into, method, a, b, components, missing, alpha = 1, progress = 0.5, multiplier = 1) => {
    const label = `${a} / ${b}`;
    const mixed = mix(into, method, a, b, progress, multiplier);
    assert(mixed.space === into, `${label} space`);
    assert(mixed.missing === missing, `${label} missing mask ${mixed.missing}`);
    components.forEach((value, index) => close(mixed.components[index], value, `${label}[${index}]`));
    close(mixed.alpha, alpha, `${label} alpha`);
  };

  // The four hue interpolation methods, both directions around 0 degrees.
  const below = "oklch(0.6 0.2 350)", above = "oklch(0.6 0.2 10)";
  expectMix(space.oklch, hue.shorter, below, above, [f(0.6), f(0.2), 0], 0);
  expectMix(space.oklch, hue.longer, below, above, [f(0.6), f(0.2), 180], 0);
  expectMix(space.oklch, hue.increasing, below, above, [f(0.6), f(0.2), 0], 0);
  expectMix(space.oklch, hue.decreasing, below, above, [f(0.6), f(0.2), 180], 0);
  expectMix(space.oklch, hue.increasing, above, below, [f(0.6), f(0.2), 180], 0);
  expectMix(space.oklch, hue.decreasing, above, below, [f(0.6), f(0.2), 0], 0);
  expectMix(space.hsl, hue.longer, "hsl(350 100% 50%)", "hsl(10 100% 50%)", [180, 1, 0.5], 0);
  expectMix(space.hwb, hue.decreasing, "hwb(10 10% 10%)", "hwb(350 10% 10%)", [0, f(0.1), f(0.1)], 0);

  // A component missing from one color takes the other's value; one missing
  // from both stays missing.
  expectMix(space.oklch, hue.shorter, "oklch(0.7 none 120)", "oklch(0.5 0.2 40)", [blend(f(0.7), f(0.5), 0.5), f(0.2), 80], 0);
  expectMix(space.lch, hue.shorter, "lch(50 30 none)", "lch(70 40 90)", [60, 35, 90], 0);
  expectMix(space.hsl, hue.shorter, "hsl(none 50% 50%)", "hsl(120 50% 50%)", [120, 0.5, 0.5], 0);
  expectMix(space.oklch, hue.shorter, "oklch(0.5 0.1 30 / none)", "oklch(0.7 0.1 90 / none)",
    [blend(f(0.5), f(0.7), 0.5), f(0.1), 60], missingAlpha, 0);

  // Analogous components carry forward across spaces: lightness from Lab to
  // OKLCh, hue from LCh to HSL; opponent a and b have no polar analog.
  operand("lab(none 20 30)", first);
  assert(exports.color_mix_convert(first, space.oklch, first) === 1, "Lab to OKLCh");
  assert(read(first).missing === 1, "lightness carries into OKLCh");
  operand("oklab(0.5 none none)", first);
  assert(exports.color_mix_convert(first, space.oklch, first) === 1, "OKLab to OKLCh");
  assert(read(first).missing === 4, "a and b do not carry; the zero chroma hue is powerless");
  operand("lch(50 40 none)", first);
  assert(exports.color_mix_convert(first, space.hsl, first) === 1, "LCh to HSL");
  assert(read(first).missing === 1, "hue carries into HSL");
  operand("hwb(120 none none)", first);
  assert(exports.color_mix_convert(first, space.hsl, first) === 1, "HWB to HSL");
  assert(read(first).missing === 0, "whiteness and blackness have no HSL analog");

  // Powerless hues: chroma at or below 0.02, zero saturation, whiteness and
  // blackness summing to one.
  exports.color_mix_operand_from_srgb(first, 1, 1, 1, 1);
  assert(exports.color_mix_convert(first, space.oklch, second) === 1, "white to OKLCh");
  assert(read(second).missing === 4 && read(second).components[1] <= 0.02, "white has no OKLCh hue");
  assert(exports.color_mix_convert(first, space.hwb, second) === 1, "white to HWB");
  assert(read(second).missing === 1, "white has no HWB hue");
  exports.color_mix_operand_from_srgb(first, 0.5, 0.5, 0.5, 1);
  assert(exports.color_mix_convert(first, space.hsl, second) === 1, "gray to HSL");
  assert(read(second).missing === 1, "gray has no HSL hue");
  operand("oklab(0.5 0.015 0.015)", first);
  assert(exports.color_mix_convert(first, space.oklch, first) === 1, "low chroma to OKLCh");
  assert(read(first).missing === 0, "chroma above 0.02 keeps its hue");

  // A polar operand converts to its own rectangular form directly, never
  // through sRGB: an achromatic OKLCh color keeps exactly zero a and b.
  operand("oklch(0.145 0 0)", first);
  assert(exports.color_mix_convert(first, space.oklab, first) === 1, "OKLCh to OKLab");
  [f(0.145), 0, 0].forEach((value, index) => close(read(first).components[index], value, `OKLCh to OKLab[${index}]`));
  operand("lch(40 0 0)", first);
  assert(exports.color_mix_convert(first, space.lab, first) === 1, "LCh to Lab");
  [40, 0, 0].forEach((value, index) => close(read(first).components[index], value, `LCh to Lab[${index}]`));

  // Premultiplied alpha, and an alpha multiplier below one: lightness and
  // chroma premultiply, the hue does not.
  {
    const [firstAlpha, secondAlpha, progress] = [f(0.3), f(0.8), 0.6];
    const alpha = blend(firstAlpha, secondAlpha, progress);
    const premultiplied = (a, b) => f(blend(f(f(a) * firstAlpha), f(f(b) * secondAlpha), progress) / alpha);
    expectMix(space.oklch, hue.shorter, "oklch(0.5 0.1 30 / 0.3)", "oklch(0.7 0.2 90 / 0.8)",
      [premultiplied(0.5, 0.7), premultiplied(0.1, 0.2), blend(30, 90, progress)], 0, f(alpha * f(0.6)), progress, 0.6);
  }
  expectMix(space.oklch, hue.shorter, "oklch(0.5 0.1 30)", "oklch(0.7 0.1 90)",
    [blend(f(0.5), f(0.7), 0.5), f(0.1), 60], 0, f(0.4), 0.5, 0.4);
  const transparentMix = mix(space.hsl, hue.shorter, "rgb(0 0 0 / 0)", "hsl(240 100% 50%)");
  assert(transparentMix.missing === 0, "transparent keeps its alpha");
  close(transparentMix.alpha, 0.5, "transparent alpha");
  [240, 1, 0.5].forEach((value, index) => close(transparentMix.components[index], value, `transparent mix[${index}]`));

  // HSL and HWB results convert to sRGB in VEC: HWB to sRGB is
  // gfx::HWBToSRGB, here over the hue-30 HSL color (1, 0.5, 0).
  mix(space.hwb, hue.shorter, "hwb(30 20% 30%)", "hwb(none 10% 10%)");
  assert(exports.color_mix_to_srgb(result) === 1, "HWB to sRGB");
  {
    const white = blend(f(0.2), f(0.1), 0.5), black = blend(f(0.3), f(0.1), 0.5);
    const sum = f(white + black);
    [1, 0.5, 0].map((channel) => f(channel + f(white - f(sum * channel))))
      .forEach((value, index) => close(vector(runtime)[index], value, `HWB sRGB[${index}]`));
  }

  // Rejections name the failing argument.
  assert(exports.color_mix_convert(first, 7, second) === 0, "space bound");
  assert(exports.color_error_code() === g("color_error_enum_version") && exports.color_error_field() === 1, "space field");
  assert(exports.color_mix_convert(first + 4, space.lab, second) === 0, "operand alignment");
  assert(exports.color_error_code() === g("color_error_span_dimensions") && exports.color_error_field() === 0, "operand field");
  operand("rgb(255 0 0)", first);
  operand("rgb(0 0 255)", second);
  assert(exports.color_mix_interpolate(first, second, 4, 0.5, 1, result) === 0, "hue method bound");
  assert(exports.color_error_field() === 2, "hue method field");
  assert(exports.color_mix_interpolate(first, second, 0, 1.5, 1, result) === 0, "progress bound");
  assert(exports.color_error_code() === g("color_error_numeric_parameter") && exports.color_error_field() === 3, "progress field");
  assert(exports.color_mix_convert(first, space.lab, first) === 1, "red to Lab");
  assert(exports.color_mix_interpolate(first, second, 0, 0.5, 1, result) === 0, "spaces must match");
  assert(exports.color_error_code() === g("color_error_enum_version") && exports.color_error_field() === 1, "space mismatch field");

  // The parse record keeps an authored missing hue for hsl() while its
  // conversion mask stays clear.
  operand("hsl(none 50% 50%)", first);
  const record = new Int32Array(memory.buffer, g("color_parse_result_offset"), 20);
  assert(record[g("color_parse_missing") / 4] === 0, "hsl conversion mask");
  assert(record[g("color_parse_authored_missing") / 4] === 1, "hsl authored mask");
  runtime.free(first);
  runtime.free(second);
  runtime.free(result);
});
