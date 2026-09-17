const expected = new Set([
  "package.json",
  "README.md",
  "DESIGN.md",
  "LICENSE",
  "NOTICE",
  "dist/color.wasm",
  "dist/color.wat",
  "dist/color.build.json",
  "src/color.manifest.json",
  "src/color-module.watpart",
  "src/color-kernel.watpart",
  "src/color-abi.watpart",
  "src/color-runtime.watpart",
  "src/color-packing.watpart",
  "src/color-source.watpart",
  "src/color-profile.watpart",
  "src/color-output.watpart",
  "docs/abi.md",
  "docs/composition.md",
  "docs/legal/fixtures.md",
]);

const result = await new Deno.Command("npm", {
  args: ["pack", "--dry-run", "--json", "--ignore-scripts"],
  stdout: "piped",
  stderr: "piped",
}).output();
if (!result.success) {
  throw new Error(new TextDecoder().decode(result.stderr).trim());
}
const report = JSON.parse(new TextDecoder().decode(result.stdout));
const files = new Set(report[0]?.files?.map(({ path }) => path));
for (const path of expected) {
  if (!files.has(path)) throw new Error(`Package is missing ${path}`);
}
for (const path of files) {
  if (/\.(?:js|mjs|cjs|ts|tsx|jsx|c|cc|cpp|h|rs)$/.test(path)) {
    throw new Error(`Package contains prohibited runtime source ${path}`);
  }
}
console.log(
  JSON.stringify({ kind: "sandom/color-package-check", files: files.size }),
);
