// Kernel results against published standard anchors: BT.709 and BT.2020
// luma, white points, Bradford adaptation, sRGB, PQ and HLG (BT.2100,
// BT.2408), Lab, OKLab, CSS Color 4 reference conversions, BT.2390 tone
// mapping and CSS Color 4 gamut mapping. Each expected value is a published
// number or a definition; the tolerances are those of the publications.
import { assert, globalValue, standalone } from "./test-helpers.js";

const runtime = await standalone();
const { exports } = runtime;

// Matrix indices of color_matrix_read and apply_matrix (docs/abi.md).
const MATRIX = Object.freeze({
  srgb: Object.freeze({ toXyz: 0, fromXyz: 1 }),
  "display-p3": Object.freeze({ toXyz: 2, fromXyz: 3 }),
  rec2020: Object.freeze({ toXyz: 4, fromXyz: 5 }),
  "a98-rgb": Object.freeze({ toXyz: 6, fromXyz: 7 }),
  "prophoto-rgb": Object.freeze({ toXyz: 8, fromXyz: 9 }),
});
const ADAPT_D50_TO_D65 = 10;
const ADAPT_D65_TO_D50 = 11;

// CSS Color 4 white points from their chromaticities (x, y).
const XYZ_WHITE_D50 = Object.freeze([0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585]);
const XYZ_WHITE_D65 = Object.freeze([0.3127 / 0.329, 1, (1 - 0.3127 - 0.329) / 0.329]);
const REFERENCE_WHITE_LUMINANCE = 203;

function vectorOperation(vector, run) {
  const values = new Float64Array(
    runtime.memory.buffer,
    globalValue(exports, "color_vec_offset"),
    3,
  );
  values.set(vector);
  run();
  return Array.from(values);
}

function applyMatrix(index, vector) {
  return vectorOperation(vector, () => exports.apply_matrix(index));
}

const decodeSrgbTransfer = exports.srgb_decode;
const encodeSrgbTransfer = exports.srgb_encode;
const pqSignalToLuminance = exports.pq_signal_to_luminance;
const luminanceToPqSignal = exports.luminance_to_pq_signal;
const decodePqToWorkingScale = exports.pq_to_working;
const encodeWorkingScaleToPq = exports.working_to_pq;
const hlgSignalToSceneLight = exports.hlg_signal_to_scene;
const sceneLightToHlgSignal = exports.scene_to_hlg_signal;

const convertLinearRgbToXyz = (primaries, rgb) => applyMatrix(MATRIX[primaries].toXyz, rgb);
const convertXyzToLinearRgb = (primaries, xyz) => applyMatrix(MATRIX[primaries].fromXyz, xyz);
const convertXyzD50ToXyzD65 = (xyz) => applyMatrix(ADAPT_D50_TO_D65, xyz);
const convertXyzD65ToXyzD50 = (xyz) => applyMatrix(ADAPT_D65_TO_D50, xyz);
const convertXyzD65ToWorking = (xyz) => applyMatrix(MATRIX.rec2020.fromXyz, xyz);
const convertWorkingToXyzD65 = (rgb) => applyMatrix(MATRIX.rec2020.toXyz, rgb);
const convertLabToXyzD50 = (lab) => vectorOperation(lab, () => exports.lab_to_xyz_d50());
const convertXyzD50ToLab = (xyz) => vectorOperation(xyz, () => exports.xyz_d50_to_lab());
const convertXyzD65ToOklab = (xyz) => vectorOperation(xyz, () => exports.xyz_d65_to_oklab());
const decodeHlgRgbToWorkingScale = (rgb) =>
  vectorOperation(rgb, () => exports.hlg_rgb_to_working());
const toneMapBt2390 = (rgb, sourcePeak, targetPeak) =>
  vectorOperation(rgb, () => exports.tone_map_bt2390(sourcePeak, targetPeak));

// The tagged route with the linear transfer function: linear-light RGB in a
// named primary set into working linear Rec. 2020.
function convertLinearRgbToWorking(primaries, rgb) {
  const code = globalValue(exports, `color_primaries_${primaries.replaceAll("-", "_")}`);
  return vectorOperation(rgb, () => {
    assert(
      exports.color_convert_tagged_to_working(
        code,
        globalValue(exports, "color_transfer_linear"),
        1,
        0,
      ) === 1,
      `linear ${primaries} route accepted`,
    );
  });
}

// Destination sRGB: XYZ to sRGB, sRGB to XYZ, D65 destination white.
function gamutMapCssColor4(workingRgb, destinationPrimaries) {
  const { toXyz, fromXyz } = MATRIX[destinationPrimaries];
  return vectorOperation(
    workingRgb,
    () => exports.gamut_map_css_color_4(fromXyz, toXyz, 0),
  );
}

// Polar form of an OKLab value: lightness, chroma, hue in degrees. The
// tests use it to measure hue and chroma of kernel results.
function convertOklabToOklch([lightness, aAxis, bAxis]) {
  const hue = Math.atan2(bAxis, aAxis) * 180 / Math.PI;
  return [lightness, Math.hypot(aAxis, bAxis), hue < 0 ? hue + 360 : hue];
}

function assertClose(actual, expected, tolerance, label) {
  assert(
    Math.abs(actual - expected) <= tolerance,
    `${label}: expected ${expected} ± ${tolerance}, got ${actual}`,
  );
}

function assertVectorClose(actual, expected, tolerance, label) {
  for (let index = 0; index < expected.length; index += 1) {
    assertClose(actual[index], expected[index], tolerance, `${label}[${index}]`);
  }
}

Deno.test('derived RGB matrices reproduce the BT.709 and BT.2020 luma coefficients', () => {
  // The Y row of each RGB-to-XYZ matrix is the standard luma vector.
  const srgbRed = convertLinearRgbToXyz('srgb', [1, 0, 0]);
  const srgbGreen = convertLinearRgbToXyz('srgb', [0, 1, 0]);
  const srgbBlue = convertLinearRgbToXyz('srgb', [0, 0, 1]);
  assertVectorClose([srgbRed[1], srgbGreen[1], srgbBlue[1]], [0.2126, 0.7152, 0.0722], 5e-5, 'BT.709 luma');
  const recRed = convertLinearRgbToXyz('rec2020', [1, 0, 0]);
  const recGreen = convertLinearRgbToXyz('rec2020', [0, 1, 0]);
  const recBlue = convertLinearRgbToXyz('rec2020', [0, 0, 1]);
  assertVectorClose([recRed[1], recGreen[1], recBlue[1]], [0.2627, 0.678, 0.0593], 5e-5, 'BT.2020 luma');
});

Deno.test('white maps exactly onto white through every primary set', () => {
  assertVectorClose(convertLinearRgbToXyz('srgb', [1, 1, 1]), XYZ_WHITE_D65, 1e-12, 'sRGB white to XYZ');
  assertVectorClose(convertLinearRgbToWorking('srgb', [1, 1, 1]), [1, 1, 1], 1e-9, 'sRGB white to working');
  assertVectorClose(convertLinearRgbToWorking('display-p3', [1, 1, 1]), [1, 1, 1], 1e-9, 'P3 white to working');
  // ProPhoto is D50-defined; its white must survive Bradford adaptation.
  assertVectorClose(
    convertLinearRgbToWorking('prophoto-rgb', [1, 1, 1]),
    [1, 1, 1],
    1e-9,
    'ProPhoto white to working',
  );
});

Deno.test('Bradford adaptation carries D50 white onto D65 white and back', () => {
  assertVectorClose(convertXyzD50ToXyzD65(XYZ_WHITE_D50), XYZ_WHITE_D65, 1e-12, 'D50 to D65');
  assertVectorClose(
    convertXyzD65ToXyzD50(convertXyzD50ToXyzD65([0.2, 0.5, 0.4])),
    [0.2, 0.5, 0.4],
    1e-12,
    'adaptation round trip',
  );
});

Deno.test('sRGB transfer function matches its breakpoints and mirrors negatives', () => {
  assertClose(decodeSrgbTransfer(0.04045), 0.04045 / 12.92, 1e-12, 'linear segment end');
  assertClose(decodeSrgbTransfer(1), 1, 1e-12, 'decode of one');
  assertClose(encodeSrgbTransfer(1), 1, 1e-12, 'encode of one');
  assertClose(decodeSrgbTransfer(-0.5), -decodeSrgbTransfer(0.5), 1e-12, 'point symmetry');
  for (const value of [-1.2, -0.3, 0, 0.0031308, 0.5, 1, 1.7]) {
    assertClose(encodeSrgbTransfer(decodeSrgbTransfer(value)), value, 1e-12, `round trip ${value}`);
  }
});

Deno.test('PQ matches its BT.2100 anchors and the 203-candela reference white', () => {
  assertClose(pqSignalToLuminance(1), 10000, 1e-6, 'coding peak');
  assertClose(luminanceToPqSignal(10000), 1, 1e-12, 'peak signal');
  // BT.2408: the 203-candela reference white codes near signal 0.58.
  assertClose(luminanceToPqSignal(REFERENCE_WHITE_LUMINANCE), 0.5806888, 5e-4, 'reference white signal');
  assertClose(decodePqToWorkingScale(0.5806888), 1, 2e-3, 'reference white decodes to one');
  for (const luminance of [0.1, 1, 100, 203, 1000, 4000]) {
    assertClose(
      pqSignalToLuminance(luminanceToPqSignal(luminance)),
      luminance,
      luminance * 1e-9,
      `round trip ${luminance}`,
    );
  }
  assertClose(encodeWorkingScaleToPq(1), luminanceToPqSignal(203), 1e-12, 'working-scale encode');
});

Deno.test('HLG matches its BT.2100 breakpoints and reference display transform', () => {
  assertClose(hlgSignalToSceneLight(0.5), 1 / 12, 1e-12, 'signal half is one twelfth');
  assertClose(hlgSignalToSceneLight(1), 1, 1e-4, 'full signal is full scene light');
  for (const signal of [0.1, 0.5, 0.75, 1]) {
    assertClose(
      sceneLightToHlgSignal(hlgSignalToSceneLight(signal)),
      signal,
      1e-9,
      `round trip ${signal}`,
    );
  }
  // Full white: 1000-candela display peak on the 203-candela working scale.
  const white = decodeHlgRgbToWorkingScale([1, 1, 1]);
  assertVectorClose(white, [1000 / 203, 1000 / 203, 1000 / 203], 2e-3, 'HLG white');
});

Deno.test('Lab is D50-anchored and reaches the working space through adaptation', () => {
  assertVectorClose(convertXyzD50ToLab(XYZ_WHITE_D50), [100, 0, 0], 1e-9, 'D50 white Lab');
  const workingWhite = convertXyzD65ToWorking(
    convertXyzD50ToXyzD65(convertLabToXyzD50([100, 0, 0])),
  );
  assertVectorClose(workingWhite, [1, 1, 1], 1e-9, 'Lab white to working white');
});

// CSS Color 4 OKLab matrices (conversions.js): XYZtoLMS, LMStoXYZ,
// LMStoOKLab and OKLabtoLMS, which are kernel matrices 12 to 15.
const CSS_COLOR_4_OKLAB_MATRICES = Object.freeze([
  [0.8190224379967030, 0.3619062600528904, -0.1288737815209879,
    0.0329836539323885, 0.9292868615863434, 0.0361446663506424,
    0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647,
    -0.0405757452148008, 1.1122868032803170, -0.0717110580655164,
    -0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
  [0.2104542683093140, 0.7936177747023054, -0.0040720430116193,
    1.9779985324311684, -2.4285922420485799, 0.4505937096174110,
    0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
  [1.0000000000000000, 0.3963377773761749, 0.2158037573099136,
    1.0000000000000000, -0.1055613458156586, -0.0638541728258133,
    1.0000000000000000, -0.0894841775298119, -1.2914855480194092],
]);

// oklab(from <color> l a b) of the pinned Chrome (Chrome/151.0.7922.174),
// six significant digits. Chrome converts with skcms's single-precision
// sRGB matrix and its OKLab literals, which color_mix_convert reproduces.
const CHROME_OKLAB = Object.freeze([
  ['white', [1, 1, 1], [0.999994, 0.0000455678, 0.0000200868]],
  ['red', [1, 0, 0], [0.627966, 0.22488, 0.125859]],
  ['lime', [0, 1, 0], [0.866435, -0.23384, 0.179502]],
  ['blue', [0, 0, 1], [0.451981, -0.0324624, -0.311523]],
  ['cyan', [0, 1, 1], [0.905387, -0.149403, -0.0393822]],
  ['magenta', [1, 0, 1], [0.701669, 0.274594, -0.169133]],
  ['yellow', [1, 1, 0], [0.967983, -0.0713198, 0.198578]],
]);

Deno.test('OKLab carries the CSS Color 4 constants and matches its published reference values', () => {
  const pointer = runtime.alloc(72);
  try {
    CSS_COLOR_4_OKLAB_MATRICES.forEach((expected, offset) => {
      assert(exports.color_matrix_read(12 + offset, pointer, 72) === 1, `matrix ${12 + offset} copied`);
      const actual = new Float64Array(runtime.memory.buffer, pointer, 9);
      expected.forEach((value, index) => {
        assert(Object.is(actual[index], value), `matrix ${12 + offset}[${index}]: expected ${value}, got ${actual[index]}`);
      });
    });
  } finally {
    runtime.free(pointer);
  }
  const white = convertXyzD65ToOklab(XYZ_WHITE_D65);
  assertVectorClose(white, [1, 0, 0], 1e-9, 'D65 white OKLab');
  // Published reference: sRGB red is oklch(0.6280 0.2577 29.23).
  const redXyz = convertLinearRgbToXyz('srgb', [1, 0, 0]);
  const redOklch = convertOklabToOklch(convertXyzD65ToOklab(redXyz));
  assertClose(redOklch[0], 0.6279554, 2e-3, 'red lightness');
  assertClose(redOklch[1], 0.2576833, 2e-3, 'red chroma');
  assertClose(redOklch[2], 29.2338, 0.2, 'red hue');
});

Deno.test('color-mix() arithmetic converts the sRGB primaries to the OKLab of the pinned Chrome', () => {
  const operand = runtime.alloc(globalValue(exports, 'color_mix_operand_size'));
  try {
    for (const [name, srgb, chrome] of CHROME_OKLAB) {
      assert(exports.color_mix_operand_from_srgb(operand, ...srgb, 1) === 1, `${name} operand`);
      assert(exports.color_mix_convert(operand, globalValue(exports, 'color_mix_space_oklab'), operand) === 1, `${name} converts`);
      assertVectorClose(new Float64Array(runtime.memory.buffer, operand, 3), chrome, 1e-6, `${name} OKLab`);
    }
  } finally {
    runtime.free(operand);
  }
});

Deno.test('Display P3 red lands at the published out-of-sRGB coordinates', () => {
  const xyz = convertLinearRgbToXyz('display-p3', [1, 0, 0]);
  const encoded = convertXyzToLinearRgb('srgb', xyz).map(encodeSrgbTransfer);
  // CSS Color 4 reference conversion of color(display-p3 1 0 0).
  assertVectorClose(encoded, [1.0929, -0.2267, -0.1501], 3e-3, 'P3 red in sRGB');
});

Deno.test('BT.2390 tone map preserves below the knee and lands the peak on target', () => {
  const sourcePeak = 1000;
  const targetPeak = 203;
  // A dim pixel below the knee survives unchanged.
  const dim = [0.08, 0.05, 0.02];
  assertVectorClose(toneMapBt2390(dim, sourcePeak, targetPeak), dim, 1e-6, 'below knee');
  // The source peak maps exactly onto the target peak.
  const peak = toneMapBt2390(
    [sourcePeak / 203, sourcePeak / 203, sourcePeak / 203],
    sourcePeak,
    targetPeak,
  );
  assertVectorClose(peak, [1, 1, 1], 1e-6, 'peak to target');
  // A midtone above the knee reduces without changing channel ratios.
  const mid = [3, 1.5, 0.75];
  const mapped = toneMapBt2390(mid, sourcePeak, targetPeak);
  assert(mapped[0] < mid[0], 'above-knee value reduces');
  assertClose(mapped[1] / mapped[0], mid[1] / mid[0], 1e-9, 'ratio green over red');
  assertClose(mapped[2] / mapped[0], mid[2] / mid[0], 1e-9, 'ratio blue over red');
  assert(toneMapBt2390([0, 0, 0], sourcePeak, targetPeak).every((v) => v === 0), 'black stays black');
});

Deno.test('CSS Color 4 gamut map returns in-gamut colors unchanged', () => {
  const inGamut = convertLinearRgbToWorking('srgb', [0.2, 0.4, 0.6]);
  const mapped = gamutMapCssColor4(inGamut, 'srgb');
  assertVectorClose(mapped, [0.2, 0.4, 0.6], 1e-9, 'in-gamut identity');
});

Deno.test('CSS Color 4 gamut map brings Rec. 2020 green into sRGB with its hue kept', () => {
  const wideGreen = [0, 1, 0];
  const mapped = gamutMapCssColor4(wideGreen, 'srgb');
  assert(mapped.every((channel) => channel >= 0 && channel <= 1), 'result is inside sRGB');
  assert(mapped[1] > 0.7, 'green channel stays dominant');
  const sourceOklch = convertOklabToOklch(
    convertXyzD65ToOklab(convertWorkingToXyzD65(wideGreen)),
  );
  const mappedOklch = convertOklabToOklch(
    convertXyzD65ToOklab(convertLinearRgbToXyz('srgb', mapped)),
  );
  assertClose(mappedOklch[2], sourceOklch[2], 4, 'hue within four degrees');
  assert(mappedOklch[1] < sourceOklch[1], 'chroma reduced, not clipped arbitrarily');
});
