import { describe, expect, it } from "bun:test";
import { buildSshfsCommand, buildUnmountCommand } from "./mount.ts";

describe("buildSshfsCommand", () => {
  const base = {
    sshHost: "user@10.0.0.5",
    remotePath: "/home/user/proj",
    mountRoot: "/home/user/proj",
    port: undefined,
    identityFile: undefined,
  };

  it("builds an sshfs command with reliability options", () => {
    const cmd = buildSshfsCommand(base);
    expect(cmd).toContain("sshfs");
    expect(cmd).toContain("reconnect");
    expect(cmd).toContain("ServerAliveInterval=15");
    expect(cmd).toContain("BatchMode=yes");
  });

  it("targets host:remotePath and the local mount root", () => {
    const cmd = buildSshfsCommand(base);
    expect(cmd).toContain("'user@10.0.0.5:/home/user/proj'");
    expect(cmd).toContain("'/home/user/proj'");
  });

  it("adds -p port when a port is given", () => {
    const cmd = buildSshfsCommand({ ...base, port: 2222 });
    expect(cmd).toContain("-p 2222");
  });

  it("omits -p when no port is given", () => {
    expect(buildSshfsCommand(base)).not.toContain("-p ");
  });

  it("adds IdentityFile option when an identity file is given", () => {
    const cmd = buildSshfsCommand({ ...base, identityFile: "/home/user/.ssh/gpu_key" });
    expect(cmd).toContain("IdentityFile=/home/user/.ssh/gpu_key");
  });

  it("keeps an identity file with spaces inside the quoted -o value", () => {
    const cmd = buildSshfsCommand({ ...base, identityFile: "/home/user/.ssh/gpu key" });
    expect(cmd).toContain("-o 'reconnect,");
    expect(cmd).toContain("IdentityFile=/home/user/.ssh/gpu key'");
  });

  it("shell-quotes a mount root with spaces", () => {
    const cmd = buildSshfsCommand({ ...base, mountRoot: "/home/user/my proj" });
    expect(cmd).toContain("'/home/user/my proj'");
  });
});

describe("buildUnmountCommand", () => {
  it("uses fusermount -u on the shell-quoted mount root", () => {
    expect(buildUnmountCommand("/home/user/proj")).toContain("fusermount -u '/home/user/proj'");
  });

  it("falls back to umount when fusermount is unavailable", () => {
    expect(buildUnmountCommand("/home/user/proj")).toContain("umount '/home/user/proj'");
  });
});
