# WAT composition

`src/color.manifest.json` describes both runtime forms. Consumers that need only
shared primitives read `embeddable.components` from the installed package; they
must not infer that list from the standalone `components` array or a local
checkout. The embeddable order is `color-abi.watpart` followed by
`color-kernel.watpart`, so composed consumers receive the immutable ABI globals,
shared error state, and kernel operations from the same maintained sources as
standalone WASM.

A containing `(module ...)` must declare one memory and an immutable i32
`$COLOR_BASE` before inserting the embeddable components. It reserves
`embeddable.scratchBytes` bytes beginning at that base and calls `$colorInit`
once before any color operation. The manifest records the required symbols as
`["memory", "$COLOR_BASE"]`.

A minimal composition is:

```wat
(module
  (memory (export "memory") 1)
  (global $COLOR_BASE i32 (i32.const 0))
  ;; insert each manifest embeddable component here, in order
  (func (export "initialize-color") (call $colorInit)))
```

The package test creates this module from the npm archive installed into a clean
consumer directory, assembles it with the vendored `tools/wat-assembler`, and
exercises the shared transfer, tagged routing, matrix, tone, gamut, perceptual,
CSS, uniform palette, and RGBA8 palette-index fixtures. It never substitutes WAT
source from the repository checkout.

## Memory window

The current manifest reserves 9,728 bytes from `$COLOR_BASE`:

- bytes 0 through 1,151 hold sixteen row-major 3 by 3 `f64` matrix slots;
- bytes 1,152 through 1,175 hold the D50 XYZ white point;
- bytes 2,048 through 2,455 hold vector and operation scratch;
- bytes 2,560 through 2,639 hold the completed 80-byte CSS result;
- bytes 2,704 through 2,935 hold initialization-only matrix scratch;
- bytes 4,096 through 6,143 hold up to 2,048 CSS input bytes;
- bytes 6,144 through 9,727 hold CSS token and parser scratch.

Both forms export the ABI globals for the vector, CSS input and result, palette
record, errors, capacities, sizes, and field offsets. Every exported offset is
base-relative where applicable. The composition test fixes scratch locations and
palette layouts with exact fixture bytes.

The components import no functions, allocate no memory, retain no handles, and
never call `memory.grow`. Matrix, vector, parser input, parser output, and
parser token storage are shared mutable scratch. A host must serialize kernel
calls that access them, or reserve independent kernel windows and instances at
composition time. Initialization must also be serialized and completed before
publication of the containing instance. Palette build and indexing use only
caller-provided records and spans, but follow the same serialized-call contract
for the shared error globals.

## Standalone form

The full ordered `components` list builds `dist/color.wat` and
`dist/color.wasm`. `color-module.watpart` supplies memory with
`$COLOR_BASE = 0`; the shared ABI and kernel follow it, then the standalone-only
parts add allocation, generic packing, source-plane preparation, retained ICC
profiles, output policy, and bulk transforms. Use this form when ownership or
retained profile state should belong to the color module. Use the embeddable
form when a larger WAT module needs the shared operations without an instance
boundary.
