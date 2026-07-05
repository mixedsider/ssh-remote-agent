import { shellQuote } from "./shell-quote.ts";

/**
 * A function that runs a shell command and resolves to its exit code.
 * Injected so the guard is unit-testable without spawning real processes.
 */
export type ExitCodeRunner = (command: string) => Promise<number>;

/**
 * Build the shell command that verifies an SSHFS mount is live: the path must
 * be an actual mountpoint AND a cheap `stat` on it must succeed. `stat` catches
 * a mount that is registered but hung/stale (the FUSE endpoint is dead).
 */
export function buildMountCheckCommand(mountRoot: string): string {
  const quoted = shellQuote(mountRoot);
  return `mountpoint -q ${quoted} && stat ${quoted} >/dev/null 2>&1`;
}

export class MountNotLiveError extends Error {
  override readonly name = "MountNotLiveError";
  readonly mountRoot: string;
  constructor(mountRoot: string) {
    super(
      `SSHFS mount at ${mountRoot} is not live. Refusing to run remote-mode operations ` +
        "to avoid reading or writing the local machine's filesystem. " +
        "Re-mount with `ssh-remote-agent mount` and retry.",
    );
    this.mountRoot = mountRoot;
  }
}

/**
 * Fail closed if the SSHFS mount is not live. This is the primary guard against
 * the most dangerous failure mode: if the mount drops, an identical local path
 * still exists, so file tools would silently read/write the MAIN machine's
 * filesystem. Every remote-mode tool invocation must pass this first.
 *
 * @throws {MountNotLiveError} when the mount is missing, stale, or the check fails.
 */
export async function assertMountLive(mountRoot: string, runner: ExitCodeRunner): Promise<void> {
  let code: number;
  try {
    code = await runner(buildMountCheckCommand(mountRoot));
  } catch {
    // A spawn failure or timeout is indistinguishable from a dead mount here;
    // fail closed rather than risk touching the local filesystem.
    throw new MountNotLiveError(mountRoot);
  }
  if (code !== 0) throw new MountNotLiveError(mountRoot);
}
