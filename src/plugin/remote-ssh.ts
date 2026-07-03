import type { Plugin } from "@opencode-ai/plugin";
import { loadRemoteConfig } from "../config.ts";
import { assertMountLive, type ExitCodeRunner } from "../mount-guard.ts";
import { registryPath } from "../paths.ts";
import { loadRegistry, resolveSshTarget } from "../registry.ts";
import { buildRemoteCommand } from "../remote-exec.ts";

/**
 * Tools whose file access must be routed to the SSHFS mount. Before any of them
 * runs in remote mode, the mount must be verified live, otherwise opencode would
 * silently touch the MAIN machine's filesystem at the identical local path.
 */
const FILE_TOOLS: ReadonlySet<string> = new Set([
  "read",
  "edit",
  "write",
  "grep",
  "glob",
  "list",
  "patch",
]);

const BASH_TOOL = "bash" as const;

/**
 * opencode plugin: run bash on a remote host over SSH while files live on an
 * SSHFS mount. Activates only when the project has an `.opencode/ssh-agent.jsonc`
 * config; otherwise it is a no-op and opencode behaves as a normal local agent.
 */
export const RemoteSshPlugin: Plugin = async ({ app, $ }) => {
  const config = loadRemoteConfig(app.path.root);
  if (config === null) return {};
  const target = resolveSshTarget(loadRegistry(registryPath()), config.key);

  const runner: ExitCodeRunner = async (command) =>
    (await $`bash -c ${command}`.nothrow().quiet()).exitCode;

  return {
    "tool.execute.before": async (input, output) => {
      if (FILE_TOOLS.has(input.tool)) {
        await assertMountLive(config.mountRoot, runner);
        return;
      }

      if (input.tool === BASH_TOOL) {
        await assertMountLive(config.mountRoot, runner);
        const original: unknown = output.args.command;
        if (typeof original !== "string") return;
        const workdir: unknown = output.args.workdir;
        const remoteWorkdir =
          typeof workdir === "string" && workdir.length > 0 ? workdir : config.remotePath;
        output.args.command = buildRemoteCommand({
          host: target.sshHost,
          port: target.port,
          identityFile: target.identityFile,
          remoteWorkdir,
          mountRoot: config.mountRoot,
          command: original,
        });
      }
    },
  };
};
