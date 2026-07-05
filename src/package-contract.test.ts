import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

type ExportTarget = string | { readonly types: string; readonly default: string };

type PackageJson = {
  readonly name: string;
  readonly version: string;
  readonly bin: string;
  readonly main: string;
  readonly types: string;
  readonly exports: Record<string, ExportTarget>;
  readonly scripts: Record<string, string>;
  readonly devDependencies: Record<string, string>;
};

const root = join(import.meta.dir, "..");
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as PackageJson;

function expectExport(
  path: string,
  expected: { readonly types: string; readonly default: string },
): void {
  expect(packageJson.exports[path]).toEqual(expected);
}

describe("package contract", () => {
  test("publishes the renamed package identity", () => {
    expect(packageJson.name).toBe("ssh-remote-agent");
    expect(packageJson.version).toBe("0.2.2");
  });

  test("published entrypoints match source entrypoints", () => {
    expect(packageJson.bin).toBe("./dist/cli.js");
    expect(packageJson.main).toBe("./dist/index.js");
    expect(packageJson.types).toBe("./dist/index.d.ts");
    expectExport(".", { types: "./dist/index.d.ts", default: "./dist/index.js" });
    expectExport("./plugin", {
      types: "./dist/plugin/remote-ssh.d.ts",
      default: "./dist/plugin/remote-ssh.js",
    });
    expect(packageJson.exports["./package.json"]).toBe("./package.json");
    expect(existsSync(join(root, "src/cli.ts"))).toBe(true);
    expect(existsSync(join(root, "src/index.ts"))).toBe(true);
    expect(existsSync(join(root, "src/plugin/remote-ssh.ts"))).toBe(true);
  });

  test("cli source has a Bun shebang", () => {
    const cli = readFileSync(join(root, "src/cli.ts"), "utf8");
    expect(cli.startsWith("#!/usr/bin/env bun\n")).toBe(true);
  });

  test("publish uses a clean dist build", () => {
    expect(packageJson.scripts["prepublishOnly"]).toBe(
      'rimraf dist "*.tsbuildinfo" && bun run build',
    );
    expect(packageJson.devDependencies["rimraf"]).toBeDefined();
  });

  test("standalone build emits a single executable file", () => {
    expect(packageJson.scripts["build:standalone"]).toBe(
      "bun build --compile --minify ./src/cli.ts --outfile dist/ssh-remote-agent",
    );
  });
});
