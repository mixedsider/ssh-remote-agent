export { buildCli } from "./cli.ts";
export type { RemoteProjectConfig } from "./config.ts";
export { ConfigParseError, loadRemoteConfig, PROJECT_CONFIG_RELATIVE_PATH } from "./config.ts";
export type { InitInput, RemoteSpec } from "./init.ts";
export { InvalidRemoteSpecError, initProject, parseRemoteSpec } from "./init.ts";
export type { SshfsInput } from "./mount.ts";
export { buildSshfsCommand, buildUnmountCommand } from "./mount.ts";
export type { ExitCodeRunner } from "./mount-guard.ts";
export { assertMountLive, buildMountCheckCommand, MountNotLiveError } from "./mount-guard.ts";
export { registryPath } from "./paths.ts";
export type { Registry, RemoteEntry, RemoteListItem, SshTarget } from "./registry.ts";
export {
  addRemote,
  DuplicateRemoteError,
  listRemotes,
  loadRegistry,
  RegistryParseError,
  RemoteEntrySchema,
  RemoteNotFoundError,
  removeRemote,
  resolveSshTarget,
  saveRegistry,
} from "./registry.ts";
export type { RemoteExecInput } from "./remote-exec.ts";
export { buildRemoteCommand, InvalidHostError, isValidSshHost } from "./remote-exec.ts";
export { shellQuote } from "./shell-quote.ts";
