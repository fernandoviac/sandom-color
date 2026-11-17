import {
  assert,
  fromHex,
  globalValue,
  hex,
  standalone,
} from "./test-helpers.js";
import { convert, interpolate, SPACES, toSrgb } from "./css-color-4-reference.js";

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

// The kernel's color-mix() operand helpers of a standalone runtime.
function mixHarness(runtime) {
  const { exports, memory } = runtime;
  const g = (name) => globalValue(exports, name);
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
  // An operand as a reference color: null for a missing component.
  const read = (pointer) => {
    const values = new Float64Array(memory.buffer, pointer, 4);
    const [missing, space] = new Int32Array(memory.buffer, pointer + 32, 2);
    return {
      space: SPACES[space],
      components: [0, 1, 2].map((index) => missing & (1 << index) ? null : values[index]),
      alpha: missing & 8 ? null : values[3],
    };
  };
  const expectColor = (actual, expected, tolerance, label) => {
    assert(actual.space === expected.space, `${label}: space ${actual.space}, not ${expected.space}`);
    [...actual.components, actual.alpha].forEach((value, index) => {
      const wanted = index < 3 ? expected.components[index] : expected.alpha;
      if (wanted === null || value === null) {
        assert(value === wanted, `${label}[${index}]: ${value}, not ${wanted}`);
      } else {
        assert(Math.abs(value - wanted) <= tolerance, `${label}[${index}]: ${value}, not ${wanted}`);
      }
    });
  };
  return { g, operand, read, expectColor };
}

const HUE_METHODS = ["shorter", "longer", "increasing", "decreasing"];

Deno.test("color-mix converts and interpolates as CSS Color 4 §11.2 and §13 define", async () => {
  const runtime = await standalone();
  const { exports } = runtime;
  const { g, operand, read, expectColor } = mixHarness(runtime);
  const size = g("color_mix_operand_size");
  assert(size === 40, "operand size");
  const first = runtime.alloc(size);
  const second = runtime.alloc(size);
  const result = runtime.alloc(size);
  const space = Object.fromEntries(SPACES.map((name, index) => [name, index]));
  const converted = (text, into) => {
    operand(text, first);
    assert(exports.color_mix_convert(first, space[into], first) === 1, `${text} converts to ${into}`);
    return read(first);
  };
  // The kernel against the CSS Color 4 sample code, and against literal
  // values where the specification states or implies them.
  const mix = (into, method, a, b, progress = 0.5, multiplier = 1) => {
    operand(a, first);
    operand(b, second);
    const expected = interpolate(convert(read(first), into), convert(read(second), into),
      method, progress, multiplier);
    assert(exports.color_mix_convert(first, space[into], first) === 1, `${a} converts`);
    assert(exports.color_mix_convert(second, space[into], second) === 1, `${b} converts`);
    assert(
      exports.color_mix_interpolate(first, second, HUE_METHODS.indexOf(method), progress, multiplier, result) === 1,
      `${a} / ${b} interpolates`,
    );
    expectColor(read(result), expected, 1e-9, `${a} / ${b} in ${into}`);
    return read(result);
  };
  const expectLiteral = (actual, components, alpha, tolerance, label) =>
    expectColor(actual, { space: actual.space, components, alpha }, tolerance, label);

  // The four hue interpolation methods, both directions around 0 degrees
  // (§13.5).
  const below = "oklch(0.6 0.2 350)", above = "oklch(0.6 0.2 10)";
  expectLiteral(mix("oklch", "shorter", below, above), [0.6, 0.2, 0], 1, 1e-12, "shorter");
  expectLiteral(mix("oklch", "longer", below, above), [0.6, 0.2, 180], 1, 1e-12, "longer");
  expectLiteral(mix("oklch", "increasing", below, above), [0.6, 0.2, 0], 1, 1e-12, "increasing");
  expectLiteral(mix("oklch", "decreasing", below, above), [0.6, 0.2, 180], 1, 1e-12, "decreasing");
  expectLiteral(mix("oklch", "increasing", above, below), [0.6, 0.2, 180], 1, 1e-12, "increasing back");
  expectLiteral(mix("oklch", "decreasing", above, below), [0.6, 0.2, 0], 1, 1e-12, "decreasing back");
  expectLiteral(mix("hsl", "longer", "hsl(350 100% 50%)", "hsl(10 100% 50%)"), [180, 1, 0.5], 1, 1e-12, "hsl longer");
  expectLiteral(mix("hwb", "decreasing", "hwb(10 10% 10%)", "hwb(350 10% 10%)"), [0, 0.1, 0.1], 1, 1e-12, "hwb");

  // A component missing from one color takes the other's value; one missing
  // from both stays missing (§13.4).
  expectLiteral(mix("oklch", "shorter", "oklch(0.7 none 120)", "oklch(0.5 0.2 40)"), [0.6, 0.2, 80], 1, 1e-12, "chroma");
  expectLiteral(mix("lch", "shorter", "lch(50 30 none)", "lch(70 40 90)"), [60, 35, 90], 1, 1e-12, "hue");
  expectLiteral(mix("hsl", "shorter", "hsl(none 50% 50%)", "hsl(120 50% 50%)"), [120, 0.5, 0.5], 1, 1e-12, "hsl hue");
  expectLiteral(mix("oklch", "shorter", "oklch(0.5 0.1 30 / none)", "oklch(0.7 0.1 90 / none)"),
    [0.6, 0.1, 60], null, 1e-12, "alpha");

  // Analogous components carry forward (§13.4): lightness from Lab to
  // OKLCh, hue from LCh to HSL. The §13.4 examples: lab(50% none none)
  // converts to lch(50% none none), rgb(none none none / 50%) to
  // oklab(none none none / 50%).
  assert(converted("lab(none 20 30)", "oklch").components[0] === null, "lightness carries into OKLCh");
  assert(converted("lch(50 40 none)", "hsl").components[0] === null, "hue carries into HSL");
  expectLiteral(converted("lab(50 none none)", "lch"), [50, null, null], 1, 1e-12, "lab(50% none none)");
  expectLiteral(converted("rgb(none none none / 50%)", "oklab"), [null, null, null], 0.5, 0, "rgb(none none none)");
  expectLiteral(converted("oklab(0.5 none none)", "oklch"), [0.5, null, null], 1, 1e-12, "a and b as a set");
  // Whiteness and blackness have no analogues; missing together, they
  // carry into the saturation and lightness, which have none in HWB.
  expectLiteral(converted("hwb(120 none none)", "hsl"), [120, null, null], 1, 0, "hwb(120 none none)");
  expectLiteral(converted("hsl(none none none)", "hwb"), [null, null, null], 1, 0, "hsl(none none none)");
  const partial = converted("hwb(none none 25%)", "hsl");
  expectLiteral(partial, [null, 1, 0.375], 1, 1e-12, "hwb(none none 25%)");

  // Powerless components (§4.4.1) become missing before and after a
  // conversion, at the ε of each space, and the chroma or saturation
  // becomes zero.
  expectLiteral(converted("lch(20 0.0015 180)", "oklch"), [converted("lch(20 0.0015 180)", "oklch").components[0], 0, null],
    1, 0, "LCh chroma 0.0015");
  assert(converted("lch(20 0.00151 180)", "lab").components[1] !== 0, "LCh chroma above 0.0015");
  expectLiteral(converted("oklch(0.2 0.000004 180)", "oklab"), [0.2, 0, 0], 1, 0, "OKLCh chroma 0.000004");
  assert(converted("oklch(0.2 0.0000041 180)", "oklab").components[1] !== 0, "OKLCh chroma above 0.000004");
  expectLiteral(converted("hsl(180 0.001% 50%)", "srgb"), [0.5, 0.5, 0.5], 1, 0, "HSL saturation 0.001%");
  assert(converted("hsl(180 0.0011% 50%)", "srgb").components[0] !== 0.5, "HSL saturation above 0.001%");
  // A negative saturation clamps to 0% at parsed-value time (CSS Color 4
  // §7): a gray of the lightness.
  expectLiteral(converted("hsl(0 -50% 40%)", "srgb"), [0.4, 0.4, 0.4], 1, 1e-12, "HSL saturation -50%");
  expectLiteral(converted("hsl(30 -50 60)", "srgb"), [0.6, 0.6, 0.6], 1, 1e-12, "HSL saturation -50");
  // hwb(180 49.999% 50%): the blackness completes the sum to 100%.
  expectLiteral(converted("hwb(180 49.999% 50%)", "hsl"), [null, 0, 0.49999], 1, 1e-12, "HWB sum 99.999%");
  assert(converted("hwb(180 49.998% 50%)", "hsl").components[0] === 180, "HWB sum below 99.999%");
  // hwb(180 99.999% none): the whiteness becomes 100%.
  expectLiteral(converted("hwb(180 99.999% none)", "hsl"), [null, 0, 1], 1, 1e-12, "HWB missing blackness");
  exports.color_mix_operand_from_srgb(first, 1, 1, 1, 1);
  assert(exports.color_mix_convert(first, space.oklch, second) === 1, "white to OKLCh");
  expectLiteral(read(second), [read(second).components[0], 0, null], 1, 0, "white has no OKLCh hue");
  assert(exports.color_mix_convert(first, space.hwb, second) === 1, "white to HWB");
  expectLiteral(read(second), [null, 1, 0], 1, 0, "white has no HWB hue");
  exports.color_mix_operand_from_srgb(first, 0.5, 0.5, 0.5, 1);
  assert(exports.color_mix_convert(first, space.lch, second) === 1, "gray to LCh");
  expectLiteral(read(second), [read(second).components[0], 0, null], 1, 0, "gray has no LCh hue");
  // In its own space a powerless hue stays (no conversion).
  expectLiteral(mix("hsl", "shorter", "hsl(180 0% 50%)", "hsl(10 30% 50%)"), [95, 0.15, 0.5], 1, 1e-12, "own space");

  // A polar operand converts to its own rectangular form directly.
  expectLiteral(converted("oklch(0.145 0 0)", "oklab"), [0.145, 0, 0], 1, 0, "OKLCh to OKLab");
  expectLiteral(converted("lch(40 0 0)", "lab"), [40, 0, 0], 1, 0, "LCh to Lab");

  // rec2020 has the gamma 2.4 transfer of BT.1886 (CSS Color 4 §10.8).
  expectLiteral(converted("color(rec2020 0.25 0.5 0.75)", "srgb"),
    [-0.32868637090395064, 0.4912012882291091, 0.7618517462526327], 1, 1e-9, "rec2020 to sRGB");

  // Premultiplied alpha and an alpha multiplier below one: lightness and
  // chroma premultiply, the hue does not. Interpolation does not clamp.
  mix("oklch", "shorter", "oklch(0.5 0.1 30 / 0.3)", "oklch(0.7 0.2 90 / 0.8)", 0.6, 0.6);
  mix("oklch", "shorter", "oklch(0.5 0.1 30)", "oklch(0.7 0.1 90)", 0.5, 0.4);
  const transparentMix = mix("hsl", "shorter", "rgb(0 0 0 / 0)", "hsl(240 100% 50%)");
  expectLiteral(transparentMix, [240, 1, 0.5], 0.5, 1e-12, "transparent keeps its alpha");
  mix("lch", "shorter", "oklch(0 0.2 0)", "lch(0 0 0)", 0.5);
  mix("lab", "shorter", "lab(0 20 30)", "oklab(0 0 0)", 0.5);

  // Results convert to sRGB in VEC with missing components as zero.
  for (const text of ["hwb(30 20% 30%)", "hsl(200 40% 60%)", "lch(50 40 none)", "oklab(0.6 0.1 -0.1)",
    "color(rec2020 0.3 0.6 0.9)", "color(prophoto-rgb 0.3 0.6 0.9)", "color(xyz-d50 0.3 0.4 0.5)"]) {
    operand(text, first);
    const expected = toSrgb(read(first));
    assert(exports.color_mix_to_srgb(first) === 1, `${text} to sRGB`);
    expected.forEach((value, index) =>
      assert(Math.abs(vector(runtime)[index] - value) <= 1e-9, `${text} sRGB[${index}]: ${vector(runtime)[index]}`)
    );
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
  const record = new Int32Array(runtime.memory.buffer, g("color_parse_result_offset"), 20);
  assert(record[g("color_parse_missing") / 4] === 0, "hsl conversion mask");
  assert(record[g("color_parse_authored_missing") / 4] === 1, "hsl authored mask");
  runtime.free(first);
  runtime.free(second);
  runtime.free(result);
});

Deno.test("the legacy comma syntax takes no none (CSS Color 4 §4.4)", async () => {
  const { exports, memory } = await standalone();
  const parse = (text) => {
    const bytes = new TextEncoder().encode(text);
    new Uint8Array(memory.buffer, globalValue(exports, "color_parse_input_offset"), bytes.length).set(bytes);
    return exports.color_parse_css(bytes.length);
  };
  for (const text of ["hsla(120, 100%, 50%, none)", "rgb(255, 255, 255, none)", "rgba(0, 0, 0, none)",
    "hsl(none, 100%, 50%)", "rgb(0, none, 0)", "hsl(120, 100%, none)"]) {
    assert(parse(text) === globalValue(exports, "color_css_error_structure"), `${text} is invalid`);
  }
  for (const text of ["hsl(120 100% 50% / none)", "rgb(255 255 255 / none)", "rgb(none 0 0)"]) {
    assert(parse(text) === 0, `${text} is valid`);
  }
});

// Only rgb() and hsl() have the legacy comma syntax (CSS Color 4 §5.1,
// §7.1), and only the hue of lch() and oklch() takes an angle (§8, §9).
Deno.test("the comma syntax and angles parse only where CSS Color 4 takes them", async () => {
  const { exports, memory } = await standalone();
  const parse = (text) => {
    const bytes = new TextEncoder().encode(text);
    new Uint8Array(memory.buffer, globalValue(exports, "color_parse_input_offset"), bytes.length).set(bytes);
    return exports.color_parse_css(bytes.length);
  };
  for (const text of ["color(srgb 0, 0, 0)", "lab(40, 0, 0)", "oklch(0.5, 0.1, 30)", "hwb(120, 30%, 50%)",
    "lab(40% 0 0deg)", "oklab(40% 0 0deg)", "lab(40% 0deg 0)", "lch(40deg 10 30)", "oklch(0.5 0.1deg 30)"]) {
    assert(parse(text) !== 0, `${text} is invalid`);
  }
  for (const text of ["rgb(0, 0, 0)", "hsl(120, 50%, 50%)", "lch(40 10 30deg)", "oklch(0.5 0.1 30deg)", "color(srgb 0 0 0)"]) {
    assert(parse(text) === 0, `${text} is valid`);
  }
});

// color-mix() of each predefined space: a stop in OKLab, sRGB, LCh, Lab,
// OKLCh, HSL and HWB mixes, with components below zero, above one, and on
// both segments of each transfer function, and mixes in each predefined
// space. `xyz` is xyz-d65.
const PREDEFINED_SPACE_MIXES = [
  "color-mix(in oklab, color(display-p3 1 0 0), blue)",
  "color-mix(in lch, color(display-p3 0.82 0.31 0.07), blue)",
  "color-mix(in lab, color(display-p3 -0.05 0.6 1.1) 30%, color(display-p3 0.02 0.5 0.95))",
  "color-mix(in hwb, color(display-p3 0.02 0.5 0.95), black)",
  ...["srgb-linear", "display-p3-linear", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d50", "xyz-d65", "xyz"]
    .flatMap((name) => [
      `color-mix(in oklab, color(${name} 0.82 0.31 0.07), blue)`,
      `color-mix(in srgb, color(${name} 0.82 0.31 0.07), blue)`,
      `color-mix(in lch, color(${name} 0.82 0.31 0.07), blue)`,
      `color-mix(in lab, color(${name} -0.05 0.6 1.1) 30%, color(${name} 0.02 0.5 0.95))`,
      `color-mix(in oklch, color(${name} 0.02 0.5 0.95), color(${name} 0.82 0.31 0.07) 25%)`,
      `color-mix(in hsl, color(${name} 0.82 0.31 0.07), white)`,
      `color-mix(in hwb, color(${name} 0.02 0.5 0.95), black)`,
      `color-mix(in srgb, color(${name} -0.05 0.6 1.1), red)`,
    ]),
  "color-mix(in srgb, color(display-p3 none 0.5 0.2), red)",
  "color-mix(in lab, color(rec2020 0.3 none 0.6 / 0.5), color(xyz-d50 0.2 0.3 0.4 / none))",
  "color-mix(in srgb-linear, oklch(0.7 0.2 30 / 0.6) 30%, color(display-p3 0.1 0.8 0.3))",
  "color-mix(in srgb-linear, color(srgb none 0.5 0.2), blue)",
  "color-mix(in display-p3, red, blue)",
  "color-mix(in display-p3, oklch(0.7 0.2 30 / 0.6) 30%, color(rec2020 0.1 0.8 0.3))",
  "color-mix(in display-p3, color(srgb none 0.5 0.2), blue)",
  "color-mix(in display-p3-linear, lab(60 40 -30) 70%, hsl(120 50% 40% / 0.5))",
  "color-mix(in a98-rgb, oklch(0.7 0.2 30 / 0.6) 30%, color(display-p3 0.1 0.8 0.3))",
  "color-mix(in prophoto-rgb, lab(60 40 -30) 70%, hsl(120 50% 40% / 0.5))",
  "color-mix(in rec2020, red, blue)",
  "color-mix(in rec2020, rgb(10 20 30), color(xyz-d50 0.2 0.3 0.4))",
  "color-mix(in xyz-d50, color(xyz-d50 none 0.5 0.2), color(xyz-d65 0.3 0.2 0.1))",
  "color-mix(in xyz-d65, white, black)",
];

Deno.test("color-mix keeps a color() stop in its predefined space and converts it as CSS Color 4 does", async () => {
  const runtime = await standalone();
  const { exports } = runtime;
  const { g, operand, read, expectColor } = mixHarness(runtime);
  const size = g("color_mix_operand_size");
  const first = runtime.alloc(size);
  const second = runtime.alloc(size);
  const result = runtime.alloc(size);
  for (const value of PREDEFINED_SPACE_MIXES) {
    const [named, ...stops] = value.slice("color-mix(in ".length, -1).split(", ");
    const into = named === "xyz" ? "xyz-d65" : named;
    const [[firstText, firstShare], [secondText, secondShare]] = stops.map((stop) => {
      const [, text, share] = stop.match(/^(.*?)(?: ([\d.]+)%)?$/);
      return [text, share === undefined ? null : Number(share) / 100];
    });
    const firstPart = firstShare ?? (secondShare === null ? 0.5 : 1 - secondShare);
    const secondPart = secondShare ?? (firstShare === null ? 0.5 : 1 - firstShare);
    const sum = firstPart + secondPart;
    operand(firstText, first);
    operand(secondText, second);
    const expected = interpolate(convert(read(first), into), convert(read(second), into),
      "shorter", secondPart / sum, Math.min(sum, 1));
    assert(exports.color_mix_convert(first, SPACES.indexOf(into), first) === 1, `${firstText} converts`);
    assert(exports.color_mix_convert(second, SPACES.indexOf(into), second) === 1, `${secondText} converts`);
    assert(
      exports.color_mix_interpolate(first, second, 0, secondPart / sum, Math.min(sum, 1), result) === 1,
      `${value} interpolates`,
    );
    expectColor(read(result), expected, 1e-9, value);
  }

  // A color() stop keeps its authored space and components.
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
    const { components, space: kept } = read(first);
    assert(kept === SPACES[g(`color_mix_space_${space}`)], `${text} keeps its space, not ${kept}`);
    const authored = text.match(/ ([\d.]+) ([\d.]+) ([\d.]+)\)$/).slice(1).map(Number);
    authored.forEach((value, index) =>
      assert(components[index] === value, `${text}[${index}] is ${components[index]}`)
    );
  }
  runtime.free(first);
  runtime.free(second);
  runtime.free(result);
});
