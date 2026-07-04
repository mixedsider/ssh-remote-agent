import { describe, expect, test } from "bun:test";
import {
  buildSshConnectivityArgs,
  checkSshConnectivity,
  SshConnectivityError,
  type SshConnectivityRunner,
} from "./ssh-connectivity.ts";

describe("ssh connectivity preflight", () => {
  test("builds noninteractive ssh args for a direct target", () => {
    const args = buildSshConnectivityArgs({
      sshHost: "mint@192.168.0.84",
      port: 2222,
      identityFile: "/root/.ssh/mint key",
    });

    expect(args).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "-p",
      "2222",
      "-i",
      "/root/.ssh/mint key",
      "--",
      "mint@192.168.0.84",
      "true",
    ]);
  });

  test("builds noninteractive ssh args for an ssh config alias", () => {
    const args = buildSshConnectivityArgs({ sshHost: "mint-box" });

    expect(args).toEqual([
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "ConnectTimeout=10",
      "-o",
      "ServerAliveInterval=15",
      "-o",
      "ServerAliveCountMax=3",
      "--",
      "mint-box",
      "true",
    ]);
  });

  test("uses the injected runner and returns when ssh succeeds", () => {
    const calls: Array<{ readonly command: string; readonly args: readonly string[] }> = [];
    const runner: SshConnectivityRunner = (command, args) => {
      calls.push({ command, args });
      return { status: 0, signal: null };
    };

    checkSshConnectivity({ sshHost: "mint", identityFile: "/root/.ssh/mint" }, runner);

    expect(calls).toEqual([
      {
        command: "ssh",
        args: buildSshConnectivityArgs({ sshHost: "mint", identityFile: "/root/.ssh/mint" }),
      },
    ]);
  });

  test("throws a typed error when ssh fails", () => {
    const runner: SshConnectivityRunner = () => ({ status: 255, signal: null });

    expect(() => checkSshConnectivity({ sshHost: "mint" }, runner)).toThrow(SshConnectivityError);
  });
});
