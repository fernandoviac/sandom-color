# Fixture provenance

No fixture in this repository contains third-party media, executable native
code, or a second color implementation. Expected results are committed data;
tests do not generate them from a JavaScript, C, C++, Rust, or other color
oracle.

## Kernel vectors

`test/fixtures/color-kernel-fixtures.json` records little-endian `f64` results
for IEC 61966-2-1 sRGB, arbitrary gamma, SMPTE ST 2084 PQ, ITU-R BT.2100 HLG,
Rec.2020, ProPhoto RGB, tagged routing, missing components, Lab, OKLab, BT.2390
tone mapping, and CSS Color 4 gamut mapping. The values were reviewed against
the named standards, their published constants, and the WAT operation order.
They fix binary64 rounding as part of ABI v2.

The same file contains complete 80-byte CSS result records and exact parser
status cases. Those records cover component and alpha values, conversion and
authored missing masks, primaries, transfer, gamma, authored form, inferred
white, alpha mode, and the 203-candela reference white.

`test/fixtures/color-matrix-fixtures.json` records the SHA-256 digest of the
little-endian `f64` bytes for the ten RGB/XYZ and two Bradford matrices derived
by `$colorInit`. The reviewed derivation uses the SMPTE RP 177 method, CSS Color
4 primary and D50/D65 chromaticities, and the published linear Bradford matrix.

## Byte and output vectors

`test/fixtures/color-byte-fixtures.json` and
`test/fixtures/color-output-fixtures.json` trace their initial input selection
to Sandom commit `d5e6d443`. They were then reviewed and narrowed for this
package boundary. Container format, GPU precision, BMP, PPM, and private raw
cases were removed. Every retained case has exact expected bytes and is consumed
by standalone behavior tests.

The byte fixture covers half boundaries and classifications, 8/10/12/16-bit
signal packing, generic interleaved copying, padded uint16 expansion, degraded
RGBA8, destination-linear source conversion, and premultiplied working output.
The output fixture covers standard, high, and adaptive range routes, tone and
gamut mapping, NaN publication, exact capability rejection fields, and mastering
requirements.

`test/fixtures/color-palette-fixtures.json` records exact uniform RGB palette
and RGBA8 index bytes. Its 6 by 7 by 6 cube traces the ordering, integer channel
steps, rounding, and transparent entry 0 to Sandom `gif-encoder.wat` at commit
`d5e6d443`. The reviewed general derivation replaces fixed 5, 6, and 5 channel
maxima with `levels - 1`, permits an explicit skipped transparent slot, and
includes the 2-level cube, rounding and alpha threshold boundaries, invalid
records and thresholds, and short input/output spans. Tests read these static
bytes; they contain no executable palette oracle.

## ICC profiles

Most `test/fixtures/icc/*.icc` files are small static synthetic ICC.1 byte
layouts created for this repository. They contain only profile headers, tag
tables, fixed-point numbers, curve parameters, and tiny identity or two-node
lookup tables. There is no checked-in generator.
`test/fixtures/icc-fixtures.json` records their reviewed contracts.

Accepted fixtures cover device classes `mntr`, `scnr`, and `spac`; matrix/TRC
profiles using `curv` and every `para` function 0 through 4; and `A2B0` profiles
using `mft1`, `mft2`, and `mAB` with XYZ and Lab connection spaces. Rejection
fixtures isolate malformed length, unsupported class, CMYK, gray, N-channel,
saturation rendering intent, reverse `B2A`, black-point, malformed `chad`, and
`mpet` cases so each exact code and ICC byte field is observable.

`test/fixtures/display-p3.icc` is the 528-byte Sandom Display P3 profile from
Sandom `src/output/icc-profile.js` at commit `d5e6d443`. Sandom built it from
the CSS Color 4 Display P3 matrix, a Bradford D65-to-D50 transform, the ICC D50
white point, and sRGB type 3 parametric curves. The 584-byte
`test/fixtures/icc/display-p3-chad.icc` adds the standard 3-by-3 Bradford `sf32`
chromatic-adaptation metadata to that owned profile. SHA-256:
`8644098b787548a08ffa46ddea97729a733d6eb7adf652ccd5ef68860ab0e17a`. Both remain
repository-owned interoperability samples and contain no third-party text or
media.
