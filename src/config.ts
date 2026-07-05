import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

/**
 * Per-project remote configuration, written by `ssh-remote-agent init` and read by the
 * opencode plugin at runtime. Its absence means "pure local mode".
 *
 * Stored at `<projectRoot>/.opencode/ssh-agent.jsonc`.
 */
export const RemoteProjectConfigSchema = z
  .object({
    /** Registry key identifying which remote to use (whitelist entry). */
    key: z.string().min(1),
    /** Absolute path on the remote machine where the project lives. */
    remotePath: z.string().min(1),
    /** Local SSHFS mount point. Identical to `remotePath` by design. */
    mountRoot: z.string().min(1),
  })
  .readonly();

export type RemoteProjectConfig = z.infer<typeof RemoteProjectConfigSchema>;

export const PROJECT_CONFIG_RELATIVE_PATH = ".opencode/ssh-agent.jsonc" as const;

/**
 * Load the per-project remote config from `<projectRoot>/.opencode/ssh-agent.jsonc`.
 *
 * @returns the parsed config, or `null` when the file does not exist (local mode).
 * @throws {ConfigParseError} when the file exists but is malformed.
 */
export function loadRemoteConfig(projectRoot: string): RemoteProjectConfig | null {
  const path = join(projectRoot, PROJECT_CONFIG_RELATIVE_PATH);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (e) {
    if (e instanceof Error && "code" in e && e.code === "ENOENT") return null;
    throw new ConfigParseError(path, e instanceof Error ? e.message : String(e));
  }

  let json: unknown;
  try {
    json = Bun.JSONC.parse(raw);
  } catch (e) {
    throw new ConfigParseError(path, e instanceof Error ? e.message : String(e));
  }

  const result = RemoteProjectConfigSchema.safeParse(json);
  if (!result.success) {
    throw new ConfigParseError(path, result.error.message);
  }
  return result.data;
}

export class ConfigParseError extends Error {
  override readonly name = "ConfigParseError";
  readonly path: string;
  constructor(path: string, reason: string) {
    super(`Failed to parse ssh-remote-agent config at ${path}: ${reason}`);
    this.path = path;
  }
}
