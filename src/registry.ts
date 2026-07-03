import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";

/**
 * A single remote entry. Either a direct target (`host` + optional user/port/key)
 * or a reference to a `~/.ssh/config` Host alias (`sshHost`), whose connection
 * details ssh resolves on its own.
 */
export const RemoteEntrySchema = z
  .union([
    z
      .object({
        host: z.string().min(1),
        user: z.string().min(1).optional(),
        port: z.number().int().positive().optional(),
        identityFile: z.string().min(1).optional(),
        basePath: z.string().min(1).optional(),
      })
      .strict(),
    z
      .object({
        sshHost: z.string().min(1),
        basePath: z.string().min(1).optional(),
      })
      .strict(),
  ])
  .readonly();

export type RemoteEntry = z.infer<typeof RemoteEntrySchema>;

export const RegistrySchema = z.record(z.string().min(1), RemoteEntrySchema);
export type Registry = z.infer<typeof RegistrySchema>;

export class DuplicateRemoteError extends Error {
  override readonly name = "DuplicateRemoteError";
  readonly key: string;
  constructor(key: string) {
    super(`Remote ${JSON.stringify(key)} already exists. Remove it first or pick another key.`);
    this.key = key;
  }
}

export class RemoteNotFoundError extends Error {
  override readonly name = "RemoteNotFoundError";
  readonly key: string;
  constructor(key: string) {
    super(`Remote ${JSON.stringify(key)} not found in the registry.`);
    this.key = key;
  }
}

export class RegistryParseError extends Error {
  override readonly name = "RegistryParseError";
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`Failed to parse remote registry at ${path}: ${reason}`);
    this.path = path;
  }
}

/** Load the registry, returning an empty one when the file is absent. */
export function loadRegistry(path: string): Registry {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return {};
    throw new RegistryParseError(path, e instanceof Error ? e.message : String(e));
  }

  let json: unknown;
  try {
    json = Bun.JSONC.parse(raw);
  } catch (e) {
    throw new RegistryParseError(path, e instanceof Error ? e.message : String(e));
  }

  const result = RegistrySchema.safeParse(json);
  if (!result.success) throw new RegistryParseError(path, result.error.message);
  return result.data;
}

/** Persist the registry as human-editable JSON, creating the directory if needed. */
export function saveRegistry(path: string, registry: Registry): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

/** Return a new registry with `key` added. Never mutates the input. */
export function addRemote(registry: Registry, key: string, entry: RemoteEntry): Registry {
  if (key in registry) throw new DuplicateRemoteError(key);
  return { ...registry, [key]: RemoteEntrySchema.parse(entry) };
}

/** Return a new registry with `key` removed. Never mutates the input. */
export function removeRemote(registry: Registry, key: string): Registry {
  if (!(key in registry)) throw new RemoteNotFoundError(key);
  const next = { ...registry };
  delete next[key];
  return next;
}

export type RemoteListItem = { readonly key: string; readonly entry: RemoteEntry };

/** List entries sorted by key. */
export function listRemotes(registry: Registry): readonly RemoteListItem[] {
  return Object.keys(registry)
    .sort()
    .map((key) => {
      const entry = registry[key];
      if (entry === undefined) throw new RemoteNotFoundError(key);
      return { key, entry };
    });
}

export type SshTarget = {
  readonly sshHost: string;
  readonly port: number | undefined;
  readonly identityFile: string | undefined;
};

/**
 * Resolve a registry key to the concrete SSH target used by ssh/sshfs. A direct
 * entry becomes `user@host` (or `host`); an alias entry is passed through so
 * ssh reads its own `~/.ssh/config`.
 */
export function resolveSshTarget(registry: Registry, key: string): SshTarget {
  const entry = registry[key];
  if (entry === undefined) throw new RemoteNotFoundError(key);
  if ("sshHost" in entry) {
    return { sshHost: entry.sshHost, port: undefined, identityFile: undefined };
  }
  const sshHost = entry.user !== undefined ? `${entry.user}@${entry.host}` : entry.host;
  return { sshHost, port: entry.port, identityFile: entry.identityFile };
}
