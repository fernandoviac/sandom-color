# ABI

`src/color-abi.watpart` is the ABI authority. Both the standalone module and
manifest-composed embeddable form export each constant as an immutable
WebAssembly global. Hosts must read enum values, record sizes, field offsets,
parser locations, and error codes from those globals rather than mirror them.

The standalone binary is exported as `@sandom/color/color.wasm`. Instantiate it
without imports, call `color_init` once, require `color_abi_version() == 2`, and
then use its memory and exports directly. There is no JavaScript runtime API.

All pointers address module memory. Multi-byte values are little-endian. Bulk
calls reject invalid or overlapping spans before publishing output. Allocation
uses `color_alloc`/`color_free`; a successful `color_profile_compile` handle
remains live until `color_profile_release` succeeds. Released and unknown
handles return `color_error_handle_stale` and cannot alias a later profile.

## Status and errors

Most standalone operations return zero on success. The shared
`color_palette_uniform` and `color_index_palette` operations return one on
success and zero on failure so their contract is identical when composed. On
failure, `color_error_code()` identifies the error and `color_error_field()`
identifies the responsible record offset, argument position, ICC byte offset, or
encoded profile sample location. Read the exported `color_error_*` globals;
current ABI v2 codes distinguish enum/version, dimensions/spans, numeric input,
allocation, malformed and unsupported profiles, stale handles, output capacity,
reverse ICC tables, CMYK, gray, N-channel, `mpet`, rendering intent, black
point, malformed `chad` metadata, invalid palette levels, palette thresholds,
palette spans, and palette records.

For a non-finite LUT profile sample, the field packs the sample index in the low
26 bits and `(stage * 4 + channel)` in the upper bits. The exported stage, mask,
and bit-count globals decode it. Batch profile transforms are atomic: an error
does not publish a prefix.

The CSS parser has a separate status family, exported as `color_css_error_*`:
unrecognized syntax, number, unit, structure/capacity, color space, trailing
input, and hexadecimal syntax.

## Numeric contract

Scalar and profile color work uses `f64`; bulk output crosses the ABI as `f32`.
Integer packing clamps and rounds magnitude to nearest. Half conversion uses
ties up and canonicalizes NaN to `0x7e00`. Deliberately raw linear paths
preserve non-finite values; operations that need finite tables reject them with
an exact sample field.

The shared kernel owns sRGB, arbitrary gamma, PQ, HLG, Rec.2020, and ProPhoto
transfers; RGB/XYZ and Bradford matrices; Lab and OKLab conversion; BT.2390 tone
mapping; CSS Color 4 gamut mapping; tagged-color routing; working-space
selection; CSS parsing and interpolation; and the 203-candela reference-white
convention. PQ and HLG enter the Rec.2020 working space directly. Missing tagged
components become zero for conversion while the parse record retains the
authored missing mask.

HLG has two decodes. A tagged color (`color_convert_tagged_to_working` and
`color_convert_tagged_to_standard`) is an authored CSS `rec2100-hlg` color:
each channel decodes alone through the BT.2100 inverse OETF and scales by
3.7743, so media white is signal 0.75 and the 18% grey card is 0.38 (CSS Color
HDR 1 § 8.2 and § 11.3), with no system gamma. An HLG image source and an HLG
output use the BT.2100 display transform of the 1000-candela reference display
with system gamma 1.2 (`hlg_rgb_to_working`).

## Records

Every size and offset below has a corresponding exported global.

- The 80-byte policy record selects output primaries, transfer, depth, alpha,
  tone, range, peaks, white, gamut mapping, mastering presence, and source
  minimum. `color_policy_init` owns defaults for all supported transfers.
  Standard range requires `none`; high and adaptive ranges require `bt2390`.
  Adaptive applies BT.2390 to the base image before gain-map reconstruction.
- The 24-byte capability record contains its ABI version, accepted depth mask,
  two 32-bit encoding masks, required alpha mode, and flags. Encoding bit
  `primaries * 8 + transfer` selects the low or high mask. Validation reports
  the exact rejected policy field. Capability flag bit 0 requires mastering
  metadata for a high-range policy. `color_capability_init(capability, alpha,
  flags)` writes an empty capability; `color_capability_accept_depth` and
  `color_capability_accept_encoding` add one depth code or one
  primaries/transfer pair, so a host never computes mask bits.
- The 64-byte source record names a byte span, dimensions and stride, sample and
  channel layout, alpha mode, transfer, primaries, source mode, gamma, and
  reference white. Source operations produce degraded RGBA8, straight sRGB
  RGBA8 (`color_source_srgb8`: unpremultiplied, converted from the source
  primaries through XYZ D65, sRGB encoded, clamped and rounded half up; PQ,
  HLG and ICC sources fail at the transfer field), destination-linear `f64`,
  or package working-space `f64` planes.
- The 20-byte profile-info record contains handle, profile kind, sRGB-like flag,
  stable content identity, and schema revision. Revision is currently 1 and is
  written by WAT on compile and info refresh.
- The 20-byte uniform-palette record contains red, green, and blue level counts,
  an explicit transparent entry, and the derived entry count. The transparent
  field is a signed `i32`: use `color_palette_transparent_none` (`-1`) for no
  transparent entry, or an entry index that the cube skips. The entries field is
  written by `color_palette_uniform` and validated by `color_index_palette`.
  Every size and field offset has a `color_palette_*` global.

| Offset | Type  | Meaning                                     |
| -----: | ----- | ------------------------------------------- |
|      0 | `u32` | red levels, at least 2                      |
|      4 | `u32` | green levels, at least 2                    |
|      8 | `u32` | blue levels, at least 2                     |
|     12 | `i32` | explicit transparent slot, or `-1` for none |
|     16 | `u32` | derived total entry count                   |

## CSS parser record

Write at most `color_parse_input_capacity` CSS ASCII bytes at
`color_parse_input_offset`, then call `color_parse_css(length)`. WAT normalizes
ASCII case and handles surrounding CSS whitespace; the host performs no color
syntax preprocessing. Success writes exactly `color_parse_result_size` bytes at
`color_parse_result_offset`:

| Offset | Type      | Meaning                 |
| -----: | --------- | ----------------------- |
|      0 | 3 x `f64` | components              |
|     24 | `f64`     | alpha                   |
|     32 | `i32`     | conversion missing mask |
|     36 | `i32`     | alpha was missing       |
|     40 | `i32`     | primaries               |
|     44 | `i32`     | transfer                |
|     48 | `f64`     | gamma                   |
|     56 | `i32`     | authored CSS form       |
|     60 | `i32`     | authored missing mask   |
|     64 | `i32`     | D50/D65 white           |
|     68 | `i32`     | alpha mode              |
|     72 | `f64`     | reference white         |

Lab, LCH, OKLab, and OKLCH complete their conversion components and clear the
conversion missing mask while preserving `authored missing`. HSL and HWB convert
a missing component as zero, so their conversion mask is clear while
`authored missing` keeps it. ProPhoto and XYZ D50 infer D50; other supported
spaces use D65. `color(rec2020)` has primaries Rec.2020 and the gamma transfer
with exponent 2.4 (BT.1886, CSS Color 4 §10.8); the Rec.2020 transfer id is the
BT.2020 signal of tagged sources. Only `rgb()`, `rgba()`, `hsl()` and `hsla()`
take the legacy comma syntax, and it takes no `none`. Only the hue of `lch()`
and `oklch()` takes an angle. A negative `hsl()` saturation is 0% at
parsed-value time (CSS Color 4 §7). Successful CSS records use straight alpha
and reference white 203.

## CSS color interpolation

The interpolation operations implement CSS Color 4 interpolation for CSS Color
5 `color-mix()`. An operand is a `color_mix_operand_size` (40) byte record,
eight-byte aligned:

| Offset | Type      | Meaning                                         |
| -----: | --------- | ----------------------------------------------- |
|      0 | 3 x `f64` | components in the operand's space               |
|     24 | `f64`     | alpha                                           |
|     32 | `i32`     | missing mask: bits 0-2 components, bit 3 alpha  |
|     36 | `i32`     | `color_mix_space_*`                             |

Interpolation spaces are sRGB, OKLab, Lab, OKLCh, LCh, HSL, HWB, and the
predefined `color()` spaces: `color_mix_space_srgb_linear`, `_display_p3`,
`_display_p3_linear`, `_a98_rgb`, `_prophoto_rgb`, `_rec2020`, `_xyz_d50`, and
`_xyz_d65`. An operand in a predefined space can also come from its authored
`color()`. sRGB components are extended encoded values; Lab-family components
are L, a, b; LCh-family components are L, C, and hue in degrees; HSL is hue,
saturation, and lightness and HWB is hue, whiteness, and blackness, with
fractions rather than percentages; a predefined space holds its `color()`
components. A missing component or alpha stores zero.

The operations compute in double precision with the CSS Color 4 conversions
(§11.2 and the sample code of §19): a polar form converts to its own
rectangular form (OKLab for OKLCh, Lab for LCh, sRGB for HSL and HWB), and two
different rectangular forms convert through XYZ D65 with the kernel's matrices
and transfer functions. A missing component counts as zero in the conversion.

- `color_mix_operand_from_parse(operand)` makes an operand of the last
  successful CSS parse in its authored form's space, keeping authored missing
  components. Hex and `rgb()` enter as sRGB; `color()` keeps its predefined
  space. Another `color()` space (`rec2100-pq`, `rec2100-hlg`,
  `rec2100-linear`) converts to extended sRGB.
- `color_mix_operand_from_srgb(operand, r, g, b, alpha)` makes an sRGB operand
  for a named color, `transparent`, or a resolved `currentcolor`.
- `color_mix_convert(source, space, destination)` converts an operand of any
  space into an interpolation space. Before the conversion, the source's
  powerless hue becomes missing (CSS Color 4 §4.4.1): HSL saturation of 0.001%
  or less, HWB whiteness and blackness summing to 99.999% or more, LCh chroma
  of 0.0015 or less, OKLCh chroma of 0.000004 or less; its chroma or
  saturation becomes zero, and an HWB whiteness or blackness completes the sum
  to 100%. A polar result's hue is powerless by the same rules. A missing
  component carries forward to the analogous component (reds, greens, blues,
  lightness, colorfulness, hue, opponent a, opponent b, where X, Y, and Z are
  reds, greens, and blues; HWB whiteness and blackness have none); when every
  source component without an analogue is missing, every result component
  without an analogue is missing (§13.4). An operand already in the space is
  copied unchanged.
- `color_mix_interpolate(first, second, hue, progress, alphaMultiplier,
  result)` interpolates two operands of one space at `progress`, the second
  operand's share in [0, 1]. A component missing from one operand takes the
  other's value; one missing from both stays missing. Every component but hue
  is premultiplied by alpha. `hue` is `color_mix_hue_shorter`, `_longer`,
  `_increasing`, or `_decreasing`. The result alpha is scaled by
  `alphaMultiplier` in [0, 1] and clamped to [0, 1]; the other components are
  not clamped.
- `color_mix_to_srgb(operand)` writes an operand of any space as extended
  encoded sRGB at `color_vec_offset`; missing components count as zero.

Each returns one on success. A bad record span or alignment reports
`color_error_span_dimensions`, a bad space, hue method, or a pair of operands in
different spaces `color_error_enum_version`, and a progress or multiplier
outside its range `color_error_numeric_parameter`; `color_error_field()` names
the argument position.

## ICC scope

The compiler accepts RGB `mntr`, `scnr`, and `spac` profiles with XYZ or Lab
profile connection space. It accepts matrix/TRC profiles with `curv` and `para`
functions 0 through 4, and `A2B0` tags of type `mft1`, `mft2`, or `mAB` with
three-channel uniform grids and trilinear interpolation. It applies the fixed
Bradford D50-to-D65 transform.

A valid `chad` tag is a 3-by-3 `sf32` matrix with a zero reserved field. ICC
matrix colorants and lookup-table outputs are already expressed in the D50
profile connection space for the package's relative-colorimetric transforms, so
the tag is validated but not applied a second time. Malformed `chad` metadata
retains its distinct ABI error.

The first release explicitly rejects reverse `B2A` tables, CMYK, gray,
N-channel, `mpet`, saturation and absolute rendering intents, black-point
processing, and absolute-colorimetric reconstruction. Those are unsupported
contracts, not silent fallbacks.

## Operations

Use the standalone form for retained profile calls, allocation, source-plane
preparation, policy validation and output transforms, and generic packing.
`color_packing_size` computes checked byte capacity; `color_pack_signal`,
`color_pack_half`, `color_unpack_half`, `color_expand_samples`, and
`color_pack_image` operate on samples or plain interleaved bytes and contain no
container knowledge.

`color_palette_uniform(record, palette, capacity)` writes tightly packed RGB8
entries. Each channel requires at least two levels. A channel level `n` has
value `floor(n * 255 / (levels - 1))`; entries are red-major, then green, then
blue. When the record names a transparent entry, that three-byte entry is zero
and the cube skips its index. Cube entries plus transparency must not exceed
256. `capacity` is bytes.

`color_index_palette(record, rgba, rgbaLength, threshold, indices,
indexCapacity)`
maps each tightly packed RGBA8 pixel to one byte. RGBA length must be divisible
by four and index capacity is bytes, equal to the available pixel count. Each
channel rounds with `floor((byte * (levels - 1) + 127) / 255)` and uses the same
red-major order, skipping the transparent slot. With transparency, alpha at or
below threshold uses that slot and threshold must be 0 through 255. Without
transparency, threshold must be the canonical ignored value zero and alpha does
not affect the index.

Both palette operations validate every record and memory span before writing,
reject overlapping output, allocate nothing, and clear the shared error state on
success. `color_error_palette_levels`, `color_error_palette_threshold`,
`color_error_palette_span`, and `color_error_palette_record` distinguish their
failures; `color_error_field()` is a palette-record offset for record failures
and an argument position for span or threshold failures.

Primaries routing takes a primaries code and works on the shared vector:
`color_linear_to_working(primaries)` and `color_working_to_linear(primaries)`
convert between linear RGB in the set and linear Rec.2020 (no gamut map);
`color_linear_to_xyz(primaries)` and `color_xyz_to_linear(primaries)` apply the
set's own matrices; `color_gamut_map_css_color_4(primaries)` gamut maps working
RGB into the set. `color_primaries_matrix(source, destination, out, capacity)`
writes the 72-byte row-major matrix from linear `source` into linear
`destination`, composed from the basis vectors. A D50 set (ProPhoto RGB, XYZ
D50) adapts to and from D65 by Bradford. The XYZ sets have no RGB matrix; an
operation that needs one, or an unknown code, returns 0. Each other operation
returns 1.

The kernel calls documented in `composition.md` are also present in standalone
WASM. The packed-source composition test executes the same fixture set against
the embeddable WAT and the standalone artifact.
