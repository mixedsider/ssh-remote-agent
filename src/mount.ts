import { shellQuote } from "./shell-quote.ts";

export type SshfsInput = {
  /** SSH target (`user@host` or `~/.ssh/config` alias). */
  readonly sshHost: string;
  /** Absolute path on the remote to mount. */
  readonly remotePath: string;
  /** Local mount point (identical to remotePath by design). */
  readonly mountRoot: string;
  /** Optional SSH port. */
  readonly port: number | undefined;
  /** Optional SSH identity file. */
  readonly identityFile: string | undefined;
};

/**
 * SSHFS reliability options (per Oracle review): auto-reconnect on drop, keepalive
 * probes to detect a dead link fast, and BatchMode so a missing key fails loudly
 * instead of hanging on a password prompt.
 */
const SSHFS_OPTIONS = [
  "reconnect",
  "ServerAliveInterval=15",
  "ServerAliveCountMax=3",
  "ConnectTimeout=10",
  "BatchMode=yes",
] as const;

/**
 * Build the `sshfs` command that mounts the remote project directory at the
 * identical local path. Port and identity file are folded into `-o` options so
 * the whole thing is a single invocation.
 */
export function buildSshfsCommand(input: SshfsInput): string {
  const options: string[] = [...SSHFS_OPTIONS];
  if (input.identityFile !== undefined) options.push(`IdentityFile=${input.identityFile}`);

  const parts = ["sshfs"];
  if (input.port !== undefined) parts.push(`-p ${input.port}`);
  parts.push(`-o ${shellQuote(options.join(","))}`);
  parts.push(shellQuote(`${input.sshHost}:${input.remotePath}`));
  parts.push(shellQuote(input.mountRoot));
  return parts.join(" ");
}

/** Build the unmount command, trying fusermount first then plain umount. */
export function buildUnmountCommand(mountRoot: string): string {
  const quoted = shellQuote(mountRoot);
  return `fusermount -u ${quoted} 2>/dev/null || umount ${quoted}`;
}
