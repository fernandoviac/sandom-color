import { assert, globalValue, standalone, writeSourceRecord } from "./test-helpers.js";

const SRGB = 0, DISPLAY_P3 = 1, REC2020 = 2, A98 = 3, PROPHOTO = 4, XYZ_D50 = 5, XYZ_D65 = 6;

function vector(runtime) {
  return new Float64Array(runtime.memory.buffer, globalValue(runtime.exports, "color_vec_offset"), 3);
}

function run(runtime, values, operation) {
  vector(runtime).set(values);
  const status = operation();
  return { status, value: Array.from(vector(runtime)) };
}

function matrix(runtime, source, destination) {
  const out = runtime.alloc(72);
  try {
    const status = runtime.exports.color_primaries_matrix(source, destination, out, 72);
    return { status, rows: Array.from(new Float64Array(runtime.memory.buffer, out, 9)) };
  } finally {
    runtime.free(out);
  }
}

function close(left, right, tolerance, message) {
  left.forEach((value, index) => assert(Math.abs(value - right[index]) <= tolerance, `${message} [${index}] ${value} ${right[index]}`));
}

Deno.test("primaries matrices route through XYZ with Bradford adaptation for D50 sets", async () => {
  const runtime = await standalone();
  for (let source = 0; source <= XYZ_D65; source++) {
    for (let destination = 0; destination <= PROPHOTO; destination++) {
      const { status, rows } = matrix(runtime, source, destination);
      assert(status === 1, `${source} -> ${destination} has a matrix`);
      // Each column is the image of one basis vector through the vector operations.
      for (let column = 0; column < 3; column++) {
        const basis = [0, 1, 2].map((index) => (index === column ? 1 : 0));
        let expected = basis;
        if (source !== destination) {
          const working = run(runtime, basis, () => runtime.exports.color_linear_to_working(source)).value;
          expected = run(runtime, working, () => runtime.exports.color_working_to_linear(destination)).value;
        }
        close([rows[column], rows[3 + column], rows[6 + column]], expected, 1e-12, `${source} -> ${destination} column ${column}`);
      }
    }
  }
  assert(matrix(runtime, SRGB, SRGB).rows.join() === "1,0,0,0,1,0,0,0,1", "equal primaries give the identity");
  assert(matrix(runtime, SRGB, XYZ_D65).status === 0, "an XYZ destination has no RGB matrix");
  assert(matrix(runtime, 7, SRGB).status === 0, "an unknown source is rejected");
});

Deno.test("linear conversions agree with tagged linear conversion and reject sets without matrices", async () => {
  const runtime = await standalone();
  const linear = globalValue(runtime.exports, "color_transfer_linear");
  for (const primaries of [SRGB, DISPLAY_P3, REC2020, A98, PROPHOTO, XYZ_D50, XYZ_D65]) {
    const sample = [0.2, 0.5, 0.9];
    const routed = run(runtime, sample, () => runtime.exports.color_linear_to_working(primaries));
    const tagged = run(runtime, sample, () => runtime.exports.color_convert_tagged_to_working(primaries, linear, 1, 0));
    assert(routed.status === 1 && tagged.status === 1, `primaries ${primaries} convert`);
    assert(routed.value.join() === tagged.value.join(), `primaries ${primaries} route equally`);
  }
  assert(run(runtime, [1, 0, 0], () => runtime.exports.color_linear_to_working(REC2020)).value.join() === "1,0,0", "Rec.2020 stays");
  assert(run(runtime, [1, 0, 0], () => runtime.exports.color_working_to_linear(XYZ_D65)).status === 0, "XYZ has no RGB destination");
  assert(run(runtime, [1, 0, 0], () => runtime.exports.color_linear_to_xyz(XYZ_D50)).status === 0, "XYZ has no RGB matrix");
  const white = run(runtime, [1, 1, 1], () => runtime.exports.color_linear_to_xyz(SRGB)).value;
  const back = run(runtime, white, () => runtime.exports.color_xyz_to_linear(SRGB)).value;
  close(back, [1, 1, 1], 1e-12, "sRGB white round trip");
  assert(run(runtime, [1.2, -0.1, 0.5], () => runtime.exports.color_gamut_map_css_color_4(PROPHOTO + 1)).status === 0, "gamut map needs an RGB destination");
  const mapped = run(runtime, [1.2, -0.1, 0.5], () => runtime.exports.color_gamut_map_css_color_4(SRGB)).value;
  mapped.forEach((value) => assert(value >= 0 && value <= 1, `mapped ${value} is in gamut`));
});

Deno.test("straight sRGB RGBA8 unpremultiplies, converts primaries and rounds half up", async () => {
  const runtime = await standalone();
  const exports = runtime.exports;
  // Float16 bits: 0.5 = 0x3800, 0.25 = 0x3400, 1 = 0x3c00.
  const pixels = new Uint16Array([0x3400, 0x3400, 0x3400, 0x3800, 0, 0, 0, 0x3c00]);
  const bytes = new Uint8Array(pixels.buffer);
  const input = runtime.copyIn(bytes);
  const record = runtime.alloc(globalValue(exports, "color_source_size"));
  const output = runtime.alloc(8);
  try {
    writeSourceRecord(runtime, record, {
      length: bytes.length, width: 2, height: 1, stride: 16,
      sample: globalValue(exports, "color_sample_float16"), bits: 16,
      layout: globalValue(exports, "color_layout_rgba"),
      alpha: globalValue(exports, "color_alpha_premultiplied"),
      transfer: globalValue(exports, "color_transfer_srgb"),
      primaries: SRGB, mode: 0, gamma: 1, referenceWhite: 203,
    }, input);
    assert(exports.color_source_srgb8(record, output, 8) === 0, "conversion succeeds");
    const result = runtime.copyOut(output, 8);
    // 0.25 / 0.5 = 0.5 encoded sRGB; through the sRGB matrices it stays
    // within rounding of 0.5 * 255 = 127.5, rounded half up.
    for (let channel = 0; channel < 3; channel++) assert(Math.abs(result[channel] - 128) <= 1, `channel ${channel} ${result[channel]}`);
    assert(result[3] === 128, "alpha 0.5 rounds half up to 128");
    assert(result.slice(4).join() === "0,0,0,255", `black with alpha 1 is 0, 0, 0, 255: ${result.slice(4)}`);
    writeSourceRecord(runtime, record, {
      length: bytes.length, width: 2, height: 1, stride: 16,
      sample: globalValue(exports, "color_sample_float16"), bits: 16,
      layout: globalValue(exports, "color_layout_rgba"),
      alpha: globalValue(exports, "color_alpha_straight"),
      transfer: globalValue(exports, "color_transfer_pq"),
      primaries: REC2020, mode: 0, gamma: 1, referenceWhite: 203,
    }, input);
    assert(exports.color_source_srgb8(record, output, 8) !== 0, "a PQ source is rejected");
    assert(exports.color_error_field() === 36, "at the transfer field");
  } finally {
    runtime.free(output);
    runtime.free(record);
    runtime.free(input);
  }
});

Deno.test("capability builders accept exactly the added depths and encodings", async () => {
  const runtime = await standalone();
  const { exports, memory } = runtime;
  const capability = runtime.alloc(globalValue(exports, "color_capability_size"));
  const policy = runtime.alloc(globalValue(exports, "color_policy_size"));
  try {
    const opaque = globalValue(exports, "color_alpha_opaque");
    assert(exports.color_capability_init(capability, opaque, 0) === 0, "init");
    assert(exports.color_capability_accept_depth(capability, 10) === 0, "depth 10");
    assert(exports.color_capability_accept_depth(capability, 9) !== 0, "depth 9 is no depth code");
    assert(exports.color_capability_accept_encoding(capability, REC2020, globalValue(exports, "color_transfer_pq")) === 0, "Rec.2020 PQ");
    const view = new DataView(memory.buffer);
    const mask = view.getUint32(capability + globalValue(exports, "color_capability_depth_mask"), true);
    assert(mask === 2, `depth mask ${mask}`);
    // Rec.2020 PQ is bit 2 * 8 + 3 = 19 of the low mask.
    assert(view.getUint32(capability + globalValue(exports, "color_capability_encoding_low"), true) === 1 << 19, "low mask bit 19");
    assert(exports.color_policy_init(policy, globalValue(exports, "color_transfer_pq")) === 0, "policy init");
    const field = (name) => policy + globalValue(exports, name);
    view.setUint32(field("color_policy_primaries"), REC2020, true);
    view.setUint32(field("color_policy_depth"), 10, true);
    view.setUint32(field("color_policy_alpha"), opaque, true);
    view.setUint32(field("color_policy_mastering_present"), 1, true);
    assert(exports.color_validate_policy(policy, capability) === 0, "the capability accepts the policy");
    view.setUint32(field("color_policy_depth"), 12, true);
    assert(exports.color_validate_policy(policy, capability) !== 0, "depth 12 was not added");
  } finally {
    runtime.free(policy);
    runtime.free(capability);
  }
});
