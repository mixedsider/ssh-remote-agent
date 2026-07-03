import { describe, expect, it } from "bun:test";
import { assertMountLive, buildMountCheckCommand, MountNotLiveError } from "./mount-guard.ts";

describe("buildMountCheckCommand", () => {
  it("checks mountpoint and a sentinel stat for the given root", () => {
    const cmd = buildMountCheckCommand("/home/user/proj");
    expect(cmd).toContain("mountpoint -q '/home/user/proj'");
    expect(cmd).toContain("stat '/home/user/proj'");
  });

  it("shell-quotes a mount root containing spaces", () => {
    const cmd = buildMountCheckCommand("/home/user/my proj");
    expect(cmd).toContain("mountpoint -q '/home/user/my proj'");
  });
});

describe("assertMountLive", () => {
  it("resolves when the checker reports the mount is live", async () => {
    // Given a checker that returns exit code 0
    const runner = async () => 0;
    // When asserting / Then it does not throw
    await assertMountLive("/home/user/proj", runner);
  });

  it("throws MountNotLiveError when the checker reports a nonzero exit", async () => {
    const runner = async () => 1;
    await expect(assertMountLive("/home/user/proj", runner)).rejects.toThrow(MountNotLiveError);
  });

  it("includes the mount root in the error to aid debugging", async () => {
    const runner = async () => 1;
    await expect(assertMountLive("/data/x", runner)).rejects.toThrow("/data/x");
  });

  it("treats a checker throw (timeout / spawn failure) as mount-not-live", async () => {
    const runner = async () => {
      throw new Error("spawn timeout");
    };
    await expect(assertMountLive("/home/user/proj", runner)).rejects.toThrow(MountNotLiveError);
  });
});
