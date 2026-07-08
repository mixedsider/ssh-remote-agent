<div align='center' class='hidden'>
    <br/>
    <br/>
    <h3>ssh-remote-agent</h3>
    <p>Run opencode on remote machines through SSHFS and SSH.</p>
    <br/>
    <br/>
</div>

# ssh-remote-agent

English | [한국어](README.ko.md)

`ssh-remote-agent` is a Bun-based CLI and opencode plugin that lets you run **opencode
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

- **File operations**: `ssh-remote-agent` mounts the remote project directory at the
  current local project path. opencode file tools such as read, edit, write, and
  grep operate on the remote files through that mount.
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

For normal use, install the standalone binary from the latest GitHub Release.
It is a single executable file, so the target machine does not need a git
checkout or a local TypeScript build.

```bash
curl -L https://github.com/mixedsider/ssh-agent/releases/latest/download/ssh-remote-agent \
  -o ssh-remote-agent
chmod +x ssh-remote-agent
sudo install -m 755 ssh-remote-agent /usr/local/bin/ssh-remote-agent
ssh-remote-agent --help
```

Optionally verify the checksum before installing:

```bash
curl -L https://github.com/mixedsider/ssh-agent/releases/latest/download/ssh-remote-agent.sha256 \
  -o ssh-remote-agent.sha256
sha256sum -c ssh-remote-agent.sha256
```

Release maintainers can create that single-file binary with Bun:

```bash
bun run build:standalone
```

The generated file is `dist/ssh-remote-agent`.

For a development checkout, install dependencies and build the package.

```bash
bun install
bun run build
```

After build, the CLI entrypoint is generated at `dist/cli.js`. When installed as
a package, the command name is `ssh-remote-agent`.

To run the CLI directly from a development checkout:

```bash
bun src/cli.ts --help
```

## Prepare SSH key access

`ssh-remote-agent` requires passwordless SSH access from the main machine to the remote
machine. If you do not already have a key for that remote, create one on the
main machine:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gpu_key -C "gpu ssh-remote-agent access"
```

This creates two files:

- `~/.ssh/gpu_key`: the **private key**. Keep this on the main machine and pass
  this path to `--identity`.
- `~/.ssh/gpu_key.pub`: the public key. Install this on the remote machine.

Copy the public key to the remote user's `authorized_keys`:

```bash
ssh-copy-id -i ~/.ssh/gpu_key.pub user@10.0.0.5
```

If `ssh-copy-id` is unavailable, append the public key manually on the remote
machine:

```bash
cat ~/.ssh/gpu_key.pub | ssh user@10.0.0.5 \
  'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

Confirm SSH works without a password prompt before registering the remote:

```bash
ssh -i ~/.ssh/gpu_key -o BatchMode=yes user@10.0.0.5 true
```

Do not pass the `.pub` file to `--identity`. `ssh-remote-agent remote add --identity`
must receive the private key path, such as `~/.ssh/gpu_key`.

## 1. Register a remote server

Register each remote server under a **key**. Project configs refer to this key.

### Register a direct SSH target

```bash
ssh-remote-agent remote add user@10.0.0.5 --key gpu
```

If you need a port or identity file, pass them at registration time. The
identity file must be the **private key**, not the `.pub` public key.

```bash
ssh-remote-agent remote add user@10.0.0.5 \
  --key gpu \
  --port 2222 \
  --identity ~/.ssh/gpu_key
```

`remote add` runs a noninteractive SSH connectivity check before writing the
registry. It uses `BatchMode=yes`, so password prompts are rejected instead of
hanging. If the host, port, alias, or private key is wrong, the command exits
non-zero and the registry is left unchanged.

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
ssh-remote-agent remote add --key gpu --ssh-host my-gpu
```

### List and remove remotes

```bash
ssh-remote-agent remote list
ssh-remote-agent remote remove gpu
```

The registry is stored at the legacy compatibility path `~/.ssh-agent/remotes.jsonc` by
default. Override the base directory with `SSH_AGENT_HOME`.

```bash
SSH_AGENT_HOME=~/.config/ssh-remote-agent ssh-remote-agent remote list
```

## 2. Initialize a project for remote mode

Run `init` from the local project directory you want opencode to use. The local
directory may differ from the remote absolute path; only the project contents
need to correspond.

```bash
cd /root/my-project
ssh-remote-agent init --remote gpu:/home/user/my-project
```

The `--remote` value uses the `<key>:<remote-absolute-path>` format.

- `gpu`: the remote key registered earlier
- `/home/user/my-project`: the real absolute project path on the remote machine
- `/root/my-project`: the local SSHFS mount point because that is where `init` ran

On success, the project gets this file:

```text
.opencode/ssh-agent.jsonc
```

Example:

```jsonc
// ssh-remote-agent remote-mode config. Delete this file to return to local mode.
{
  "key": "gpu",
  "remotePath": "/home/user/my-project",
  "mountRoot": "/root/my-project"
}
```

By default, `init` writes the config and attempts to mount the remote directory.
Use `--no-mount` when you only want to write the config.

```bash
ssh-remote-agent init --remote gpu:/home/user/my-project --no-mount
```

## 3. Configure the opencode plugin

`ssh-remote-agent` is designed to work with opencode, Oh My OpenAgent, and
Kimaki from the main machine. The recommended setup is to register the plugin
globally once, then opt in per project with `.opencode/ssh-agent.jsonc`.

### Global opencode plugin

Add the plugin to the global opencode config:

```text
~/.config/opencode/opencode.json
```

If `ssh-remote-agent` is installed as a package that opencode can resolve, use
the package plugin spec:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["ssh-remote-agent/plugin"]
}
```

If you installed only the standalone release binary, opencode still needs a
plugin module path. Use a built checkout and register the plugin by file URL:

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///root/.kimaki/projects/ssh-agent/dist/plugin/remote-ssh.js"]
}
```

Build that plugin file from a checkout with:

```bash
bun install
bun run build
```

opencode loads config only at startup. Restart opencode, Oh My OpenAgent, or the
Kimaki session after changing the global config.

### Project-local plugin

You can also add the plugin only to one project's `opencode.json` or
`opencode.jsonc`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["ssh-remote-agent/plugin"]
}
```

After that, opencode behaves like this in the project:

- File tools read and write through the SSHFS-mounted remote project.
- Bash tools run on the registered remote server over SSH.
- If `.opencode/ssh-agent.jsonc` is missing, the plugin does nothing, even when
  it is registered globally.

## 4. Manage mounts

Mount the remote project again:

```bash
cd /root/my-project
ssh-remote-agent mount gpu:/home/user/my-project
```

Check whether the mount is live:

```bash
ssh-remote-agent status /root/my-project
```

Unmount it:

```bash
ssh-remote-agent unmount /root/my-project
```

## 5. Typical workflow

Register the remote once.

```bash
ssh-remote-agent remote add --key gpu --ssh-host my-gpu
```

Enable remote mode in the project.

```bash
cd /root/my-project
ssh-remote-agent init --remote gpu:/home/user/my-project
```

Register the opencode plugin globally once, or add it to this project's
`opencode.jsonc`.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["ssh-remote-agent/plugin"]
}
```

Then run opencode as usual. File edits go through the SSHFS mount, and test or
build commands run remotely over SSH.

For Kimaki, register the local mount path as the project and start new sessions
from that path. For example, local `/root/my-project` can mount remote
`gpu:/home/user/my-project`, and Kimaki should use `/root/my-project` as the
project directory.

## Return to local mode

Delete the project config file.

```bash
rm .opencode/ssh-agent.jsonc
```

Unmount if needed.

```bash
ssh-remote-agent unmount /root/my-project
```

## Notes and limitations

### Local mount path versus remote path

`ssh-remote-agent` mounts the remote project path at the local directory where
you run `init` or `mount`. For example, local `/root/my-project` can mount remote
`/home/user/my-project`.

Keep opencode and Kimaki sessions inside that local mount path so file tools see
the mounted remote files.

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

### CT/LXC/container environments need `/dev/fuse`

SSHFS requires the FUSE device from the host. In CT, LXC, Docker, or similar
container environments, installing `sshfs` inside the container is not enough.
The host or provider must expose `/dev/fuse` to the container.

Check inside the container:

```bash
ls -l /dev/fuse
```

If it is missing, SSHFS mount attempts fail with an error like this:

```text
fuse: device /dev/fuse not found. Kernel module not loaded?
```

The exact configuration depends on the host. For LXC/Proxmox-style CTs, the
host-side settings often include FUSE support and a bind mount for `/dev/fuse`,
for example:

```text
features: fuse=1,nesting=1
lxc.cgroup2.devices.allow: c 10:229 rwm
lxc.mount.entry: /dev/fuse dev/fuse none bind,create=file 0 0
```

Use the equivalent option for your container platform. After enabling it,
restart the container and confirm `/dev/fuse` exists before running
`ssh-remote-agent mount`.

### opencode tools fail after the mount drops

This is intentional. The plugin fails closed to avoid local shadow writes.
Remount the project.

```bash
ssh-remote-agent mount gpu:/home/user/my-project
```

### The remote key is not found

Check the registry.

```bash
ssh-remote-agent remote list
```

If you use a custom registry location, use the same `SSH_AGENT_HOME` value.

```bash
SSH_AGENT_HOME=~/.config/ssh-remote-agent ssh-remote-agent remote list
```

### opencode still runs locally

Check these items:

1. `.opencode/ssh-agent.jsonc` exists in the project root.
2. `opencode.json` includes `"ssh-remote-agent/plugin"`.
3. `ssh-remote-agent status <mountRoot>` reports a live mount.

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
