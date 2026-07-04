import { spawnSync } from "node:child_process";

const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10;
const DEFAULT_PROCESS_TIMEOUT_MS = 15_000;
const SERVER_ALIVE_INTERVAL_SECONDS = 15;
const SERVER_ALIVE_COUNT_MAX = 3;

export type SshConnectivityInput = {
  readonly sshHost: string;
  readonly port?: number | undefined;
  readonly identityFile?: string | undefined;
  readonly connectTimeoutSeconds?: number;
  readonly processTimeoutMs?: number;
};

export type SshConnectivityRunOptions = {
  readonly timeoutMs: number;
};

export type SshConnectivityRunResult = {
  readonly status: number | null;
  readonly signal: string | null;
  readonly error?: Error;
};

export type SshConnectivityRunner = (
  command: string,
  args: readonly string[],
  options: SshConnectivityRunOptions,
) => SshConnectivityRunResult;

type SshConnectivityErrorInput = {
  readonly sshHost: string;
  readonly port?: number | undefined;
  readonly identityFile?: string | undefined;
};

type SshConnectivityErrorResult = {
  readonly status: number | null;
  readonly signal: string | null;
  readonly error?: Error;
};

export class SshConnectivityError extends Error {
  override readonly name = "SshConnectivityError";
  readonly sshHost: string;
  readonly status: number | null;
  readonly signal: string | null;
  readonly reason: string;

  constructor(input: SshConnectivityErrorInput, result: SshConnectivityErrorResult) {
    const reason = describeFailure(result);
    super(`SSH connectivity check failed for ${JSON.stringify(input.sshHost)}: ${reason}`);
    this.sshHost = input.sshHost;
    this.status = result.status;
    this.signal = result.signal;
    this.reason = reason;
  }
}

function describeFailure(result: SshConnectivityErrorResult): string {
  if (result.error !== undefined) return result.error.message;
  if (result.signal !== null) return `terminated by signal ${result.signal}`;
  if (result.status !== null) return `ssh exited with status ${result.status}`;
  return "ssh did not report an exit status";
}

export function buildSshConnectivityArgs(input: SshConnectivityInput): readonly string[] {
  const connectTimeoutSeconds = input.connectTimeoutSeconds ?? DEFAULT_CONNECT_TIMEOUT_SECONDS;
  const args = [
    "-T",
    "-o",
    "BatchMode=yes",
    "-o",
    `ConnectTimeout=${connectTimeoutSeconds}`,
    "-o",
    `ServerAliveInterval=${SERVER_ALIVE_INTERVAL_SECONDS}`,
    "-o",
    `ServerAliveCountMax=${SERVER_ALIVE_COUNT_MAX}`,
  ];

  if (input.port !== undefined) args.push("-p", String(input.port));
  if (input.identityFile !== undefined) args.push("-i", input.identityFile);
  args.push("--", input.sshHost, "true");
  return args;
}

const defaultRunner: SshConnectivityRunner = (command, args, options) => {
  const result = spawnSync(command, [...args], { stdio: "ignore", timeout: options.timeoutMs });
  return {
    status: result.status,
    signal: result.signal,
    ...(result.error !== undefined ? { error: result.error } : {}),
  };
};

export function checkSshConnectivity(
  input: SshConnectivityInput,
  runner: SshConnectivityRunner = defaultRunner,
): void {
  const timeoutMs = input.processTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  const result = runner("ssh", buildSshConnectivityArgs(input), { timeoutMs });
  if (result.status === 0) return;
  throw new SshConnectivityError(input, result);
}
