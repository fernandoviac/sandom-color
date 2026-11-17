// CSS Color 4 reference arithmetic for the color-mix() tests: the sample
// code of CSS Color 4 §19 (conversions.js, the HSL and HWB functions of §7
// and §8, powerlessToMissing), the conversion algorithm of §11.2, the
// carrying forward of missing components of §13.4 and the interpolation of
// §13.3 to §13.5. A color is { space, components, alpha } in the kernel's
// operand units (HSL and HWB saturation, lightness, whiteness and blackness
// as fractions), null for a missing component.

export const SPACES = Object.freeze([
  "srgb", "oklab", "lab", "oklch", "lch", "hsl", "hwb", "srgb-linear", "display-p3",
  "display-p3-linear", "a98-rgb", "prophoto-rgb", "rec2020", "xyz-d50", "xyz-d65",
]);

const D50 = [0.3457 / 0.3585, 1.00000, (1.0 - 0.3457 - 0.3585) / 0.3585];

const multiply = (matrix, vector) =>
  matrix.map((row) => row[0] * vector[0] + row[1] * vector[1] + row[2] * vector[2]);

const signed = (value, magnitude) => (value < 0 ? -1 : 1) * magnitude(Math.abs(value));

const linSrgb = (value) => Math.abs(value) <= 0.04045
  ? value / 12.92
  : signed(value, (abs) => Math.pow((abs + 0.055) / 1.055, 2.4));
const gamSrgb = (value) => Math.abs(value) > 0.0031308
  ? signed(value, (abs) => 1.055 * Math.pow(abs, 1 / 2.4) - 0.055)
  : 12.92 * value;
const linProPhoto = (value) => Math.abs(value) <= 16 / 512
  ? value / 16
  : signed(value, (abs) => Math.pow(abs, 1.8));
const gamProPhoto = (value) => Math.abs(value) >= 1 / 512
  ? signed(value, (abs) => Math.pow(abs, 1 / 1.8))
  : 16 * value;
const gamma = (exponent) => (value) => signed(value, (abs) => Math.pow(abs, exponent));
const identity = (value) => value;

const SRGB_TO_XYZ = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const XYZ_TO_SRGB = [
  [12831 / 3959, -329 / 214, -1974 / 3959],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [705 / 12673, -2585 / 12673, 705 / 667],
];
const P3_TO_XYZ = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0 / 1, 32229 / 714400, 5220557 / 5000800],
];
const XYZ_TO_P3 = [
  [446124 / 178915, -333277 / 357830, -72051 / 178915],
  [-14852 / 17905, 63121 / 35810, 423 / 17905],
  [11844 / 330415, -50337 / 660830, 316169 / 330415],
];
const PROPHOTO_TO_XYZ_D50 = [
  [0.79776664490064230, 0.13518129740053308, 0.03134773412839220],
  [0.28807482881940130, 0.71183523424187300, 0.00008993693872564],
  [0.00000000000000000, 0.00000000000000000, 0.82510460251046020],
];
const XYZ_D50_TO_PROPHOTO = [
  [1.34578688164715830, -0.25557208737979464, -0.05110186497554526],
  [-0.54463070512490190, 1.50824774284514680, 0.02052744743642139],
  [0.00000000000000000, 0.00000000000000000, 1.21196754563894520],
];
const A98_TO_XYZ = [
  [573536 / 994567, 263643 / 1420810, 187206 / 994567],
  [591459 / 1989134, 6239551 / 9945670, 374412 / 4972835],
  [53769 / 1989134, 351524 / 4972835, 4929758 / 4972835],
];
const XYZ_TO_A98 = [
  [1829569 / 896150, -506331 / 896150, -308931 / 896150],
  [-851781 / 878810, 1648619 / 878810, 36519 / 878810],
  [16779 / 1248040, -147721 / 1248040, 1266979 / 1248040],
];
const REC2020_TO_XYZ = [
  [63426534 / 99577255, 20160776 / 139408157, 47086771 / 278816314],
  [26158966 / 99577255, 472592308 / 697040785, 8267143 / 139408157],
  [0 / 1, 19567812 / 697040785, 295819943 / 278816314],
];
const XYZ_TO_REC2020 = [
  [30757411 / 17917100, -6372589 / 17917100, -4539589 / 17917100],
  [-19765991 / 29648200, 47925759 / 29648200, 467509 / 29648200],
  [792561 / 44930125, -1921689 / 44930125, 42328811 / 44930125],
];
const D65_TO_D50 = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const D50_TO_D65 = [
  [0.955473421488075, -0.02309845494876471, 0.06325924320057072],
  [-0.0283697093338637, 1.0099953980813041, 0.021041441191917323],
  [0.012314014864481998, -0.020507649298898964, 1.330365926242124],
];
const XYZ_TO_LMS = [
  [0.8190224379967030, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB = [
  [0.2104542683093140, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.4285922420485799, 0.4505937096174110],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const LMS_TO_XYZ = [
  [1.2268798758459243, -0.5578149944602171, 0.2813910456659647],
  [-0.0405757452148008, 1.1122868032803170, -0.0717110580655164],
  [-0.0763729366746601, -0.4214933324022432, 1.5869240198367816],
];
const OKLAB_TO_LMS = [
  [1.0000000000000000, 0.3963377773761749, 0.2158037573099136],
  [1.0000000000000000, -0.1055613458156586, -0.0638541728258133],
  [1.0000000000000000, -0.0894841775298119, -1.2914855480194092],
];

// Each RGB or XYZ space: its transfer pair, its matrices to and from XYZ,
// and whether that XYZ is D50.
const RGB_SPACES = {
  srgb: [linSrgb, gamSrgb, SRGB_TO_XYZ, XYZ_TO_SRGB, false],
  "srgb-linear": [identity, identity, SRGB_TO_XYZ, XYZ_TO_SRGB, false],
  "display-p3": [linSrgb, gamSrgb, P3_TO_XYZ, XYZ_TO_P3, false],
  "display-p3-linear": [identity, identity, P3_TO_XYZ, XYZ_TO_P3, false],
  "a98-rgb": [gamma(563 / 256), gamma(256 / 563), A98_TO_XYZ, XYZ_TO_A98, false],
  "prophoto-rgb": [linProPhoto, gamProPhoto, PROPHOTO_TO_XYZ_D50, XYZ_D50_TO_PROPHOTO, true],
  rec2020: [gamma(2.4), gamma(1 / 2.4), REC2020_TO_XYZ, XYZ_TO_REC2020, false],
  "xyz-d50": [identity, identity, null, null, true],
  "xyz-d65": [identity, identity, null, null, false],
};

function labToXyzD50([l, a, b]) {
  const κ = 24389 / 27, ε = 216 / 24389;
  const lightness116 = l / 116, a500 = a / 500, b200 = b / 200;
  const f1 = lightness116 + 16 / 116, f0 = f1 + a500, f2 = f1 - b200;
  return [
    Math.pow(f0, 3) > ε ? Math.pow(f0, 3) : (lightness116 + a500) * (116 / κ),
    l > κ * ε ? Math.pow((l + 16) / 116, 3) : l / κ,
    Math.pow(f2, 3) > ε ? Math.pow(f2, 3) : (lightness116 - b200) * (116 / κ),
  ].map((value, index) => value * D50[index]);
}

function xyzD50ToLab(xyz) {
  const ε = 216 / 24389, κ = 24389 / 27;
  const f = xyz.map((value, index) => value / D50[index])
    .map((value) => value > ε ? Math.cbrt(value) : (κ * value + 16) / 116);
  return [116 * f[1] - 16, 500 * (f[0] - f[1]), 200 * (f[1] - f[2])];
}

function rectangularToXyzD65(space, components) {
  if (space === "oklab") return multiply(LMS_TO_XYZ, multiply(OKLAB_TO_LMS, components).map((c) => c ** 3));
  if (space === "lab") return multiply(D50_TO_D65, labToXyzD50(components));
  const [decode, , toXyz, , d50] = RGB_SPACES[space];
  const linear = components.map(decode);
  const xyz = toXyz ? multiply(toXyz, linear) : linear;
  return d50 ? multiply(D50_TO_D65, xyz) : xyz;
}

function xyzD65ToRectangular(space, xyz) {
  if (space === "oklab") return multiply(LMS_TO_OKLAB, multiply(XYZ_TO_LMS, xyz).map(Math.cbrt));
  if (space === "lab") return xyzD50ToLab(multiply(D65_TO_D50, xyz));
  const [, encode, , fromXyz, d50] = RGB_SPACES[space];
  const adapted = d50 ? multiply(D65_TO_D50, xyz) : xyz;
  return (fromXyz ? multiply(fromXyz, adapted) : adapted).map(encode);
}

function hslToRgb(hue, sat, light) {
  const f = (n) => {
    const k = (n + hue / 30) % 12;
    const a = sat * Math.min(light, 1 - light);
    return light - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0), f(8), f(4)];
}

function hwbToRgb(hue, white, black) {
  if (white + black >= 1) {
    const gray = white / (white + black);
    return [gray, gray, gray];
  }
  return hslToRgb(hue, 1, 0.5).map((value) => value * (1 - white - black) + white);
}

function rgbToHue(red, green, blue) {
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  const d = max - min;
  let hue = NaN;
  if (d !== 0) {
    if (max === red) hue = (green - blue) / d + (green < blue ? 6 : 0);
    else if (max === green) hue = (blue - red) / d + 2;
    else hue = (red - green) / d + 4;
    hue *= 60;
  }
  return hue >= 360 ? hue - 360 : hue;
}

function rgbToHsl(red, green, blue) {
  const max = Math.max(red, green, blue), min = Math.min(red, green, blue);
  let [hue, sat] = [NaN, 0];
  const light = (min + max) / 2, d = max - min, epsilon = 1 / 100000;
  if (d !== 0) {
    sat = (Math.abs(light) <= epsilon || Math.abs(1 - light) < epsilon)
      ? 0
      : (max - light) / Math.min(light, 1 - light);
    if (max === red) hue = (green - blue) / d + (green < blue ? 6 : 0);
    else if (max === green) hue = (blue - red) / d + 2;
    else hue = (red - green) / d + 4;
    hue *= 60;
  }
  if (sat < 0) {
    hue += 180;
    sat = Math.abs(sat);
  }
  if (hue >= 360) hue -= 360;
  if (sat <= epsilon) {
    hue = NaN;
    sat = 0;
  }
  return [hue, sat, light];
}

function rgbToHwb(red, green, blue) {
  const epsilon = 1 / 100000;
  let hue = rgbToHue(red, green, blue);
  const white = Math.min(red, green, blue);
  let black = 1 - Math.max(red, green, blue);
  if (white + black >= 1 - epsilon) {
    hue = NaN;
    // §4.4.1: the blackness completes the sum to one.
    if (white + black < 1) black = 1 - white;
  }
  return [hue, white, black];
}

const POLAR = { oklch: "oklab", lch: "lab", hsl: "srgb", hwb: "srgb" };
const unitDegrees = (hue) => ((hue % 360) + 360) % 360;

function polarToRectangular(space, [c0, c1, c2]) {
  if (space === "oklch" || space === "lch") {
    const radians = unitDegrees(c2) * Math.PI / 180;
    return [c0, c1 * Math.cos(radians), c1 * Math.sin(radians)];
  }
  return space === "hsl" ? hslToRgb(c0, c1, c2) : hwbToRgb(c0, c1, c2);
}

// The polar form, null for a powerless (missing) hue (CSS Color 4 §9.5,
// Lab_to_LCH and OKLab_to_OKLCH with the chroma set to zero, §4.4.1).
function rectangularToPolar(space, [c0, c1, c2]) {
  if (space === "oklch" || space === "lch") {
    const chroma = Math.sqrt(c1 ** 2 + c2 ** 2);
    if (chroma <= (space === "oklch" ? 0.000004 : 0.0015)) return [c0, 0, null];
    return [c0, chroma, unitDegrees(Math.atan2(c2, c1) * 180 / Math.PI)];
  }
  const [hue, ...rest] = space === "hsl" ? rgbToHsl(c0, c1, c2) : rgbToHwb(c0, c1, c2);
  return [Number.isNaN(hue) ? null : hue, ...rest];
}

// powerlessToMissing of §19 on the operand's fractions; HSL and HWB compare
// in percent, as §7 and §8 write their ε.
function powerlessToMissing(space, components) {
  const out = [...components];
  const zero = (value) => value === null ? 0 : value;
  if (space === "hsl" && zero(out[1]) * 100 <= 0.001) {
    out[0] = null;
    if (out[1] !== null && out[1] > 0) out[1] = 0;
  }
  if (space === "hwb" && (zero(out[1]) + zero(out[2])) * 100 >= 99.999) {
    const sum = (zero(out[1]) + zero(out[2])) * 100;
    out[0] = null;
    if (sum < 100) {
      if (out[1] === null) out[2] = 1;
      else if (out[2] === null) out[1] = 1;
      else out[2] = 1 - out[1];
    }
  }
  if ((space === "lch" || space === "oklch") && zero(out[1]) <= (space === "oklch" ? 0.000004 : 0.0015)) {
    out[2] = null;
    if (out[1] !== null && out[1] > 0) out[1] = 0;
  }
  return out;
}

// The analogous-component categories of §13.4.
const CATEGORIES = {
  srgb: ["red", "green", "blue"],
  oklab: ["lightness", "a", "b"],
  lab: ["lightness", "a", "b"],
  oklch: ["lightness", "colorfulness", "hue"],
  lch: ["lightness", "colorfulness", "hue"],
  hsl: ["hue", "colorfulness", "lightness"],
  hwb: ["hue", null, null],
};
const categories = (space) => CATEGORIES[space] ?? CATEGORIES.srgb;

// The missing components of the converted color that §13.4 carries
// forward from the source's missing components.
function carried(from, missing, to) {
  const source = categories(from), target = categories(to);
  const result = [false, false, false];
  const sourceRest = [], targetRest = [];
  source.forEach((category, index) => {
    if (category !== null && target.includes(category)) {
      if (missing[index]) result[target.indexOf(category)] = true;
    } else sourceRest.push(index);
  });
  target.forEach((category, index) => {
    if (category === null || !source.includes(category)) targetRest.push(index);
  });
  if (sourceRest.length > 0 && sourceRest.every((index) => missing[index])) {
    targetRest.forEach((index) => result[index] = true);
  }
  return result;
}

// Converts a color into a space (§11.2), carrying its missing components
// forward (§13.4).
export function convert(color, to) {
  if (color.space === to) return { ...color, components: [...color.components] };
  const prepared = powerlessToMissing(color.space, color.components);
  const missing = prepared.map((value) => value === null);
  let components = prepared.map((value) => value ?? 0);
  const fromRectangular = POLAR[color.space] ?? color.space;
  const toRectangular = POLAR[to] ?? to;
  if (fromRectangular !== color.space) components = polarToRectangular(color.space, components);
  if (fromRectangular !== toRectangular) {
    components = xyzD65ToRectangular(toRectangular, rectangularToXyzD65(fromRectangular, components));
  }
  if (toRectangular !== to) components = rectangularToPolar(to, components);
  const carry = carried(color.space, missing, to);
  return {
    space: to,
    components: components.map((value, index) => carry[index] ? null : value),
    alpha: color.alpha,
  };
}

// Encoded extended sRGB, missing components as zero (§4.4).
export function toSrgb(color) {
  const resolved = { space: color.space, components: color.components.map((value) => value ?? 0), alpha: 1 };
  if (color.space === "srgb") return resolved.components;
  const rectangular = POLAR[color.space] ?? color.space;
  const components = rectangular === color.space
    ? resolved.components
    : polarToRectangular(color.space, resolved.components);
  return rectangular === "srgb" ? components : xyzD65ToRectangular("srgb", rectangularToXyzD65(rectangular, components));
}

const HUE_INDEX = { oklch: 2, lch: 2, hsl: 0, hwb: 0 };

// Interpolates two colors of one space at progress (§13.3 to §13.5) and
// multiplies the alpha (CSS Color 5 §3.3).
export function interpolate(first, second, method, progress, multiplier = 1) {
  const hue = HUE_INDEX[first.space] ?? -1;
  const firstAlpha = first.alpha ?? second.alpha;
  const secondAlpha = second.alpha ?? first.alpha;
  const premultiplied = firstAlpha !== null;
  const alpha = premultiplied ? firstAlpha + (secondAlpha - firstAlpha) * progress : null;
  const components = [0, 1, 2].map((index) => {
    let a = first.components[index] ?? second.components[index];
    let b = second.components[index] ?? first.components[index];
    if (a === null) return null;
    if (index === hue) {
      const difference = b - a;
      if (method === "shorter") {
        if (difference > 180) a += 360;
        else if (difference < -180) b += 360;
      } else if (method === "longer") {
        if (difference > 0 && difference < 180) a += 360;
        else if (difference > -180 && difference <= 0) b += 360;
      } else if (method === "increasing") {
        if (b < a) b += 360;
      } else if (a < b) a += 360;
      return unitDegrees(a + (b - a) * progress);
    }
    if (premultiplied) {
      a *= firstAlpha;
      b *= secondAlpha;
    }
    const value = a + (b - a) * progress;
    return premultiplied && alpha !== 0 ? value / alpha : value;
  });
  return { space: first.space, components, alpha: alpha === null ? null : alpha * multiplier };
}
