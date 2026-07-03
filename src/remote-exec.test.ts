import { describe, expect, it } from "bun:test";
import { buildRemoteCommand, InvalidHostError, isValidSshHost } from "./remote-exec.ts";

describe("isValidSshHost", () => {
  it("accepts a plain ssh config alias", () => {
    expect(isValidSshHost("gpu-server")).toBe(true);
  });

  it("accepts user@host form", () => {
    expect(isValidSshHost("user@10.0.0.5")).toBe(true);
  });

  it("accepts dots underscores and hyphens", () => {
    expect(isValidSshHost("deploy_1@stg.example.com")).toBe(true);
  });

  it("rejects a host starting with a dash to prevent option injection", () => {
    expect(isValidSshHost("-oProxyCommand=evil")).toBe(false);
  });

  it("rejects hosts containing shell metacharacters", () => {
    expect(isValidSshHost("host; rm -rf /")).toBe(false);
    expect(isValidSshHost("host$(whoami)")).toBe(false);
    expect(isValidSshHost("host space")).toBe(false);
  });

  it("rejects an empty host", () => {
    expect(isValidSshHost("")).toBe(false);
  });
});

describe("buildRemoteCommand", () => {
  const base = {
    host: "gpu",
    port: undefined,
    identityFile: undefined,
    remoteWorkdir: "/home/user/proj",
    mountRoot: "/home/user/proj",
  };

  it("throws InvalidHostError when the host is not whitelist-safe", () => {
    expect(() => buildRemoteCommand({ ...base, host: "-oProxyCommand=x", command: "ls" })).toThrow(
      InvalidHostError,
    );
  });

  it("base64-encodes the original command so it never touches a shell command line", () => {
    const original = 'echo "$(whoami)"; rm -rf / && `reboot`';
    const wrapper = buildRemoteCommand({ ...base, command: original });
    const b64 = Buffer.from(original, "utf8").toString("base64");
    expect(wrapper).toContain(b64);
    // The raw dangerous command must not appear verbatim in the wrapper.
    expect(wrapper).not.toContain("rm -rf /");
  });

  it("includes a sync barrier for the mount root before the ssh call", () => {
    const wrapper = buildRemoteCommand({ ...base, command: "ls" });
    const syncIdx = wrapper.indexOf("sync -f '/home/user/proj'");
    const sshIdx = wrapper.indexOf("ssh ");
    expect(syncIdx).toBeGreaterThanOrEqual(0);
    expect(sshIdx).toBeGreaterThan(syncIdx);
  });

  it("uses ssh -T (no tty) and disconnects stdin logic from the command line", () => {
    const wrapper = buildRemoteCommand({ ...base, command: "ls" });
    expect(wrapper).toContain("ssh -T");
    expect(wrapper).toContain("-- 'gpu'");
  });

  it("passes port and identity options to ssh for direct registry targets", () => {
    const wrapper = buildRemoteCommand({
      ...base,
      port: 2222,
      identityFile: "/home/user/.ssh/gpu key",
      command: "ls",
    });
    expect(wrapper).toContain("ssh -T -p 2222 -i '/home/user/.ssh/gpu key' -- 'gpu'");
  });

  it("cd's into the shell-quoted remote workdir on the remote side", () => {
    const wrapper = buildRemoteCommand({
      ...base,
      remoteWorkdir: "/home/user/my proj",
      command: "ls",
    });
    // The remote script is itself shell-quoted for the ssh arg, so the inner
    // single quotes around the workdir become the '\'' idiom.
    expect(wrapper).toContain("cd '\\''/home/user/my proj'\\''");
  });

  it("executes the decoded command via bash -se reading stdin", () => {
    const wrapper = buildRemoteCommand({ ...base, command: "ls" });
    expect(wrapper).toContain("base64 -d");
    expect(wrapper).toContain("bash -se");
  });
});
