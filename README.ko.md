<div align='center' class='hidden'>
    <br/>
    <br/>
    <h3>ssh-agent</h3>
    <p>Run opencode on remote machines through SSHFS and SSH.</p>
    <br/>
    <br/>
</div>

# ssh-agent

[English](README.md) | 한국어

`ssh-agent`는 **메인 컴퓨터에서 opencode와 Oh My OpenAgent를 실행**하면서, 실제
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

개발 중인 checkout에서 실행하려면 의존성을 설치하고 build합니다.

```bash
bun install
bun run build
```

build 후 CLI는 `dist/cli.js`로 생성됩니다. 패키지로 설치되어 있다면 명령 이름은
`ssh-agent`입니다.

개발 checkout에서 바로 실행해야 한다면 다음처럼 Bun으로 CLI를 실행할 수 있습니다.

```bash
bun src/cli.ts --help
```

## 1. 원격 서버 등록

먼저 원격 서버를 **key**로 등록합니다. 이 key는 프로젝트 설정에서 재사용됩니다.

### 직접 SSH 대상 등록

```bash
ssh-agent remote add user@10.0.0.5 --key gpu
```

포트나 identity file이 필요하면 같이 지정합니다.

```bash
ssh-agent remote add user@10.0.0.5 \
  --key gpu \
  --port 2222 \
  --identity ~/.ssh/gpu_key
```

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
ssh-agent remote add --key gpu --ssh-host my-gpu
```

### 등록 목록 확인과 삭제

```bash
ssh-agent remote list
ssh-agent remote remove gpu
```

레지스트리는 기본적으로 `~/.ssh-agent/remotes.jsonc`에 저장됩니다. 위치를 바꾸고
싶으면 `SSH_AGENT_HOME`을 지정합니다.

```bash
SSH_AGENT_HOME=~/.config/ssh-agent ssh-agent remote list
```

## 2. 프로젝트를 원격 모드로 초기화

작업하려는 프로젝트 디렉터리에서 `init`을 실행합니다.

```bash
cd /home/user/my-project
ssh-agent init --remote gpu:/home/user/my-project
```

`--remote` 값은 `<key>:<remote-absolute-path>` 형식입니다.

- `gpu`: 앞에서 등록한 원격 key
- `/home/user/my-project`: 원격 컴퓨터의 실제 프로젝트 절대경로

초기화가 성공하면 프로젝트에 다음 파일이 생성됩니다.

```text
.opencode/ssh-agent.jsonc
```

예시는 다음과 같습니다.

```jsonc
// ssh-agent remote-mode config. Delete this file to return to local mode.
{
  "key": "gpu",
  "remotePath": "/home/user/my-project",
  "mountRoot": "/home/user/my-project"
}
```

기본 `init`은 설정 파일을 쓰고 SSHFS 마운트까지 시도합니다. 설정 파일만 만들고
마운트는 나중에 하고 싶다면 `--no-mount`를 사용합니다.

```bash
ssh-agent init --remote gpu:/home/user/my-project --no-mount
```

## 3. opencode 플러그인 설정

프로젝트의 `opencode.json` 또는 `opencode.jsonc`에 플러그인을 추가합니다.

```jsonc
{
  "plugin": ["ssh-agent/plugin"]
}
```

이후 같은 프로젝트에서 opencode를 실행하면 다음처럼 동작합니다.

- 파일 도구: SSHFS 마운트된 원격 프로젝트 파일을 읽고 씁니다.
- bash 도구: 등록된 원격 서버로 SSH 위임됩니다.
- `.opencode/ssh-agent.jsonc`가 없으면 플러그인은 아무 것도 하지 않습니다.

## 4. 마운트 관리

원격 프로젝트를 다시 마운트해야 할 때는 `mount`를 사용합니다.

```bash
ssh-agent mount gpu:/home/user/my-project
```

마운트 상태를 확인합니다.

```bash
ssh-agent status /home/user/my-project
```

마운트를 해제합니다.

```bash
ssh-agent unmount /home/user/my-project
```

## 5. 일반적인 사용 흐름

처음 한 번만 원격을 등록합니다.

```bash
ssh-agent remote add --key gpu --ssh-host my-gpu
```

프로젝트에서 원격 모드를 켭니다.

```bash
cd /home/user/my-project
ssh-agent init --remote gpu:/home/user/my-project
```

opencode 설정에 플러그인을 추가합니다.

```jsonc
{
  "plugin": ["ssh-agent/plugin"]
}
```

그 다음 평소처럼 opencode를 실행합니다. opencode가 파일을 수정하면 SSHFS 마운트를
통해 원격 파일이 바뀌고, 테스트나 빌드 명령은 SSH를 통해 원격에서 실행됩니다.

## 로컬 모드로 되돌리기

프로젝트에서 원격 모드를 끄려면 설정 파일을 삭제합니다.

```bash
rm .opencode/ssh-agent.jsonc
```

필요하면 마운트도 해제합니다.

```bash
ssh-agent unmount /home/user/my-project
```

## 주의사항

### 동일 절대경로 마운트

`ssh-agent`는 원격 `/home/user/my-project`를 로컬에서도 `/home/user/my-project`에
마운트하는 방식을 사용합니다. 이렇게 해야 opencode 내부에서 별도 path mapping이
필요 없습니다.

따라서 메인 컴퓨터에도 같은 절대경로를 마운트 포인트로 만들 수 있어야 합니다.

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

위 명령이 비밀번호 입력 없이 성공해야 `ssh-agent`도 안정적으로 동작합니다.

## 문제 해결

### `sshfs` 명령을 찾을 수 없음

메인 컴퓨터에 SSHFS를 설치해야 합니다.

```bash
sshfs --version
```

### 마운트가 끊긴 뒤 opencode 도구가 실패함

의도된 동작입니다. 로컬 shadow write를 막기 위해 fail-closed로 실패합니다. 다시
마운트하세요.

```bash
ssh-agent mount gpu:/home/user/my-project
```

### 등록한 key를 찾을 수 없음

등록 목록을 확인합니다.

```bash
ssh-agent remote list
```

다른 레지스트리 위치를 쓰고 있다면 같은 `SSH_AGENT_HOME` 값을 사용해야 합니다.

```bash
SSH_AGENT_HOME=~/.config/ssh-agent ssh-agent remote list
```

### opencode가 계속 로컬에서만 동작함

다음을 확인합니다.

1. 프로젝트 루트에 `.opencode/ssh-agent.jsonc`가 있는지 확인합니다.
2. `opencode.json`에 `"ssh-agent/plugin"`이 들어 있는지 확인합니다.
3. `ssh-agent status <mountRoot>`로 마운트가 살아 있는지 확인합니다.

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
