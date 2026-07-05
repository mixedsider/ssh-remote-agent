import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCli, type CliDependencies } from "./cli.ts";
import type { Registry } from "./registry.ts";
import { SshConnectivityError, type SshConnectivityInput } from "./ssh-connectivity.ts";

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
) as { readonly version: string };

function createDeps(input: {
  readonly registry: Registry;
  readonly check: (target: SshConnectivityInput) => void;
  readonly onSave: (registry: Registry) => void;
}): CliDependencies {
  return {
    registryPath: () => "/tmp/ssh-remote-agent-test/remotes.jsonc",
    loadRegistry: () => input.registry,
    saveRegistry: (_path, registry) => input.onSave(registry),
    checkSshConnectivity: input.check,
  };
}

describe("cli remote add", () => {
  test("prints the package version for --version", async () => {
    const output: string[] = [];
    const program = buildCli(
      createDeps({
        registry: {},
        check: () => {},
        onSave: () => {},
      }),
    )
      .exitOverride()
      .configureOutput({
        writeOut: (text) => output.push(text),
        writeErr: (text) => output.push(text),
      });

    await expect(program.parseAsync(["--version"], { from: "user" })).rejects.toMatchObject({
      code: "commander.version",
    });

    expect(output.join("")).toBe(`${packageJson.version}\n`);
  });

  test("checks ssh connectivity before saving a new remote", async () => {
    const checked: SshConnectivityInput[] = [];
    let saved: Registry | undefined;
    const program = buildCli(
      createDeps({
        registry: {},
        check: (target) => checked.push(target),
        onSave: (registry) => {
          saved = registry;
        },
      }),
    );

    await program.parseAsync(
      ["remote", "add", "mint@192.168.0.84", "--key", "mint", "--identity", "/root/.ssh/mint"],
      { from: "user" },
    );

    expect(checked).toEqual([
      {
        sshHost: "mint@192.168.0.84",
        port: undefined,
        identityFile: "/root/.ssh/mint",
      },
    ]);
    expect(saved).toEqual({
      mint: { host: "192.168.0.84", user: "mint", identityFile: "/root/.ssh/mint" },
    });
  });

  test("does not save the registry when ssh connectivity fails", async () => {
    let saveCount = 0;
    const program = buildCli(
      createDeps({
        registry: {},
        check: () => {
          throw new SshConnectivityError({ sshHost: "mint" }, { status: 255, signal: null });
        },
        onSave: () => {
          saveCount += 1;
        },
      }),
    );

    await expect(
      program.parseAsync(["remote", "add", "mint", "--key", "mint"], { from: "user" }),
    ).rejects.toThrow(SshConnectivityError);
    expect(saveCount).toBe(0);
  });
});
