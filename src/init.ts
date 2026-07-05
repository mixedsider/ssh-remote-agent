import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { PROJECT_CONFIG_RELATIVE_PATH, type RemoteProjectConfig } from "./config.ts";
import { type Registry, resolveSshTarget } from "./registry.ts";

export class InvalidRemoteSpecError extends Error {
  override readonly name = "InvalidRemoteSpecError";
  readonly spec: string;
  constructor(spec: string, reason: string) {
    super(
      `Invalid remote spec ${JSON.stringify(spec)}: ${reason}. Expected <key>:<absolute-path>.`,
    );
    this.spec = spec;
  }
}

export type RemoteSpec = { readonly key: string; readonly remotePath: string };

/** Parse a `<key>:<absolute-path>` spec, splitting on the first colon. */
export function parseRemoteSpec(spec: string): RemoteSpec {
  const colon = spec.indexOf(":");
  if (colon === -1) throw new InvalidRemoteSpecError(spec, "missing ':'");
  const key = spec.slice(0, colon);
  const remotePath = spec.slice(colon + 1);
  if (key.length === 0) throw new InvalidRemoteSpecError(spec, "empty key");
  if (remotePath.length === 0) throw new InvalidRemoteSpecError(spec, "empty path");
  if (!isAbsolute(remotePath)) throw new InvalidRemoteSpecError(spec, "path must be absolute");
  return { key, remotePath };
}

export type InitInput = {
  readonly projectRoot: string;
  readonly spec: string;
  readonly registry: Registry;
};

/**
 * Initialize a project for remote mode: resolve the registry key, then write
 * `<projectRoot>/.opencode/ssh-agent.jsonc`. The mount root is the local
 * project root; the remote path may differ.
 *
 * @throws {RemoteNotFoundError} when the key is not in the registry.
 * @throws {InvalidRemoteSpecError} when the spec is malformed.
 */
export function initProject(input: InitInput): RemoteProjectConfig {
  const { key, remotePath } = parseRemoteSpec(input.spec);
  // Validate the key exists (throws RemoteNotFoundError otherwise).
  resolveSshTarget(input.registry, key);

  const config: RemoteProjectConfig = { key, remotePath, mountRoot: input.projectRoot };
  const path = join(input.projectRoot, PROJECT_CONFIG_RELATIVE_PATH);
  const body = `// ssh-remote-agent remote-mode config. Delete this file to return to local mode.\n${JSON.stringify(
    config,
    null,
    2,
  )}\n`;
  mkdirSync(join(input.projectRoot, ".opencode"), { recursive: true });
  writeFileSync(path, body, "utf8");
  return config;
}
