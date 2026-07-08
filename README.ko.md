<div align='center' class='hidden'>
    <br/>
    <br/>
    <h3>ssh-remote-agent</h3>
    <p>Run opencode on remote machines through SSHFS and SSH.</p>
    <br/>
    <br/>
</div>

# ssh-remote-agent

[English](README.md) | 한국어

`ssh-remote-agent`는 **메인 컴퓨터에서 opencode와 Oh My OpenAgent를 실행**하면서, 실제
프로젝트 파일과 shell 명령은 **원격 컴퓨터에서 처리**하게 해주는 Bun 기반 CLI와
opencode 플러그인입니다.

원격 컴퓨터에는 별도 에이전트나 런타임을 설치하지 않습니다. `sshd`만 있으면 됩니다.
파일은 SSHFS 마운트로 접근하고, `bash` 명령은 SSH로 원격 위임합니다.

```text
main machine                         remote machine
opencode + omo                       project files + bash
read/edit/write -> SSHFS mount ----> mounted project directory
bash command    -> SSH command ----> build, test, git, scripts
```

## 동작 방식

- **파일 작업**: 원격 프로젝트 경로를 로컬의 동일한 절대경로에 SSHFS로 마운트합니다.
  opencode의 read, edit, write, grep 같은 파일 도구는 경로 변환 없이 원격 파일을
  다룹니다.
- **명령 실행**: opencode 플러그인이 `bash` tool 실행 직전에 명령을 가로채고, 원본
  명령을 base64로 인코딩한 뒤 SSH를 통해 원격 `bash -se`로 전달합니다.
- **fail-closed 보호**: 파일 도구나 bash가 실행되기 전에 마운트가 살아있는지 확인합니다.
  마운트가 끊겼으면 로컬 파일을 잘못 건드리지 않도록 실패합니다.
- **프로젝트 단위 opt-in**: 프로젝트 루트에 `.opencode/ssh-agent.jsonc`가 있을 때만
  원격 모드로 동작합니다. 파일이 없으면 opencode는 평소처럼 로컬에서 실행됩니다.

## 요구사항

메인 컴퓨터:

- Bun 1.3 이상
- `ssh`
- `sshfs`
- 원격에 비밀번호 없이 접속 가능한 SSH key

원격 컴퓨터:

- SSH server (`sshd`)
- 실제 프로젝트 파일
- 프로젝트에서 사용하는 빌드, 테스트, git 등의 도구

## 설치

일반 사용자는 최신 GitHub Release의 standalone binary를 설치하는 방식을 권장합니다.
이 파일은 하나의 실행 파일이므로 사용하는 컴퓨터에서 git repo를 clone하거나
TypeScript build를 직접 실행할 필요가 없습니다.

```bash
curl -L https://github.com/mixedsider/ssh-agent/releases/latest/download/ssh-remote-agent \
  -o ssh-remote-agent
chmod +x ssh-remote-agent
sudo install -m 755 ssh-remote-agent /usr/local/bin/ssh-remote-agent
ssh-remote-agent --help
```

설치 전에 checksum을 확인하려면 다음을 실행합니다.

```bash
curl -L https://github.com/mixedsider/ssh-agent/releases/latest/download/ssh-remote-agent.sha256 \
  -o ssh-remote-agent.sha256
sha256sum -c ssh-remote-agent.sha256
```

release 관리자는 Bun으로 이 단일 실행 파일을 만들 수 있습니다.

```bash
bun run build:standalone
```

생성되는 파일은 `dist/ssh-remote-agent`입니다.

개발 중인 checkout에서 실행하려면 의존성을 설치하고 build합니다.

```bash
bun install
bun run build
```

build 후 CLI는 `dist/cli.js`로 생성됩니다. 패키지로 설치되어 있다면 명령 이름은
`ssh-remote-agent`입니다.

개발 checkout에서 바로 실행해야 한다면 다음처럼 Bun으로 CLI를 실행할 수 있습니다.

```bash
bun src/cli.ts --help
```

## SSH key 접속 준비

`ssh-remote-agent`는 메인 컴퓨터에서 원격 컴퓨터로 비밀번호 없이 SSH 접속할 수 있어야
합니다. 해당 원격 컴퓨터용 key가 아직 없다면 메인 컴퓨터에서 먼저 생성합니다.

```bash
ssh-keygen -t ed25519 -f ~/.ssh/gpu_key -C "gpu ssh-remote-agent access"
```

이 명령은 두 파일을 만듭니다.

- `~/.ssh/gpu_key`: **private key**입니다. 메인 컴퓨터에 보관하고
  `--identity`에는 이 경로를 지정합니다.
- `~/.ssh/gpu_key.pub`: public key입니다. 원격 컴퓨터에 등록합니다.

public key를 원격 사용자의 `authorized_keys`에 복사합니다.

```bash
ssh-copy-id -i ~/.ssh/gpu_key.pub user@10.0.0.5
```

`ssh-copy-id`를 사용할 수 없다면 원격 컴퓨터에 public key를 직접 추가합니다.

```bash
cat ~/.ssh/gpu_key.pub | ssh user@10.0.0.5 \
  'mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'
```

원격 서버를 등록하기 전에 비밀번호 프롬프트 없이 SSH가 되는지 확인합니다.

```bash
ssh -i ~/.ssh/gpu_key -o BatchMode=yes user@10.0.0.5 true
```

`--identity`에는 `.pub` 파일을 넣으면 안 됩니다. `ssh-remote-agent remote add
--identity`에는 `~/.ssh/gpu_key`처럼 private key 경로를 지정해야 합니다.

## 1. 원격 서버 등록

먼저 원격 서버를 **key**로 등록합니다. 이 key는 프로젝트 설정에서 재사용됩니다.

### 직접 SSH 대상 등록

```bash
ssh-remote-agent remote add user@10.0.0.5 --key gpu
```

포트나 identity file이 필요하면 같이 지정합니다. identity file은 `.pub` public
key가 아니라 **private key**여야 합니다.

```bash
ssh-remote-agent remote add user@10.0.0.5 \
  --key gpu \
  --port 2222 \
  --identity ~/.ssh/gpu_key
```

`remote add`는 레지스트리에 저장하기 전에 비대화식 SSH 접속 테스트를 실행합니다.
`BatchMode=yes`를 사용하므로 비밀번호 프롬프트가 뜨는 상황은 대기하지 않고
실패합니다. host, port, alias, private key 설정에 문제가 있으면 명령은 non-zero로
종료되고 레지스트리는 변경되지 않습니다.

### `~/.ssh/config` Host alias 재사용

이미 SSH config에 Host alias가 있다면 그대로 재사용할 수 있습니다.

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

### 등록 목록 확인과 삭제

```bash
ssh-remote-agent remote list
ssh-remote-agent remote remove gpu
```

레지스트리는 호환성을 위해 기존 경로인 `~/.ssh-agent/remotes.jsonc`에 기본 저장됩니다.
위치를 바꾸고 싶으면 `SSH_AGENT_HOME`을 지정합니다.

```bash
SSH_AGENT_HOME=~/.config/ssh-remote-agent ssh-remote-agent remote list
```

## 2. 프로젝트를 원격 모드로 초기화

opencode가 사용할 로컬 프로젝트 디렉터리에서 `init`을 실행합니다. 로컬 경로와 원격
절대경로는 달라도 됩니다. 프로젝트 내용만 같은 대상이면 됩니다.

```bash
cd /root/my-project
ssh-remote-agent init --remote gpu:/home/user/my-project
```

`--remote` 값은 `<key>:<remote-absolute-path>` 형식입니다.

- `gpu`: 앞에서 등록한 원격 key
- `/home/user/my-project`: 원격 컴퓨터의 실제 프로젝트 절대경로
- `/root/my-project`: `init`을 실행한 로컬 SSHFS 마운트 지점

초기화가 성공하면 프로젝트에 다음 파일이 생성됩니다.

```text
.opencode/ssh-agent.jsonc
```

예시는 다음과 같습니다.

```jsonc
// ssh-remote-agent remote-mode config. Delete this file to return to local mode.
{
  "key": "gpu",
  "remotePath": "/home/user/my-project",
  "mountRoot": "/root/my-project"
}
```

기본 `init`은 설정 파일을 쓰고 SSHFS 마운트까지 시도합니다. 설정 파일만 만들고
마운트는 나중에 하고 싶다면 `--no-mount`를 사용합니다.

```bash
ssh-remote-agent init --remote gpu:/home/user/my-project --no-mount
```

## 3. opencode 플러그인 설정

`ssh-remote-agent`는 메인 컴퓨터에서 실행되는 opencode, Oh My OpenAgent,
Kimaki와 함께 쓰도록 설계되어 있습니다. 권장 방식은 opencode 전역 설정에 플러그인을
한 번 등록하고, 각 프로젝트는 `.opencode/ssh-agent.jsonc`가 있을 때만 원격 모드로
opt-in 하는 방식입니다.

### opencode 전역 플러그인

opencode 전역 설정 파일에 플러그인을 추가합니다.

```text
~/.config/opencode/opencode.json
```

`ssh-remote-agent`가 opencode에서 resolve 가능한 package로 설치되어 있다면 package
plugin spec을 사용합니다.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["ssh-remote-agent/plugin"]
}
```

GitHub Release의 standalone binary만 설치했다면, opencode가 import할 plugin module은
별도로 필요합니다. 이 경우 build된 checkout의 plugin 파일을 file URL로 등록합니다.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["file:///root/.kimaki/projects/ssh-agent/dist/plugin/remote-ssh.js"]
}
```

checkout에서 이 plugin 파일을 만들려면 다음을 실행합니다.

```bash
bun install
bun run build
```

opencode 설정은 시작할 때 로드됩니다. 전역 설정을 바꾼 뒤에는 opencode, Oh My
OpenAgent, 또는 Kimaki 세션을 새로 시작해야 적용됩니다.

### 프로젝트별 플러그인

특정 프로젝트에만 적용하고 싶다면 프로젝트의 `opencode.json` 또는 `opencode.jsonc`에
플러그인을 추가할 수도 있습니다.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["ssh-remote-agent/plugin"]
}
```

이후 같은 프로젝트에서 opencode를 실행하면 다음처럼 동작합니다.

- 파일 도구: SSHFS 마운트된 원격 프로젝트 파일을 읽고 씁니다.
- bash 도구: 등록된 원격 서버로 SSH 위임됩니다.
- `.opencode/ssh-agent.jsonc`가 없으면 전역 플러그인으로 등록되어 있어도 아무 것도 하지
  않습니다.

## 4. 마운트 관리

원격 프로젝트를 다시 마운트해야 할 때는 `mount`를 사용합니다.

```bash
cd /root/my-project
ssh-remote-agent mount gpu:/home/user/my-project
```

마운트 상태를 확인합니다.

```bash
ssh-remote-agent status /root/my-project
```

마운트를 해제합니다.

```bash
ssh-remote-agent unmount /root/my-project
```

## 5. 일반적인 사용 흐름

처음 한 번만 원격을 등록합니다.

```bash
ssh-remote-agent remote add --key gpu --ssh-host my-gpu
```

프로젝트에서 원격 모드를 켭니다.

```bash
cd /root/my-project
ssh-remote-agent init --remote gpu:/home/user/my-project
```

opencode 플러그인을 전역 설정에 한 번 등록하거나, 이 프로젝트의 `opencode.jsonc`에
추가합니다.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["ssh-remote-agent/plugin"]
}
```

그 다음 평소처럼 opencode를 실행합니다. opencode가 파일을 수정하면 SSHFS 마운트를
통해 원격 파일이 바뀌고, 테스트나 빌드 명령은 SSH를 통해 원격에서 실행됩니다.

Kimaki에서 사용할 때는 로컬 마운트 경로를 Kimaki 프로젝트로 등록하고, 새 세션을 그
경로에서 시작해야 합니다. 예를 들어 로컬 `/root/my-project`가 원격
`gpu:/home/user/my-project`를 마운트한다면 Kimaki 프로젝트 디렉터리는
`/root/my-project`여야 합니다.

## 로컬 모드로 되돌리기

프로젝트에서 원격 모드를 끄려면 설정 파일을 삭제합니다.

```bash
rm .opencode/ssh-agent.jsonc
```

필요하면 마운트도 해제합니다.

```bash
ssh-remote-agent unmount /root/my-project
```

## 주의사항

### 로컬 마운트 경로와 원격 경로

`ssh-remote-agent`는 `init` 또는 `mount`를 실행한 로컬 디렉터리에 원격 프로젝트 경로를
마운트합니다. 예를 들어 로컬 `/root/my-project`에 원격 `/home/user/my-project`를
마운트할 수 있습니다.

opencode와 Kimaki 세션은 이 로컬 마운트 경로 안에서 시작해야 파일 도구가 원격 파일을
보게 됩니다.

### split-brain 경로

프로젝트 디렉터리 내부는 안전하게 원격 파일을 보지만, 프로젝트 밖의 절대경로는 메인과
원격이 다를 수 있습니다.

예를 들어 다음 경로는 주의해야 합니다.

- `$HOME`
- `/tmp`
- `/etc`
- 도구 cache 경로
- 프로젝트 밖을 가리키는 절대 symlink

파일 도구는 메인 컴퓨터의 파일 시스템 관점에서 접근하고, bash는 원격 컴퓨터에서
실행됩니다. 프로젝트 내부 작업을 기준으로 사용하는 것이 가장 안전합니다.

### 인증 방식

비밀번호 입력 방식은 지원하지 않습니다. SSH key 기반 passwordless 접속을 먼저 설정해야
합니다.

```bash
ssh my-gpu true
```

위 명령이 비밀번호 입력 없이 성공해야 `ssh-remote-agent`도 안정적으로 동작합니다.

## 문제 해결

### `sshfs` 명령을 찾을 수 없음

메인 컴퓨터에 SSHFS를 설치해야 합니다.

```bash
sshfs --version
```

### CT/LXC/container 환경에서는 `/dev/fuse`가 필요합니다

SSHFS는 host의 FUSE device가 필요합니다. CT, LXC, Docker 같은 container 환경에서는
container 안에 `sshfs`를 설치하는 것만으로는 충분하지 않습니다. host나 provider가
container에 `/dev/fuse`를 노출해야 합니다.

container 안에서 확인합니다.

```bash
ls -l /dev/fuse
```

이 파일이 없다면 SSHFS mount는 보통 다음과 같은 에러로 실패합니다.

```text
fuse: device /dev/fuse not found. Kernel module not loaded?
```

정확한 설정 방법은 host 환경마다 다릅니다. LXC/Proxmox 스타일 CT에서는 host 쪽
설정에 FUSE 지원과 `/dev/fuse` bind mount가 필요할 수 있습니다. 예시는 다음과
같습니다.

```text
features: fuse=1,nesting=1
lxc.cgroup2.devices.allow: c 10:229 rwm
lxc.mount.entry: /dev/fuse dev/fuse none bind,create=file 0 0
```

사용 중인 container platform에 맞는 동일한 옵션을 적용하세요. 설정 후 container를
재시작하고 `/dev/fuse`가 존재하는지 확인한 뒤 `ssh-remote-agent mount`를 실행합니다.

### 마운트가 끊긴 뒤 opencode 도구가 실패함

의도된 동작입니다. 로컬 shadow write를 막기 위해 fail-closed로 실패합니다. 다시
마운트하세요.

```bash
ssh-remote-agent mount gpu:/home/user/my-project
```

### 등록한 key를 찾을 수 없음

등록 목록을 확인합니다.

```bash
ssh-remote-agent remote list
```

다른 레지스트리 위치를 쓰고 있다면 같은 `SSH_AGENT_HOME` 값을 사용해야 합니다.

```bash
SSH_AGENT_HOME=~/.config/ssh-remote-agent ssh-remote-agent remote list
```

### opencode가 계속 로컬에서만 동작함

다음을 확인합니다.

1. 프로젝트 루트에 `.opencode/ssh-agent.jsonc`가 있는지 확인합니다.
2. `opencode.json`에 `"ssh-remote-agent/plugin"`이 들어 있는지 확인합니다.
3. `ssh-remote-agent status <mountRoot>`로 마운트가 살아 있는지 확인합니다.

## 개발

```bash
bun test
bun run typecheck
bun run lint
bun run build
```

publish 전에 `prepublishOnly`가 `dist`를 정리하고 새로 build합니다.

```bash
bun run prepublishOnly
```

자세한 설계 배경은 [docs/DESIGN.md](docs/DESIGN.md)를 참고하세요.
