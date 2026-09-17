import { assembleWat } from "./wat-assembler/assemble.js";

const root = new URL("../", import.meta.url);
const sourceDirectory = new URL("src/", root);
const distDirectory = new URL("dist/", root);
const manifestUrl = new URL("color.manifest.json", sourceDirectory);
const check = Deno.args.length === 1 && Deno.args[0] === "--check";
if ((!check && Deno.args.length !== 0) || Deno.args.length > 1) {
  throw new Error(
    "Usage: deno run --allow-read --allow-write tools/build-wasm.js [--check]",
  );
}

const encoder = new TextEncoder();
const hex = (bytes) =>
  [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
const digest = async (value) =>
  hex(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        typeof value === "string" ? encoder.encode(value) : value,
      ),
    ),
  );

// The build record names the encoder that produced the binary. The vendored
// assembler carries its own identity, so the record follows a version bump
// instead of restating one.
const assemblerVersion = JSON.parse(
  await Deno.readTextFile(
    new URL("wat-assembler/identity.json", import.meta.url),
  ),
).dependencies.find(({ name }) => name === "wat").version;

const manifestText = await Deno.readTextFile(manifestUrl);
const manifest = JSON.parse(manifestText);
if (
  manifest?.kind !== "sandom/webassembly-source-manifest" ||
  manifest.version !== 1 || manifest.module !== "color" ||
  !Array.isArray(manifest.components) || manifest.components.length === 0 ||
  !Array.isArray(manifest.embeddable?.components) ||
  manifest.embeddable.components.length === 0 ||
  manifest.embeddable.scratchBytes !== 9728 ||
  JSON.stringify(manifest.embeddable.requires) !==
    JSON.stringify(["memory", "$COLOR_BASE"])
) {
  throw new Error("Invalid color WebAssembly source manifest");
}
const seen = new Set();
const components = [];
for (const path of manifest.components) {
  if (
    typeof path !== "string" || !/^[a-z][a-z0-9-]*\.watpart$/.test(path) ||
    seen.has(path)
  ) {
    throw new Error(`Unsafe or duplicate component: ${path}`);
  }
  seen.add(path);
  const text = await Deno.readTextFile(new URL(path, sourceDirectory));
  if (!text.trim()) throw new Error(`Empty component: ${path}`);
  components.push({
    path,
    text: text.trimEnd() + "\n",
    digest: await digest(text.trimEnd() + "\n"),
  });
}
for (const path of manifest.embeddable.components) {
  if (!seen.has(path)) {
    throw new Error(`Unknown embeddable component: ${path}`);
  }
}
const aggregate = `(module\n${
  components.map(({ path, text }) => `  ;; component: ${path}\n${text}`).join(
    "\n",
  )
})\n`;
const sourceDigest = await digest(
  JSON.stringify({
    manifest,
    components: components.map(({ path, digest }) => ({ path, digest })),
  }),
);
const aggregateDigest = await digest(aggregate);
const wasm = await assembleWat(aggregate, "color.wat");
const record = JSON.stringify(
  {
    kind: "sandom/color-build",
    version: 1,
    compiler: `wat-assembler (wat ${assemblerVersion})`,
    sourceDigest,
    aggregateDigest,
    binaryDigest: await digest(wasm),
    components: components.map(({ path, digest }) => ({ path, digest })),
  },
  null,
  2,
) + "\n";
const outputs = [
  [new URL("color.wat", distDirectory), encoder.encode(aggregate)],
  [new URL("color.wasm", distDirectory), wasm],
  [new URL("color.build.json", distDirectory), encoder.encode(record)],
];
if (check) {
  for (const [url, expected] of outputs) {
    const actual = await Deno.readFile(url).catch(() => new Uint8Array());
    if (
      actual.length !== expected.length ||
      actual.some((value, index) => value !== expected[index])
    ) throw new Error(`Stale generated file: ${url.pathname}`);
  }
} else {
  await Deno.mkdir(distDirectory, { recursive: true });
  for (const [url, bytes] of outputs) await Deno.writeFile(url, bytes);
}
console.log(
  JSON.stringify({
    kind: check ? "sandom/color-build-check" : "sandom/color-build",
    sourceDigest,
    aggregateDigest,
    binaryBytes: wasm.length,
  }),
);
