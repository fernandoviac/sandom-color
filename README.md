# @sandom/color

This project owns reusable color management for WebAssembly consumers. Its
maintained WAT compiles ICC profiles, applies deterministic color and output
policy, parses and interpolates CSS colors, exposes embeddable primitives,
performs bulk CPU transforms, packs generic sample planes, and builds bounded
uniform palettes and RGBA8 palette indices.

## Packages

- npm target: `@sandom/color`
- GitHub target: `fernandoviac/sandom-color`
- local repository: `sandom-color`

No package has been published yet. Local sibling consumers may compose the
maintained WAT directly before publication; publishing and later pinning the
fetched artifact remain separate release work.

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
