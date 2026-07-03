<div align='center' class='hidden'>
    <br/>
    <br/>
    <h3>ssh-agent</h3>
    <p>Run opencode on remote machines through SSHFS and SSH.</p>
    <br/>
    <br/>
</div>

# ssh-agent

English | [한국어](README.ko.md)

`ssh-agent` is a Bun-based CLI and opencode plugin that lets you run **opencode
and Oh My OpenAgent on your main machine** while the actual project files and
shell commands live on a **remote machine**.

Nothing agent-specific needs to be installed on the remote machine. It only
needs `sshd`. Files are accessed through an SSHFS mount, and `bash` commands are
delegated over SSH.

```text
main machine                         remote machine
opencode + omo                       project files + bash
read/edit/write -> SSHFS mount ----> mounted project directory
bash command    -> SSH command ----> build, test, git, scripts
```

## How it works

- **File operations**: `ssh-agent` mounts the remote project directory at the
  same absolute path on the main machine. opencode file tools such as read,
  edit, write, and grep operate on the remote files without path mapping.
- **Command execution**: the opencode plugin intercepts the `bash` tool before
  execution. It base64-encodes the original command and sends it to remote
  `bash -se` over SSH.
- **Fail-closed safety**: before file tools or bash run, the plugin checks that
  the SSHFS mount is still live. If the mount is gone, the tool fails instead of
  accidentally writing to the local filesystem.
- **Per-project opt-in**: remote mode is enabled only when the project has
  `.opencode/ssh-agent.jsonc`. Without that file, opencode behaves normally in
  local mode.

## Requirements

Main machine:

- Bun 1.3 or newer
- `ssh`
- `sshfs`
- SSH key based passwordless access to the remote

Remote machine:

- SSH server (`sshd`)
- The real project files
- The project tools you need, such as build tools, test runners, and git

## Installation

For a development checkout, install dependencies and build the package.

```bash
bun install
bun run build
```

After build, the CLI entrypoint is generated at `dist/cli.js`. When installed as
a package, the command name is `ssh-agent`.

To run the CLI directly from a development checkout:

```bash
bun src/cli.ts --help
```

## 1. Register a remote server

Register each remote server under a **key**. Project configs refer to this key.

### Register a direct SSH target

```bash
ssh-agent remote add user@10.0.0.5 --key gpu
```

If you need a port or identity file, pass them at registration time.

```bash
ssh-agent remote add user@10.0.0.5 \
  --key gpu \
  --port 2222 \
  --identity ~/.ssh/gpu_key
```

### Reuse a `~/.ssh/config` Host alias

If you already have a Host alias, you can reuse it directly.

```sshconfig
Host my-gpu
  HostName 10.0.0.5
  User user
  Port 2222
  IdentityFile ~/.ssh/gpu_key
```

```bash
ssh-agent remote add --key gpu --ssh-host my-gpu
```

### List and remove remotes

```bash
ssh-agent remote list
ssh-agent remote remove gpu
```

The registry is stored at `~/.ssh-agent/remotes.jsonc` by default. Override the
base directory with `SSH_AGENT_HOME`.

```bash
SSH_AGENT_HOME=~/.config/ssh-agent ssh-agent remote list
```

## 2. Initialize a project for remote mode

Run `init` from the project directory you want to use remotely.

```bash
cd /home/user/my-project
ssh-agent init --remote gpu:/home/user/my-project
```

The `--remote` value uses the `<key>:<remote-absolute-path>` format.

- `gpu`: the remote key registered earlier
- `/home/user/my-project`: the real absolute project path on the remote machine

On success, the project gets this file:

```text
.opencode/ssh-agent.jsonc
```

Example:

```jsonc
// ssh-agent remote-mode config. Delete this file to return to local mode.
{
  "key": "gpu",
  "remotePath": "/home/user/my-project",
  "mountRoot": "/home/user/my-project"
}
```

By default, `init` writes the config and attempts to mount the remote directory.
Use `--no-mount` when you only want to write the config.

```bash
ssh-agent init --remote gpu:/home/user/my-project --no-mount
```

## 3. Configure the opencode plugin

Add the plugin to the project's `opencode.json` or `opencode.jsonc`.

```jsonc
{
  "plugin": ["ssh-agent/plugin"]
}
```

After that, opencode behaves like this in the project:

- File tools read and write through the SSHFS-mounted remote project.
- Bash tools run on the registered remote server over SSH.
- If `.opencode/ssh-agent.jsonc` is missing, the plugin does nothing.

## 4. Manage mounts

Mount the remote project again:

```bash
ssh-agent mount gpu:/home/user/my-project
```

Check whether the mount is live:

```bash
ssh-agent status /home/user/my-project
```

Unmount it:

```bash
ssh-agent unmount /home/user/my-project
```

## 5. Typical workflow

Register the remote once.

```bash
ssh-agent remote add --key gpu --ssh-host my-gpu
```

Enable remote mode in the project.

```bash
cd /home/user/my-project
ssh-agent init --remote gpu:/home/user/my-project
```

Add the opencode plugin.

```jsonc
{
  "plugin": ["ssh-agent/plugin"]
}
```

Then run opencode as usual. File edits go through the SSHFS mount, and test or
build commands run remotely over SSH.

## Return to local mode

Delete the project config file.

```bash
rm .opencode/ssh-agent.jsonc
```

Unmount if needed.

```bash
ssh-agent unmount /home/user/my-project
```

## Notes and limitations

### Same absolute path mount

`ssh-agent` mounts remote `/home/user/my-project` locally at
`/home/user/my-project`. This removes the need for path mapping inside opencode.

The main machine must be able to create the same absolute path as a mount point.

### Split-brain paths

Inside the project directory, file operations see the remote files. Outside the
project directory, absolute paths can differ between the main and remote
machines.

Be careful with paths such as:

- `$HOME`
- `/tmp`
- `/etc`
- tool cache directories
- absolute symlinks pointing outside the project

File tools use the main machine's filesystem view, while bash runs on the remote
machine. Keep work inside the project directory whenever possible.

### Authentication

Password prompts are not supported. Configure SSH key based passwordless access
first.

```bash
ssh my-gpu true
```

That command should succeed without prompting for a password.

## Troubleshooting

### `sshfs` is missing

Install SSHFS on the main machine and confirm it is available.

```bash
sshfs --version
```

### opencode tools fail after the mount drops

This is intentional. The plugin fails closed to avoid local shadow writes.
Remount the project.

```bash
ssh-agent mount gpu:/home/user/my-project
```

### The remote key is not found

Check the registry.

```bash
ssh-agent remote list
```

If you use a custom registry location, use the same `SSH_AGENT_HOME` value.

```bash
SSH_AGENT_HOME=~/.config/ssh-agent ssh-agent remote list
```

### opencode still runs locally

Check these items:

1. `.opencode/ssh-agent.jsonc` exists in the project root.
2. `opencode.json` includes `"ssh-agent/plugin"`.
3. `ssh-agent status <mountRoot>` reports a live mount.

## Development

```bash
bun test
bun run typecheck
bun run lint
bun run build
```

Before publishing, `prepublishOnly` cleans `dist` and builds fresh outputs.

```bash
bun run prepublishOnly
```

See [docs/DESIGN.md](docs/DESIGN.md) for the full architecture and rationale.
