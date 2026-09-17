import { assembleWat } from "../tools/wat-assembler/assemble.js";
import {
  assert,
  exercisePaletteFixtures,
  hex,
  runtime,
} from "./test-helpers.js";

const root = decodeURIComponent(new URL("../", import.meta.url).pathname);
const fixture = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/color-kernel-fixtures.json", import.meta.url),
  ),
);
const paletteFixture = JSON.parse(
  await Deno.readTextFile(
    new URL("./fixtures/color-palette-fixtures.json", import.meta.url),
  ),
);

function commandOk(result, label) {
  if (!result.success) {
    throw new Error(`${label}: ${new TextDecoder().decode(result.stderr)}`);
  }
}

function f64Hex(value) {
  return hex(new Float64Array([value]));
}

Deno.test("published files install cleanly and compose the packed WAT authority", async () => {
  const temporary = await Deno.makeTempDir({ prefix: "sandom-color-package-" });
  try {
    const packed = await new Deno.Command("npm", {
      cwd: root,
      args: [
        "pack",
        "--json",
        "--ignore-scripts",
        "--pack-destination",
        temporary,
      ],
    }).output();
    commandOk(packed, "npm pack");
    const report = JSON.parse(new TextDecoder().decode(packed.stdout));
    assert(report.length === 1 && report[0].filename, "one package archive");

    const consumer = `${temporary}/consumer`;
    await Deno.mkdir(consumer);
    await Deno.writeTextFile(`${consumer}/package.json`, '{"private":true}');
    const installed = await new Deno.Command("npm", {
      cwd: consumer,
      args: [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        `${temporary}/${report[0].filename}`,
      ],
    }).output();
    commandOk(installed, "clean consumer install");

    const packageRoot = `${consumer}/node_modules/@sandom/color`;
    const packageJson = JSON.parse(
      await Deno.readTextFile(`${packageRoot}/package.json`),
    );
    for (const exported of Object.values(packageJson.exports)) {
      if (!exported.includes("*")) {
        await Deno.stat(`${packageRoot}/${exported.replace(/^\.\//, "")}`);
      }
    }

    const standaloneBytes = await Deno.readFile(
      `${packageRoot}/dist/color.wasm`,
    );
    const standalone = await WebAssembly.instantiate(standaloneBytes, {});
    assert(
      standalone.instance.exports.color_abi_version() === 2,
      "packed standalone ABI v2",
    );

    standalone.instance.exports.color_init();
    exercisePaletteFixtures(
      runtime(standalone.instance),
      paletteFixture,
      "packed standalone",
    );
    const manifest = JSON.parse(
      await Deno.readTextFile(`${packageRoot}/src/color.manifest.json`),
    );
    assert(
      manifest.embeddable.scratchBytes === 9728,
      "declared scratch extent",
    );
    assert(
      JSON.stringify(manifest.embeddable.requires) ===
        JSON.stringify(["memory", "$COLOR_BASE"]),
      "declared host requirements",
    );
    assert(
      JSON.stringify(manifest.embeddable.components) ===
        JSON.stringify(["color-abi.watpart", "color-kernel.watpart"]),
      "declared embeddable ABI and kernel order",
    );
    const components = await Promise.all(
      manifest.embeddable.components.map((name) =>
        Deno.readTextFile(`${packageRoot}/src/${name}`)
      ),
    );
    const composedWat = `(module
      (memory (export "memory") 1)
      (global $COLOR_BASE i32 (i32.const 0))
      ${components.join("\n")}
      (func (export "initialize") (call $colorInit))
    )`;
    const composedBytes = await assembleWat(
      composedWat,
      "packed WAT composition",
    );
    const composed = await WebAssembly.instantiate(composedBytes, {});
    const exports = composed.instance.exports;
    exports.initialize();
    const memory = exports.memory;
    const vector = new Float64Array(memory.buffer, 2048, 3);
    let cursor = 12288;
    const embeddedRuntime = {
      exports,
      memory,
      alloc(size) {
        const pointer = cursor;
        cursor = (cursor + Math.max(1, size) + 7) & ~7;
        assert(cursor <= memory.buffer.byteLength, "embedded fixture memory");
        return pointer;
      },
      copyIn(bytes) {
        const pointer = this.alloc(bytes.length);
        new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes);
        return pointer;
      },
      copyOut(pointer, length) {
        return new Uint8Array(memory.buffer, pointer, length).slice();
      },
      free() {
        return 0;
      },
    };
    exercisePaletteFixtures(embeddedRuntime, paletteFixture, "embedded");

    for (const entry of fixture.scalar) {
      assert(
        f64Hex(exports[entry.op](...entry.args)) === entry.expectedF64,
        `packed ${entry.op}`,
      );
    }
    for (const entry of fixture.tagged) {
      vector.set(entry.input);
      assert(
        exports.color_convert_tagged_to_working(
          entry.primaries,
          entry.transfer,
          entry.gamma,
          entry.missing,
        ) === 1,
        `packed ${entry.id} route`,
      );
      assert(hex(vector) === entry.expectedF64, `packed ${entry.id} bits`);
    }
    for (const entry of fixture.vector) {
      vector.set(entry.input);
      exports[entry.op](...entry.args);
      assert(hex(vector) === entry.expectedF64, `packed ${entry.op}`);
    }

    const encoder = new TextEncoder();
    for (const entry of fixture.css) {
      const bytes = encoder.encode(entry.text);
      new Uint8Array(memory.buffer, 4096, bytes.length).set(bytes);
      const status = exports.color_parse_css(bytes.length);
      assert(status === entry.status, `packed parser ${entry.text}`);
      if (status === 0) {
        assert(
          hex(new Uint8Array(memory.buffer, 2560, 80)) === entry.expectedRecord,
          `packed parser record ${entry.text}`,
        );
      }
    }
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
});
