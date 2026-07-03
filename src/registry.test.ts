import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  addRemote,
  DuplicateRemoteError,
  listRemotes,
  loadRegistry,
  RemoteNotFoundError,
  removeRemote,
  resolveSshTarget,
  saveRegistry,
} from "./registry.ts";

function tmpRegistryPath(): string {
  return join(mkdtempSync(join(tmpdir(), "ssh-agent-reg-")), "remotes.jsonc");
}

describe("loadRegistry", () => {
  it("returns an empty registry when the file does not exist", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ssh-agent-reg-")), "nope.jsonc");
    expect(loadRegistry(path)).toEqual({});
  });
});

describe("addRemote + saveRegistry + loadRegistry roundtrip", () => {
  it("adds a direct host entry and persists it", () => {
    const path = tmpRegistryPath();
    try {
      const reg = addRemote({}, "gpu", { host: "10.0.0.5", user: "user", port: 2222 });
      saveRegistry(path, reg);
      expect(loadRegistry(path)).toEqual({
        gpu: { host: "10.0.0.5", user: "user", port: 2222 },
      });
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });

  it("adds an ssh_config alias entry", () => {
    const reg = addRemote({}, "staging", { sshHost: "my-staging-alias" });
    expect(reg["staging"]).toEqual({ sshHost: "my-staging-alias" });
  });

  it("throws DuplicateRemoteError when the key already exists", () => {
    const reg = addRemote({}, "gpu", { host: "10.0.0.5" });
    expect(() => addRemote(reg, "gpu", { host: "10.0.0.6" })).toThrow(DuplicateRemoteError);
  });
});

describe("removeRemote", () => {
  it("removes an existing key", () => {
    const reg = addRemote({}, "gpu", { host: "10.0.0.5" });
    expect(removeRemote(reg, "gpu")).toEqual({});
  });

  it("throws RemoteNotFoundError for a missing key", () => {
    expect(() => removeRemote({}, "ghost")).toThrow(RemoteNotFoundError);
  });

  it("does not mutate the input registry", () => {
    const reg = addRemote({}, "gpu", { host: "10.0.0.5" });
    removeRemote(reg, "gpu");
    expect(reg["gpu"]).toBeDefined();
  });
});

describe("listRemotes", () => {
  it("returns keys sorted alphabetically", () => {
    let reg = addRemote({}, "zeta", { host: "z" });
    reg = addRemote(reg, "alpha", { host: "a" });
    expect(listRemotes(reg).map((r) => r.key)).toEqual(["alpha", "zeta"]);
  });
});

describe("resolveSshTarget", () => {
  it("resolves a direct entry to a ssh host string with user", () => {
    const reg = addRemote({}, "gpu", { host: "10.0.0.5", user: "user" });
    expect(resolveSshTarget(reg, "gpu")).toEqual({
      sshHost: "user@10.0.0.5",
      port: undefined,
      identityFile: undefined,
    });
  });

  it("resolves a direct entry without user to just the host", () => {
    const reg = addRemote({}, "gpu", { host: "10.0.0.5" });
    expect(resolveSshTarget(reg, "gpu")).toEqual({
      sshHost: "10.0.0.5",
      port: undefined,
      identityFile: undefined,
    });
  });

  it("resolves an alias entry to the ssh_config alias verbatim", () => {
    const reg = addRemote({}, "staging", { sshHost: "my-alias" });
    expect(resolveSshTarget(reg, "staging")).toEqual({
      sshHost: "my-alias",
      port: undefined,
      identityFile: undefined,
    });
  });

  it("carries the port through for a direct entry", () => {
    const reg = addRemote({}, "gpu", { host: "10.0.0.5", user: "u", port: 2222 });
    expect(resolveSshTarget(reg, "gpu")).toEqual({
      sshHost: "u@10.0.0.5",
      port: 2222,
      identityFile: undefined,
    });
  });

  it("carries the identity file through for a direct entry", () => {
    const reg = addRemote({}, "gpu", {
      host: "10.0.0.5",
      user: "u",
      identityFile: "/home/u/.ssh/gpu key",
    });
    expect(resolveSshTarget(reg, "gpu")).toEqual({
      sshHost: "u@10.0.0.5",
      port: undefined,
      identityFile: "/home/u/.ssh/gpu key",
    });
  });

  it("throws RemoteNotFoundError for a missing key", () => {
    expect(() => resolveSshTarget({}, "ghost")).toThrow(RemoteNotFoundError);
  });
});

describe("saveRegistry", () => {
  it("writes human-editable JSON that round-trips", () => {
    const path = tmpRegistryPath();
    try {
      saveRegistry(path, { gpu: { host: "10.0.0.5" } });
      const raw = readFileSync(path, "utf8");
      expect(raw).toContain('"gpu"');
      expect(JSON.parse(raw)).toEqual({ gpu: { host: "10.0.0.5" } });
    } finally {
      rmSync(path, { recursive: true, force: true });
    }
  });
});
