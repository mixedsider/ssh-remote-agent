import { mkdirSync, writeFileSync } from "node:fs";
import { basename, isAbsolute, join } from "node:path";
import { PROJECT_CONFIG_RELATIVE_PATH, type RemoteProjectConfig } from "./config.ts";
import { type Registry, RemoteNotFoundError } from "./registry.ts";

export class InvalidRemoteSpecError extends Error {
  override readonly name = "InvalidRemoteSpecError";
  readonly spec: string;
  constructor(spec: string, reason: string) {
    super(
      `Invalid remote spec ${JSON.stringify(spec)}: ${reason}. Expected <key>[:<absolute-path>].`,
    );
    this.spec = spec;
  }
}

export type RemoteSpec = { readonly key: string; readonly remotePath: string | undefined };

/** Parse a `<key>[:<absolute-path>]` spec. */
export function parseRemoteSpec(spec: string): RemoteSpec {
  const colon = spec.indexOf(":");
  if (colon === -1) {
    if (spec.length === 0) throw new InvalidRemoteSpecError(spec, "empty spec");
    return { key: spec, remotePath: undefined };
  }
  const key = spec.slice(0, colon);
  const remotePath = spec.slice(colon + 1);
  if (key.length === 0) throw new InvalidRemoteSpecError(spec, "empty key");
  if (remotePath.length > 0 && !isAbsolute(remotePath)) {
    throw new InvalidRemoteSpecError(spec, "path must be absolute");
  }
  return { key, remotePath: remotePath.length > 0 ? remotePath : undefined };
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
  const { key, remotePath: specPath } = parseRemoteSpec(input.spec);

  const entry = input.registry[key];
  if (entry === undefined) throw new RemoteNotFoundError(key);

  let remotePath = specPath;
  if (remotePath === undefined) {
    const projectName = basename(input.projectRoot);
    let user = "user";
    if ("user" in entry && entry.user !== undefined) {
      user = entry.user;
    } else if ("host" in entry && entry.host.includes("@")) {
      user = entry.host.split("@")[0] || "user";
    } else if ("sshHost" in entry) {
      const at = entry.sshHost.indexOf("@");
      if (at > 0) {
        user = entry.sshHost.slice(0, at);
      }
    }
    remotePath = `/home/${user}/${projectName}`;
  }

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
