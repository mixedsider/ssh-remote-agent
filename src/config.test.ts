import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfigParseError, loadRemoteConfig } from "./config.ts";

function makeProject(configBody: string | null): string {
  const root = mkdtempSync(join(tmpdir(), "ssh-remote-agent-cfg-"));
  if (configBody !== null) {
    mkdirSync(join(root, ".opencode"), { recursive: true });
    writeFileSync(join(root, ".opencode", "ssh-agent.jsonc"), configBody);
  }
  return root;
}

describe("loadRemoteConfig", () => {
  it("returns null when no config file exists (local mode)", () => {
    const root = makeProject(null);
    try {
      expect(loadRemoteConfig(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("parses a valid JSONC config with comments and trailing commas", () => {
    const root = makeProject(`{
      // which remote
      "key": "gpu",
      "remotePath": "/home/user/proj",
      "mountRoot": "/root/proj",
    }`);
    try {
      expect(loadRemoteConfig(root)).toEqual({
        key: "gpu",
        remotePath: "/home/user/proj",
        mountRoot: "/root/proj",
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws ConfigParseError when a required field is missing", () => {
    const root = makeProject(`{ "key": "gpu" }`);
    try {
      expect(() => loadRemoteConfig(root)).toThrow(ConfigParseError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("throws ConfigParseError on malformed JSON", () => {
    const root = makeProject(`{ not json`);
    try {
      expect(() => loadRemoteConfig(root)).toThrow(ConfigParseError);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
