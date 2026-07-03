import { shellQuote } from "./shell-quote.ts";

/**
 * Inputs for building the local wrapper command that delegates a single bash
 * invocation to a remote host over SSH.
 */
export type RemoteExecInput = {
  /** Registry key or `~/.ssh/config` alias (or `user@host`). Must be whitelist-safe. */
  readonly host: string;
  readonly port: number | undefined;
  readonly identityFile: string | undefined;
  /** Absolute working directory on the remote (identical to the local mount by design). */
  readonly remoteWorkdir: string;
  /** Local SSHFS mount point to flush before executing remotely. */
  readonly mountRoot: string;
  /** The original, arbitrary command produced by the agent. */
  readonly command: string;
};

/**
 * SSH hostnames / aliases may only contain characters that are safe as a bare
 * argument AND cannot be mistaken for an SSH option. A leading `-` is rejected
 * because ssh would interpret it as a flag (e.g. `-oProxyCommand=...`).
 */
const SSH_HOST_PATTERN = /^[A-Za-z0-9]([A-Za-z0-9._@-]*)$/;

export function isValidSshHost(host: string): boolean {
  return SSH_HOST_PATTERN.test(host);
}

export class InvalidHostError extends Error {
  override readonly name = "InvalidHostError";
  readonly host: string;
  constructor(host: string) {
    super(
      `Refusing to use unsafe SSH host ${JSON.stringify(host)}. ` +
        "Hosts must be a registry key or ssh_config alias with no shell metacharacters.",
    );
    this.host = host;
  }
}

/**
 * Build the local shell command that runs one agent command on the remote host.
 *
 * Strategy (per Oracle review): the arbitrary command is base64-encoded so it
 * never appears on any shell command line — avoiding all quoting/injection
 * landmines with nested quotes, backticks, `$`, heredocs, and newlines. On the
 * remote it is decoded and executed via `bash -se`, which reads the script from
 * stdin and returns the script's exit status. A `sync -f` barrier flushes the
 * SSHFS mount first so files edited through the mount are visible to the remote
 * command before it runs.
 *
 * @throws {InvalidHostError} when `host` is not whitelist-safe.
 */
export function buildRemoteCommand(input: RemoteExecInput): string {
  if (!isValidSshHost(input.host)) {
    throw new InvalidHostError(input.host);
  }

  const encoded = Buffer.from(input.command, "utf8").toString("base64");
  const quotedHost = shellQuote(input.host);
  const quotedWorkdir = shellQuote(input.remoteWorkdir);
  const quotedMount = shellQuote(input.mountRoot);
  const remoteScript = `cd ${quotedWorkdir} && exec bash -se`;
  const sshOptions = [
    "ssh",
    "-T",
    ...(input.port !== undefined ? ["-p", String(input.port)] : []),
    ...(input.identityFile !== undefined ? ["-i", shellQuote(input.identityFile)] : []),
    "--",
    quotedHost,
  ].join(" ");

  return [
    `sync -f ${quotedMount} 2>/dev/null || true`,
    `printf '%s' ${shellQuote(encoded)} | base64 -d | ${sshOptions} ${shellQuote(remoteScript)}`,
  ].join("\n");
}
