# Design

## One authority, two runtime forms

The maintained `.watpart` tree is the sole color implementation and ABI
authority. It produces two runtime forms without generated color source or a
second implementation:

- The manifest's embeddable WAT components provide ABI globals, shared error
  state, scalar, matrix, tagged-color, tone, gamut, perceptual, CSS, uniform
  palette, and RGBA8 palette-index operations inside another WASM module using
  that module's memory.
- The standalone WASM module adds allocation, profile state, bulk source and
  output transforms, and generic output packing.

A package boundary therefore does not force a WASM instance boundary. Compiled
`dist/color.wasm` and composed WAT are products of the same maintained source
and exact fixtures cover the shared surface in both forms.

## Observable policy belongs in WAT

WAT owns every decision that changes a color result or reported failure: tagged
transfer and matrix routes, missing-component treatment, CSS result completion
and white inference, working-space selection, output defaults, capability
validation, ICC profile-info decoding, tone and gamut policy, and sample
packing. Hosts copy records and call exports; they do not repair or infer color
policy after a call.

ABI version 2 is a clean boundary. Consumers read constants and offsets from
immutable exports and adopt its policy and capability records directly. There is
no provisional host policy, generated ABI mirror, compatibility layer, or
JavaScript runtime implementation.

## Package boundary

The npm artifact exposes standalone WASM, aggregate WAT, a build digest record,
the source manifest, and maintained WAT parts. Host code owns instantiation,
call serialization, memory copying, and handle lifetime. Package verification
checks the archive itself and installs it into a clean consumer before composing
its packed source layout.

## Renderer, codec, and gain-map boundaries

This package does not own GPU resources, shaders, command scheduling, or device
capabilities. A renderer may copy WAT-owned matrices and apply an equivalent GPU
pipeline, while the WAT fixture path remains the deterministic reference for
parsing, policy, metadata, exact CPU results, errors, and packing.

Codecs own containers, metadata framing, and format-specific policy. This
package packs generic samples and interleaved planes and builds generic uniform
RGB palettes and palette indices; it does not write PNG, GIF, BMP, PPM, private
raw, or other containers. Gain-map composition policy belongs to
`@sandom/gain-map`, which may request the general destination-linear source
operation.

## Memory and failure publication

The embeddable form allocates no hidden state, calls no imports or
`memory.grow`, and uses one documented scratch window. Consumers serialize
scratch-using calls. The standalone form owns its memory allocator and retained
profile handles but imposes no renderer memory layout.

Bulk operations validate spans, dimensions, enums, numeric parameters, capacity,
and overlap before publishing. Uniform palette building and indexing are bounded
caller-span operations and allocate no memory. Profile table evaluation uses
scratch output so non-finite or malformed batches cannot publish a partial
prefix. Successful release frees all profile-owned storage, and
generation-bearing handles prevent stale identities from aliasing reused
allocations.

## Evidence

Expected results are committed data with reviewed standards or derivations, not
values generated at test time by another language implementation. Fixtures cover
exact f64, packed bytes and uniform palette/index bytes, all supported ICC forms
and explicit exclusions, CSS records and statuses, policy and capability
failures, allocator lifecycle, and packed-source composition. Provenance is
recorded in `docs/legal/fixtures.md`.
