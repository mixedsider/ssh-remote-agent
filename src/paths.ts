import { homedir } from "node:os";
import { join } from "node:path";

/** Default location of the remote registry, overridable via `SSH_AGENT_HOME`. */
export function registryPath(): string {
  const home = process.env["SSH_AGENT_HOME"];
  const base = home !== undefined && home.length > 0 ? home : join(homedir(), ".ssh-agent");
  return join(base, "remotes.jsonc");
}
