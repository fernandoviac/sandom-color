# @sandom/color

This project owns reusable color management for WebAssembly consumers. Its
maintained WAT compiles ICC profiles, applies deterministic color and output
policy, parses and interpolates CSS colors, exposes embeddable primitives,
performs bulk CPU transforms, packs generic sample planes, and builds bounded
uniform palettes and RGBA8 palette indices.

## Packages

- npm: `@sandom/color`
- library set: `https://cdn.urania-libs.com`, under `sandom-color/dist/color.wasm`

0.5.0 converts and mixes CSS colors in double precision with the CSS Color 4
conversions, its powerless-component ε and its carrying forward of missing
components, gives `color(rec2020)` the gamma 2.4 transfer, takes the legacy
comma syntax only in `rgb()` and `hsl()` and without `none`, takes an angle
only as a hue, and clamps a negative `hsl()` saturation to 0%. It gamut maps
with the CSS Color 4 binary search
with local MINDE, routes linear RGB between primaries sets by primaries code
and converts source planes to straight sRGB RGBA8.

## Boundaries

This project owns color semantics and color-profile processing. A renderer owns
GPU resources and shader dispatch. Codecs own their containers and file-format
rules. Gain-map policy belongs to `@sandom/gain-map`.

The package contains maintained WAT source and compiled WASM. It ships no
JavaScript runtime entry point, generator, compatibility layer, or second color
implementation. Consumers either instantiate `@sandom/color/color.wasm` or
compose the manifest's embeddable WAT components into an existing module.

## Build and verification

The required toolchain is Deno 2.7.7. WAT is assembled in process by
`tools/wat-assembler`, so the build needs no WABT on `PATH`; see
[the assembler provenance](docs/legal/wat-assembler.md).

```sh
deno task wasm
deno task check
deno task package:check
```

`deno task wasm` composes the ordered manifest and records source and artifact
digests. `deno task check` verifies the artifacts and runs fixture-backed
behavior tests, including clean installed-package composition.
`deno task package:check` checks the actual npm file list.

The npm artifact includes `dist/color.wasm`, `dist/color.wat`,
`dist/color.build.json`, `src/color.manifest.json`, and every maintained
`.watpart`. See [the ABI](docs/abi.md), [WAT composition](docs/composition.md),
[fixture provenance](docs/legal/fixtures.md), and
[assembler provenance](docs/legal/wat-assembler.md).
