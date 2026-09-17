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
selection; CSS parsing; and the 203-candela reference-white convention. PQ and
HLG enter the Rec.2020 working space directly. Missing tagged components become
zero for conversion while the parse record retains the authored missing mask.

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
  metadata for a high-range policy.
- The 64-byte source record names a byte span, dimensions and stride, sample and
  channel layout, alpha mode, transfer, primaries, source mode, gamma, and
  reference white. Source operations produce degraded RGBA8, destination-linear
  `f64`, or package working-space `f64` planes.
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
conversion missing mask while preserving `authored missing`. ProPhoto and XYZ
D50 infer D50; other supported spaces use D65. Successful CSS records use
straight alpha and reference white 203.

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

The kernel calls documented in `composition.md` are also present in standalone
WASM. The packed-source composition test executes the same fixture set against
the embeddable WAT and the standalone artifact.
