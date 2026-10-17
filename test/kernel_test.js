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
  assert(exports.color_mix_convert(first, 15, second) === 0, "space bound");
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

// Measured on the pinned Chrome (151.0.7922.174) on 2026-10-14 through
// Sandom's openOracle(): getComputedStyle(element).color after the value is
// set as the element's color. Each predefined space has a stop in OKLab,
// sRGB, LCh, Lab, OKLCh, HSL and HWB mixes, with components below zero,
// above one, and on both segments of each transfer function. `xyz` is
// xyz-d65.
const PREDEFINED_SPACE_MIXES = [
    ["color-mix(in oklab, color(display-p3 1 0 0), blue)",
      "oklab(0.550278 0.11479 -0.0832604)"],
    ["color-mix(in oklab, color(srgb-linear 0.82 0.31 0.07), blue)",
      "oklab(0.599231 0.0165324 -0.0968715)"],
    ["color-mix(in srgb, color(srgb-linear 0.82 0.31 0.07), blue)",
      "color(srgb 0.458155 0.296343 0.64671)"],
    ["color-mix(in lch, color(srgb-linear 0.82 0.31 0.07), blue)",
      "lch(49.8325 95.0789 2.01703)"],
    ["color-mix(in lab, color(srgb-linear -0.05 0.6 1.1) 30%, color(srgb-linear 0.02 0.5 0.95))",
      "lab(72.1863 -24.8487 -42.6154)"],
    ["color-mix(in oklch, color(srgb-linear 0.02 0.5 0.95), color(srgb-linear 0.82 0.31 0.07) 25%)",
      "oklch(0.74737 0.142794 189.72)"],
    ["color-mix(in hsl, color(srgb-linear 0.82 0.31 0.07), white)",
      "color(srgb 0.880294 0.799388 0.724571)"],
    ["color-mix(in hwb, color(srgb-linear 0.02 0.5 0.95), black)",
      "color(srgb 0.0758705 0.367697 0.488853)"],
    ["color-mix(in srgb, color(srgb-linear -0.05 0.6 1.1), red)",
      "color(srgb 0.376086 0.398895 0.521381)"],
    ["color-mix(in oklab, color(display-p3 0.82 0.31 0.07), blue)",
      "oklab(0.530087 0.0640771 -0.089326)"],
    ["color-mix(in srgb, color(display-p3 0.82 0.31 0.07), blue)",
      "color(srgb 0.444072 0.129742 0.443639)"],
    ["color-mix(in lch, color(display-p3 0.82 0.31 0.07), blue)",
      "lch(41.177 114.83 356.523)"],
    ["color-mix(in lab, color(display-p3 -0.05 0.6 1.1) 30%, color(display-p3 0.02 0.5 0.95))",
      "lab(55.4512 0.357953 -73.503)"],
    ["color-mix(in oklch, color(display-p3 0.02 0.5 0.95), color(display-p3 0.82 0.31 0.07) 25%)",
      "oklch(0.605758 0.213847 286.916)"],
    ["color-mix(in hsl, color(display-p3 0.82 0.31 0.07), white)",
      "color(srgb 0.891432 0.64323 0.49628)"],
    ["color-mix(in hwb, color(display-p3 0.02 0.5 0.95), black)",
      "color(srgb -0.119106 0.254786 0.491269)"],
    ["color-mix(in srgb, color(display-p3 -0.05 0.6 1.1), red)",
      "color(srgb 0.346724 0.305757 0.568433)"],
    ["color-mix(in oklab, color(display-p3-linear 0.82 0.31 0.07), blue)",
      "oklab(0.602598 0.0253775 -0.0883324)"],
    ["color-mix(in srgb, color(display-p3-linear 0.82 0.31 0.07), blue)",
      "color(srgb 0.485333 0.286799 0.605174)"],
    ["color-mix(in lch, color(display-p3-linear 0.82 0.31 0.07), blue)",
      "lch(50.1153 101.421 1.31274)"],
    ["color-mix(in lab, color(display-p3-linear -0.05 0.6 1.1) 30%, color(display-p3-linear 0.02 0.5 0.95))",
      "lab(71.7097 -35.331 -46.8428)"],
    ["color-mix(in oklch, color(display-p3-linear 0.02 0.5 0.95), color(display-p3-linear 0.82 0.31 0.07) 25%)",
      "oklch(0.744323 0.172325 184.151)"],
    ["color-mix(in hsl, color(display-p3-linear 0.82 0.31 0.07), white)",
      "color(srgb 0.890293 0.791026 0.700214)"],
    ["color-mix(in hwb, color(display-p3-linear 0.02 0.5 0.95), black)",
      "color(srgb -0.164164 0.374268 0.500832)"],
    ["color-mix(in srgb, color(display-p3-linear -0.05 0.6 1.1), red)",
      "color(srgb 0.259823 0.406877 0.534066)"],
    ["color-mix(in oklab, color(a98-rgb 0.82 0.31 0.07), blue)",
      "oklab(0.54813 0.065706 -0.0907257)"],
    ["color-mix(in srgb, color(a98-rgb 0.82 0.31 0.07), blue)",
      "color(srgb 0.47105 0.152809 0.498353)"],
    ["color-mix(in lch, color(a98-rgb 0.82 0.31 0.07), blue)",
      "lch(43.262 111.662 354.726)"],
    ["color-mix(in lab, color(a98-rgb -0.05 0.6 1.1) 30%, color(a98-rgb 0.02 0.5 0.95))",
      "lab(53.692 -5.45369 -73.616)"],
    ["color-mix(in oklch, color(a98-rgb 0.02 0.5 0.95), color(a98-rgb 0.82 0.31 0.07) 25%)",
      "oklch(0.602179 0.22206 282.429)"],
    ["color-mix(in hsl, color(a98-rgb 0.82 0.31 0.07), white)",
      "color(srgb 0.868281 0.688417 0.601121)"],
    ["color-mix(in hwb, color(a98-rgb 0.02 0.5 0.95), black)",
      "color(srgb -0.162707 0.251956 0.482462)"],
    ["color-mix(in srgb, color(a98-rgb -0.05 0.6 1.1), red)",
      "color(srgb 0.301032 0.30279 0.555611)"],
    ["color-mix(in oklab, color(prophoto-rgb 0.82 0.31 0.07), blue)",
      "oklab(0.568465 0.10863 -0.0820504)"],
    ["color-mix(in srgb, color(prophoto-rgb 0.82 0.31 0.07), blue)",
      "color(srgb 0.56696 -0.0514068 0.436078)"],
    ["color-mix(in lch, color(prophoto-rgb 0.82 0.31 0.07), blue)",
      "lch(45.0845 129.993 353.324)"],
    ["color-mix(in lab, color(prophoto-rgb -0.05 0.6 1.1) 30%, color(prophoto-rgb 0.02 0.5 0.95))",
      "lab(54.6978 -92.6411 -77.4043)"],
    ["color-mix(in oklch, color(prophoto-rgb 0.02 0.5 0.95), color(prophoto-rgb 0.82 0.31 0.07) 25%)",
      "oklch(0.594676 0.444135 162.218)"],
    ["color-mix(in hsl, color(prophoto-rgb 0.82 0.31 0.07), white)",
      "color(srgb 0.909239 0.600056 0.593798)"],
    ["color-mix(in hwb, color(prophoto-rgb 0.02 0.5 0.95), black)",
      "color(srgb -0.363324 0.313465 0.503385)"],
    ["color-mix(in srgb, color(prophoto-rgb -0.05 0.6 1.1), red)",
      "color(srgb 0.0828663 0.363944 0.564385)"],
    ["color-mix(in oklab, color(rec2020 0.82 0.31 0.07), blue)",
      "oklab(0.556116 0.0838047 -0.0872529)"],
    ["color-mix(in srgb, color(rec2020 0.82 0.31 0.07), blue)",
      "color(srgb 0.510691 0.113677 0.465021)"],
    ["color-mix(in lch, color(rec2020 0.82 0.31 0.07), blue)",
      "lch(43.9623 118.684 353.653)"],
    ["color-mix(in lab, color(rec2020 -0.05 0.6 1.1) 30%, color(rec2020 0.02 0.5 0.95))",
      "lab(56.1349 -29.5469 -73.3259)"],
    ["color-mix(in oklch, color(rec2020 0.02 0.5 0.95), color(rec2020 0.82 0.31 0.07) 25%)",
      "oklch(0.617338 0.262174 270.157)"],
    ["color-mix(in hsl, color(rec2020 0.82 0.31 0.07), white)",
      "color(srgb 0.888203 0.669426 0.587508)"],
    ["color-mix(in hwb, color(rec2020 0.02 0.5 0.95), black)",
      "color(srgb -0.248329 0.285703 0.496181)"],
    ["color-mix(in srgb, color(rec2020 -0.05 0.6 1.1), red)",
      "color(srgb 0.198549 0.334795 0.564897)"],
    ["color-mix(in oklab, color(xyz-d50 0.82 0.31 0.07), blue)",
      "oklab(0.585338 0.188641 -0.108659)"],
    ["color-mix(in srgb, color(xyz-d50 0.82 0.31 0.07), blue)",
      "color(srgb 0.681625 -0.245727 0.662669)"],
    ["color-mix(in lch, color(xyz-d50 0.82 0.31 0.07), blue)",
      "lch(46.0365 137.311 340.351)"],
    ["color-mix(in lab, color(xyz-d50 -0.05 0.6 1.1) 30%, color(xyz-d50 0.02 0.5 0.95))",
      "lab(77.7999 -348.025 -51.0468)"],
    ["color-mix(in oklch, color(xyz-d50 0.02 0.5 0.95), color(xyz-d50 0.82 0.31 0.07) 25%)",
      "oklch(0.728856 0.61595 147.413)"],
    ["color-mix(in hsl, color(xyz-d50 0.82 0.31 0.07), white)",
      "color(srgb 1.01797 0.417923 0.682179)"],
    ["color-mix(in hwb, color(xyz-d50 0.02 0.5 0.95), black)",
      "color(srgb -0.544021 0.493425 0.545971)"],
    ["color-mix(in srgb, color(xyz-d50 -0.05 0.6 1.1), red)",
      "color(srgb -0.125147 0.548591 0.580279)"],
    ["color-mix(in oklab, color(xyz-d65 0.82 0.31 0.07), blue)",
      "oklab(0.592267 0.187348 -0.0989317)"],
    ["color-mix(in srgb, color(xyz-d65 0.82 0.31 0.07), blue)",
      "color(srgb 0.697594 -0.247969 0.6317)"],
    ["color-mix(in lch, color(xyz-d65 0.82 0.31 0.07), blue)",
      "lch(46.8672 140.015 342.533)"],
    ["color-mix(in lab, color(xyz-d65 -0.05 0.6 1.1) 30%, color(xyz-d65 0.02 0.5 0.95))",
      "lab(76.4826 -486.418 -34.716)"],
    ["color-mix(in oklch, color(xyz-d65 0.02 0.5 0.95), color(xyz-d65 0.82 0.31 0.07) 25%)",
      "oklch(0.719226 0.625881 144.974)"],
    ["color-mix(in hsl, color(xyz-d65 0.82 0.31 0.07), white)",
      "color(srgb 1.01417 0.435452 0.667824)"],
    ["color-mix(in hwb, color(xyz-d65 0.02 0.5 0.95), black)",
      "color(srgb -0.537184 0.490687 0.478128)"],
    ["color-mix(in srgb, color(xyz-d65 -0.05 0.6 1.1), red)",
      "color(srgb -0.119594 0.545537 0.508182)"],
    ["color-mix(in oklab, color(xyz 0.82 0.31 0.07), blue)",
      "oklab(0.592267 0.187348 -0.0989317)"],
    ["color-mix(in srgb, color(xyz 0.82 0.31 0.07), blue)",
      "color(srgb 0.697594 -0.247969 0.6317)"],
    ["color-mix(in lch, color(xyz 0.82 0.31 0.07), blue)",
      "lch(46.8672 140.015 342.533)"],
    ["color-mix(in lab, color(xyz -0.05 0.6 1.1) 30%, color(xyz 0.02 0.5 0.95))",
      "lab(76.4826 -486.418 -34.716)"],
    ["color-mix(in oklch, color(xyz 0.02 0.5 0.95), color(xyz 0.82 0.31 0.07) 25%)",
      "oklch(0.719226 0.625881 144.974)"],
    ["color-mix(in hsl, color(xyz 0.82 0.31 0.07), white)",
      "color(srgb 1.01417 0.435452 0.667824)"],
    ["color-mix(in hwb, color(xyz 0.02 0.5 0.95), black)",
      "color(srgb -0.537184 0.490687 0.478128)"],
    ["color-mix(in srgb, color(xyz -0.05 0.6 1.1), red)",
      "color(srgb -0.119594 0.545537 0.508182)"],
    ["color-mix(in srgb, color(display-p3 none 0.5 0.2), red)",
      "color(srgb 1 0.254815 0.0748364)"],
    ["color-mix(in lab, color(rec2020 0.3 none 0.6 / 0.5), color(xyz-d50 0.2 0.3 0.4 / none))",
      "lab(43.6229 14.6668 -46.4542 / 0.5)"],
    // Interpolation in a predefined space (Chrome/151.0.7922.174, measured
    // by Sandom's test/probes/color-mix-probe.js).
    ["color-mix(in srgb-linear, oklch(0.7 0.2 30 / 0.6) 30%, color(display-p3 0.1 0.8 0.3))",
      "color(srgb-linear 0.112809 0.524658 0.0411574 / 0.88)"],
    ["color-mix(in srgb-linear, color(srgb none 0.5 0.2), blue)", "color(srgb-linear 0 0.107021 0.516552)"],
    ["color-mix(in display-p3, red, blue)", "color(display-p3 0.458734 0.100055 0.549017)"],
    ["color-mix(in display-p3, oklch(0.7 0.2 30 / 0.6) 30%, color(rec2020 0.1 0.8 0.3))",
      "color(display-p3 -0.151675 0.760045 0.339583 / 0.88)"],
    ["color-mix(in display-p3, color(srgb none 0.5 0.2), blue)", "color(display-p3 -0.0000623775 0.246049 0.598007)"],
    ["color-mix(in display-p3-linear, red, blue)", "color(display-p3-linear 0.411271 0.0165849 0.463734)"],
    ["color-mix(in display-p3-linear, lab(60 40 -30) 70%, hsl(120 50% 40% / 0.5))",
      "color(display-p3-linear 0.402993 0.211118 0.453842 / 0.85)"],
    ["color-mix(in a98-rgb, red, blue)", "color(a98-rgb 0.426364 -0.00755272 0.487894)"],
    ["color-mix(in a98-rgb, oklch(0.7 0.2 30 / 0.6) 30%, color(display-p3 0.1 0.8 0.3))",
      "color(a98-rgb 0.449139 0.722068 0.280162 / 0.88)"],
    ["color-mix(in a98-rgb, color(srgb none 0.5 0.2), blue)", "color(a98-rgb -0.00593556 0.243757 0.60709)"],
    ["color-mix(in prophoto-rgb, red, blue)", "color(prophoto-rgb 0.519249 0.206658 0.513153)"],
    ["color-mix(in prophoto-rgb, oklch(0.7 0.2 30 / 0.6) 30%, color(display-p3 0.1 0.8 0.3))",
      "color(prophoto-rgb 0.427427 0.649188 0.277063 / 0.88)"],
    ["color-mix(in prophoto-rgb, lab(60 40 -30) 70%, hsl(120 50% 40% / 0.5))",
      "color(prophoto-rgb 0.565943 0.446404 0.61305 / 0.85)"],
    ["color-mix(in rec2020, red, blue)", "color(rec2020 0.480177 0.141018 0.510213)"],
    ["color-mix(in rec2020, oklch(0.7 0.2 30 / 0.6) 30%, color(display-p3 0.1 0.8 0.3))",
      "color(rec2020 0.44132 0.684186 0.262879 / 0.88)"],
    ["color-mix(in rec2020, rgb(10 20 30), color(xyz-d50 0.2 0.3 0.4))", "color(rec2020 0.170371 0.313951 0.376151)"],
    ["color-mix(in xyz, red, blue)", "color(xyz-d65 0.296439 0.142411 0.484861)"],
    ["color-mix(in xyz-d50, red, blue)", "color(xyz-d50 0.289566 0.141548 0.364006)"],
    ["color-mix(in xyz-d50, oklch(0.7 0.2 30 / 0.6) 30%, color(display-p3 0.1 0.8 0.3))",
      "color(xyz-d50 0.257151 0.403706 0.0818921 / 0.88)"],
    ["color-mix(in xyz-d50, color(xyz-d50 none 0.5 0.2), color(xyz-d65 0.3 0.2 0.1))",
      "color(xyz-d50 0.313922 0.35263 0.137718)"],
    ["color-mix(in xyz-d65, oklch(0.7 0.2 30 / 0.6) 30%, color(display-p3 0.1 0.8 0.3))",
      "color(xyz-d65 0.241585 0.402164 0.103821 / 0.88)"],
    ["color-mix(in xyz-d65, white, black)", "color(xyz-d65 0.475253 0.499982 0.544449)"],
];

Deno.test("color-mix keeps a color() stop in its predefined space and converts it as Chrome does", async () => {
  const runtime = await standalone();
  const { exports, memory } = runtime;
  const g = (name) => globalValue(exports, name);
  const size = g("color_mix_operand_size");
  const first = runtime.alloc(size);
  const second = runtime.alloc(size);
  const result = runtime.alloc(size);
  const encoder = new TextEncoder();
  // Named colors are sRGB operands, as a host makes them.
  const named = { blue: [0, 0, 1], red: [1, 0, 0], white: [1, 1, 1], black: [0, 0, 0] };
  const operand = (text, pointer) => {
    if (named[text]) {
      assert(exports.color_mix_operand_from_srgb(pointer, ...named[text], 1) === 1, `${text} operand`);
      return;
    }
    const bytes = encoder.encode(text);
    new Uint8Array(memory.buffer, g("color_parse_input_offset"), bytes.length).set(bytes);
    assert(exports.color_parse_css(bytes.length) === 0, `${text} parses`);
    assert(exports.color_mix_operand_from_parse(pointer) === 1, `${text} operand`);
  };
  const record = (pointer) => ({
    components: [...new Float64Array(memory.buffer, pointer, 4)],
    ints: [...new Int32Array(memory.buffer, pointer + 32, 2)],
  });

  // Chrome's String::Number: six significant digits.
  const number = (value) => {
    const text = String(Number(value.toPrecision(6)));
    assert(!text.includes("e"), `${value} needs an exponent`);
    return text;
  };
  const spaces = ["srgb", "oklab", "lab", "oklch", "lch", "hsl", "hwb", "srgb-linear", "display-p3",
    "display-p3-linear", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d50", "xyz-d65"];
  const failures = [];
  for (const [value, chrome] of PREDEFINED_SPACE_MIXES) {
    const [named, ...stops] = value.slice("color-mix(in ".length, -1).split(", ");
    const into = named === "xyz" ? "xyz-d65" : named;
    const space = spaces.indexOf(into);
    const [[firstText, firstShare], [secondText, secondShare]] = stops.map((stop) => {
      const [, text, share] = stop.match(/^(.*?)(?: ([\d.]+)%)?$/);
      return [text, share === undefined ? null : Number(share) / 100];
    });
    const firstPart = firstShare ?? (secondShare === null ? 0.5 : 1 - secondShare);
    const secondPart = secondShare ?? (firstShare === null ? 0.5 : 1 - firstShare);
    const sum = firstPart + secondPart;
    operand(firstText, first);
    operand(secondText, second);
    assert(exports.color_mix_convert(first, space, first) === 1, `${firstText} converts`);
    assert(exports.color_mix_convert(second, space, second) === 1, `${secondText} converts`);
    assert(
      exports.color_mix_interpolate(first, second, 0, secondPart / sum, Math.min(sum, 1), result) === 1,
      `${value} interpolates`,
    );
    const mixed = record(result);
    let components = mixed.components.slice(0, 3);
    let missing = mixed.ints[0];
    // HSL and HWB serialize as sRGB, their missing components as zero.
    if (space === 5 || space === 6) {
      assert(exports.color_mix_to_srgb(result) === 1, `${value} to sRGB`);
      components = [...vector(runtime)];
      missing &= g("color_mix_missing_alpha");
    }
    const prefix = space === 0 || space === 5 || space === 6
      ? "color(srgb "
      : space >= 7 ? `color(${into} ` : `${into}(`;
    const alpha = missing & g("color_mix_missing_alpha")
      ? " / none"
      : mixed.components[3] === 1 ? "" : ` / ${number(mixed.components[3])}`;
    const serialized = prefix +
      components.map((component, index) => missing & (1 << index) ? "none" : number(component)).join(" ") +
      alpha + ")";
    if (serialized !== chrome) failures.push(`${value}: ${serialized}, Chrome ${chrome}`);
  }
  assert(failures.length === 0, `color-mix diverges from Chrome:\n${failures.join("\n")}`);

  // A color() stop keeps its authored space and single-precision components.
  for (const [text, space] of [
    ["color(srgb-linear 0.1 0.2 0.3)", "srgb_linear"],
    ["color(display-p3 1 0 0)", "display_p3"],
    ["color(display-p3-linear 0.1 0.2 0.3)", "display_p3_linear"],
    ["color(a98-rgb 0.1 0.2 0.3)", "a98_rgb"],
    ["color(prophoto-rgb 0.1 0.2 0.3)", "prophoto_rgb"],
    ["color(rec2020 0.1 0.2 0.3)", "rec2020"],
    ["color(xyz-d50 0.1 0.2 0.3)", "xyz_d50"],
    ["color(xyz-d65 0.1 0.2 0.3)", "xyz_d65"],
    ["color(xyz 0.1 0.2 0.3)", "xyz_d65"],
  ]) {
    operand(text, first);
    const { components, ints } = record(first);
    assert(ints[1] === g(`color_mix_space_${space}`), `${text} keeps its space, not ${ints[1]}`);
    const authored = text.match(/ ([\d.]+) ([\d.]+) ([\d.]+)\)$/).slice(1).map(Number);
    authored.forEach((value, index) =>
      assert(components[index] === Math.fround(value), `${text}[${index}] is ${components[index]}`)
    );
  }
  runtime.free(first);
  runtime.free(second);
  runtime.free(result);
});
