import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadRemoteConfig } from "./config.ts";
import { InvalidRemoteSpecError, initProject, parseRemoteSpec } from "./init.ts";
import { addRemote, RemoteNotFoundError } from "./registry.ts";

describe("parseRemoteSpec", () => {
  it("splits key:path on the first colon", () => {
    expect(parseRemoteSpec("gpu:/home/user/proj")).toEqual({
      key: "gpu",
      remotePath: "/home/user/proj",
    });
  });

  it("keeps colons inside the path", () => {
    expect(parseRemoteSpec("gpu:/home/user/a:b")).toEqual({
      key: "gpu",
      remotePath: "/home/user/a:b",
    });
  });

  it("throws when there is no colon", () => {
    expect(() => parseRemoteSpec("gpu")).toThrow(InvalidRemoteSpecError);
  });

  it("throws when the key is empty", () => {
    expect(() => parseRemoteSpec(":/home/user/proj")).toThrow(InvalidRemoteSpecError);
  });

  it("throws when the path is empty", () => {
    expect(() => parseRemoteSpec("gpu:")).toThrow(InvalidRemoteSpecError);
  });

  it("requires an absolute remote path", () => {
    expect(() => parseRemoteSpec("gpu:relative/path")).toThrow(InvalidRemoteSpecError);
  });
});

describe("initProject", () => {
  it("writes a project config that loadRemoteConfig can read back", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ssh-agent-init-"));
    const registry = addRemote({}, "gpu", { host: "10.0.0.5", user: "user" });
    try {
      const config = initProject({ projectRoot, spec: "gpu:/home/user/proj", registry });
      expect(config).toEqual({
        key: "gpu",
        remotePath: "/home/user/proj",
        mountRoot: "/home/user/proj",
      });
      expect(loadRemoteConfig(projectRoot)).toEqual(config);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("writes JSONC with a header comment", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ssh-agent-init-"));
    const registry = addRemote({}, "gpu", { host: "10.0.0.5" });
    try {
      initProject({ projectRoot, spec: "gpu:/srv/app", registry });
      const raw = readFileSync(join(projectRoot, ".opencode", "ssh-agent.jsonc"), "utf8");
      expect(raw).toContain("//");
      expect(raw).toContain('"gpu"');
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  it("throws RemoteNotFoundError when the key is not registered", () => {
    const projectRoot = mkdtempSync(join(tmpdir(), "ssh-agent-init-"));
    try {
      expect(() => initProject({ projectRoot, spec: "ghost:/srv/app", registry: {} })).toThrow(
        RemoteNotFoundError,
      );
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
