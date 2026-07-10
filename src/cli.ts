#!/usr/bin/env bun

import { spawnSync } from "node:child_process";
import { Command } from "commander";
import packageJson from "../package.json" with { type: "json" };
import { initProject } from "./init.ts";
import { buildSshfsCommand, buildUnmountCommand } from "./mount.ts";
import { registryPath } from "./paths.ts";
import {
  addRemote,
  listRemotes,
  loadRegistry,
  type RemoteEntry,
  removeRemote,
  resolveSshTarget,
  saveRegistry,
} from "./registry.ts";
import { shellQuote } from "./shell-quote.ts";
import { checkSshConnectivity, type SshConnectivityInput } from "./ssh-connectivity.ts";

type RemoteAddOptions = {
  readonly sshHost?: string;
  readonly user?: string;
  readonly port?: string;
  readonly identity?: string;
  readonly base?: string;
};

function buildEntryFromOptions(target: string | undefined, opts: RemoteAddOptions): RemoteEntry {
  if (opts.sshHost !== undefined) {
    return opts.base !== undefined
      ? { sshHost: opts.sshHost, basePath: opts.base }
      : { sshHost: opts.sshHost };
  }
  if (target === undefined) {
    throw new UsageError("Provide either <user@host> or --ssh-host <alias>.");
  }
  const at = target.indexOf("@");
  const user = opts.user ?? (at > 0 ? target.slice(0, at) : undefined);
  const host = at > 0 ? target.slice(at + 1) : target;
  const port = opts.port !== undefined ? Number.parseInt(opts.port, 10) : undefined;
  if (port !== undefined && (!Number.isInteger(port) || port <= 0)) {
    throw new UsageError(`Invalid --port ${JSON.stringify(opts.port)}.`);
  }
  return {
    host,
    ...(user !== undefined ? { user } : {}),
    ...(port !== undefined ? { port } : {}),
    ...(opts.identity !== undefined ? { identityFile: opts.identity } : {}),
    ...(opts.base !== undefined ? { basePath: opts.base } : {}),
  };
}

class UsageError extends Error {
  override readonly name = "UsageError";
}

export type CliDependencies = {
  readonly registryPath: () => string;
  readonly loadRegistry: typeof loadRegistry;
  readonly saveRegistry: typeof saveRegistry;
  readonly checkSshConnectivity: (input: SshConnectivityInput) => void;
};

const defaultDependencies: CliDependencies = {
  registryPath,
  loadRegistry,
  saveRegistry,
  checkSshConnectivity,
};

function runShell(command: string): number {
  const result = spawnSync("bash", ["-c", command], { stdio: "inherit" });
  return result.status ?? 1;
}

function mountForConfig(
  registry: ReturnType<typeof loadRegistry>,
  key: string,
  remotePath: string,
  mountRoot: string,
): number {
  const target = resolveSshTarget(registry, key);

  // Ensure remote directory exists by running remote mkdir -p over SSH
  const sshOptions: string[] = ["-o BatchMode=yes", "-o ConnectTimeout=10"];
  if (target.identityFile !== undefined) {
    sshOptions.push(`-i ${shellQuote(target.identityFile)}`);
  }
  if (target.port !== undefined) {
    sshOptions.push(`-p ${target.port}`);
  }
  const mkdirCmd = `ssh ${sshOptions.join(" ")} ${shellQuote(target.sshHost)} mkdir -p ${shellQuote(remotePath)}`;
  runShell(mkdirCmd);

  process.stdout.write(`Mounting ${target.sshHost}:${remotePath} → ${mountRoot}\n`);
  return runShell(
    buildSshfsCommand({
      sshHost: target.sshHost,
      remotePath,
      mountRoot,
      port: target.port,
      identityFile: target.identityFile,
    }),
  );
}

export function buildCli(deps: CliDependencies = defaultDependencies): Command {
  const program = new Command();
  program
    .name("ssh-remote-agent")
    .description("Run opencode against a remote machine over SSH (files via SSHFS, bash via SSH).")
    .version(packageJson.version);

  const remote = program.command("remote").description("Manage the remote machine registry");

  remote
    .command("add")
    .argument("[user@host]", "direct SSH target")
    .requiredOption("--key <key>", "registry key (alias used by projects)")
    .option("--ssh-host <alias>", "reuse a ~/.ssh/config Host alias instead of user@host")
    .option("--user <user>", "SSH user (for user@host form)")
    .option("--port <port>", "SSH port")
    .option("--identity <path>", "SSH identity file")
    .option("--base <path>", "default base path on the remote")
    .action((target: string | undefined, opts: RemoteAddOptions & { key: string }) => {
      const path = deps.registryPath();
      const entry = buildEntryFromOptions(target, opts);
      const next = addRemote(deps.loadRegistry(path), opts.key, entry);
      deps.checkSshConnectivity(resolveSshTarget({ [opts.key]: entry }, opts.key));
      deps.saveRegistry(path, next);
      process.stdout.write(`Added remote ${JSON.stringify(opts.key)}.\n`);
    });

  remote
    .command("list")
    .description("List registered remotes")
    .action(() => {
      const items = listRemotes(deps.loadRegistry(deps.registryPath()));
      if (items.length === 0) {
        process.stdout.write("No remotes registered.\n");
        return;
      }
      for (const { key, entry } of items) {
        const target = "sshHost" in entry ? `alias:${entry.sshHost}` : entry.host;
        process.stdout.write(`${key}\t${target}\n`);
      }
    });

  remote
    .command("remove")
    .argument("<key>", "registry key to remove")
    .action((key: string) => {
      const path = deps.registryPath();
      deps.saveRegistry(path, removeRemote(deps.loadRegistry(path), key));
      process.stdout.write(`Removed remote ${JSON.stringify(key)}.\n`);
    });

  program
    .command("init")
    .description("Initialize the current project for remote mode and mount it")
    .requiredOption("--remote <key:path>", "registry key and absolute remote path")
    .option("--no-mount", "write config without mounting")
    .action((opts: { remote: string; mount: boolean }) => {
      const registry = deps.loadRegistry(deps.registryPath());
      const config = initProject({ projectRoot: process.cwd(), spec: opts.remote, registry });
      process.stdout.write(
        `Wrote .opencode/ssh-agent.jsonc for remote ${JSON.stringify(config.key)}.\n`,
      );
      if (opts.mount) {
        const code = mountForConfig(registry, config.key, config.remotePath, config.mountRoot);
        if (code !== 0) process.exitCode = code;
      }
    });

  program
    .command("mount")
    .argument("<key:path>", "registry key and absolute remote path")
    .description("Mount a remote path at the current local project path")
    .action((spec: string) => {
      const registry = deps.loadRegistry(deps.registryPath());
      const config = initProject({ projectRoot: process.cwd(), spec, registry });
      const code = mountForConfig(registry, config.key, config.remotePath, config.mountRoot);
      if (code !== 0) process.exitCode = code;
    });

  program
    .command("unmount")
    .argument("<mountRoot>", "local mount point to unmount")
    .action((mountRoot: string) => {
      const code = runShell(buildUnmountCommand(mountRoot));
      if (code !== 0) process.exitCode = code;
    });

  program
    .command("status")
    .argument("<mountRoot>", "local mount point to check")
    .description("Check whether a mount is live")
    .action((mountRoot: string) => {
      const code = runShell(`mountpoint -q '${mountRoot.replaceAll("'", "'\\''")}'`);
      process.stdout.write(code === 0 ? `${mountRoot}: live\n` : `${mountRoot}: not mounted\n`);
      if (code !== 0) process.exitCode = 1;
    });

  return program;
}

async function main(): Promise<void> {
  // no-excuse-ok: catch
  try {
    await buildCli().parseAsync(process.argv);
  } catch (e) {
    if (e instanceof Error) {
      process.stderr.write(`${e.name}: ${e.message}\n`);
    } else {
      process.stderr.write(`Unexpected error: ${String(e)}\n`);
    }
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  await main();
}
