# ssh-remote-agent — 설계 문서

opencode(+ Oh My OpenAgent)가 **메인 컴퓨터에서 두뇌 역할**을 하고,
실제 파일 편집과 명령 실행은 **원격 컴퓨터에서** 일어나게 만드는 도구.
원격 컴퓨터에는 **아무것도 설치하지 않는다** (sshd만 있으면 됨).

---

## 1. 목표와 제약

### 목표
- 프로젝트 단위로 "이 프로젝트는 어느 원격에서 작업할지" 지정
- 지정 시 → 원격 모드 (파일=원격, bash=원격)
- 미지정 시 → 순수 로컬 opencode (아무 개입 없음)
- 원격 컴퓨터를 **키(별칭)** 로 미리 등록해두고 재사용

### 하드 제약
- **원격에는 설치 금지** — 메인의 sshfs 클라이언트 + 원격의 sshd만 사용
- **passwordless(SSH 키)** 인증만 지원
- 등록은 opencode와 **분리** — 별도 CLI/파일 편집
- 이미 있는 `~/.ssh/config` Host 별칭은 그대로 재사용

---

## 2. 아키텍처

```
┌────────────────────────── 메인 컴퓨터 (두뇌) ──────────────────────────┐
│                                                                        │
│  ssh-remote-agent CLI                                                  │
│   ├─ remote add/list/remove  → ~/.ssh-agent/remotes.jsonc              │
│   │   (저장 전 SSH preflight, passwordless, ~/.ssh/config 별칭 재사용)  │
│   └─ init --remote <key>:<path>                                        │
│        ├─ sshfs 마운트 (현재 로컬 프로젝트 경로, reconnect 옵션)       │
│        └─ .opencode/ 에 remote 키 기록                                 │
│                                                                        │
│  opencode + omo                                                        │
│   └─ 플러그인 (remote-ssh)                                             │
│        ├─ 설정에 remote 없음 → {} (순수 로컬 모드)                     │
│        └─ remote 있음 →                                                │
│            ├─ tool.execute.before[파일도구]: 마운트 생존 가드          │
│            └─ tool.execute.before[bash]:                               │
│                 sync -f → base64 → ssh -T host 'bash -se'              │
└────────────────────────────────────────────────────────────────────────┘
                                    │ SSH (ControlMaster 재사용)
                                    ▼
┌────────────────────────── 원격 컴퓨터 (손발) ──────────────────────────┐
│  실제 프로젝트 파일 (SSHFS가 마운트) + bash 실행                        │
│  ※ 설치물 전혀 없음. sshd만 필요                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### 핵심 통찰
- **파일**: SSHFS 마운트라서 opencode의 `read`/`edit`/`write`/`grep`/`glob`가 투명하게 원격 파일을 다룸 → 코드 변경 불필요
- **실행**: bash만 SSH로 원격 위임
- **로컬 mountRoot 분리**: 원격 `/home/user/proj` → 로컬 현재 프로젝트 경로(`/root/proj` 등)에 마운트

---

## 3. opencode 플러그인 API (소스로 검증됨)

### 훅 시그니처
```ts
"tool.execute.before"?: (
  input: { tool: string; sessionID: string; callID: string },
  output: { args: any },   // output.args.command 변형 가능
) => Promise<void>
```

### bash 도구 args 스키마
```ts
{ command: string, timeout?: number, workdir?: string }
// workdir 는 spawn 의 cwd 로 쓰임
```

### 플러그인 컨텍스트
```ts
type PluginInput = {
  client, project, directory, worktree,
  experimental_workspace,   // 프로비저닝용 — 우리 용도엔 부적합, 사용 안 함
  serverUrl, $              // $ = Bun shell
}
```

> `experimental_workspace.register`는 워크스페이스 생성/삭제 라이프사이클용이지
> exec/파일IO 라우팅용이 아니라 사용하지 않는다.

---

## 4. 위험 요소와 대응 (Oracle 검토 반영)

| 순위 | 위험 | 대응 |
|---|---|---|
| 🔴 1 | 마운트 끊김 → 로컬 그림자 쓰기 | bash + **모든 파일 도구**에 마운트 생존 가드 (fail-closed) |
| 🔴 2 | 명령 이스케이프 깨짐 | base64 인코딩 후 원격 `bash -se` stdin 주입 |
| 🟠 3 | 쓰기-실행 순서 불일치 | bash 실행 전 `sync -f <mount>` 배리어 |
| 🟠 4 | 절대 심볼릭 링크 / 경로 누수 | `$HOME`, `/tmp`, `/etc` 등 split-brain — 문서화 |
| 🟡 5 | SSHFS 성능 (codegraph/LSP) | 신중한 캐시 옵션, 필요시 인덱서 조정 |
| 🟡 6 | TTY/인터랙티브 명령 | 기본 `-T`, 인터랙티브 미지원 명시 |
| 🟡 7 | omo 서브에이전트 훅 우회 | 같은 프로젝트 `.opencode` 플러그인 로드 검증 |
| 🟡 8 | CT/LXC/container에서 FUSE 미노출 | `/dev/fuse` 노출 필요 문서화, 없으면 SSHFS mount 실패 |

### 원격 등록 preflight
```bash
ssh -T \
  -o BatchMode=yes \
  -o ConnectTimeout=10 \
  -o ServerAliveInterval=15 \
  -o ServerAliveCountMax=3 \
  [-p <port>] [-i <identityFile>] \
  -- '<host>' true
```
- `remote add`는 레지스트리에 저장하기 전에 위 SSH 통신 테스트를 먼저 실행
- password prompt는 `BatchMode=yes`로 실패 처리, 대기하지 않음
- host/port/identity/alias가 틀리면 non-zero로 종료하고 `remotes.jsonc`를 쓰지 않음
- `spawnSync("ssh", args)` argv 배열로 실행해서 shell injection 경로를 만들지 않음

### 명령 위임 (안전 버전)
```bash
sync -f '<mount_root>' 2>/dev/null || true
printf '%s' '<base64_of_original_command>' \
  | base64 -d \
  | ssh -T -- '<host>' 'cd '"'"'<remote_workdir>'"'"' && exec bash -se'
```
- 원본 명령을 SSH 명령줄에 넣지 않고 **stdin으로** → 이스케이프 지옥 회피
- `host`는 레지스트리/`~/.ssh/config` 별칭 **화이트리스트**에서만 (인젝션 방어)
- `bash -se` = stdin을 스크립트로 실행, 종료코드 그대로 반환
- 모든 quoted 조각은 코드가 POSIX shell-quote 헬퍼로 생성

### 마운트 가드 (fail-closed)
```bash
sshfs -o reconnect,ServerAliveInterval=15,ServerAliveCountMax=3,ConnectTimeout=10,BatchMode=yes ...
```
- bash 실행 전 + 파일 도구 실행 전 `mountpoint -q <mount>` + sentinel stat 확인
- 마운트 죽었으면 **큰 소리로 실패** (로컬에 쓰지 말고)

---

## 5. 레지스트리 스키마

`~/.ssh-agent/remotes.jsonc` (기존 호환 경로, JSONC — 주석 허용, 사람이 직접 편집 가능)

```jsonc
{
  "gpu": {
    // 방법 A: 직접 지정
    "host": "10.0.0.5",
    "user": "user",
    "port": 22,                       // 선택 (기본 22)
    "identityFile": "~/.ssh/gpu_key", // 선택
    "basePath": "/home/user"          // 선택, 기본 작업 루트
  },
  "staging": {
    // 방법 B: ~/.ssh/config Host 별칭 재사용
    "sshHost": "my-staging-alias"     // 이 별칭의 접속 정보를 그대로 사용
  }
}
```

- `sshHost` 지정 시 → `~/.ssh/config`의 해당 Host 설정을 신뢰 (user/port/key 등 위임)
- 그 외 → `host`(+user/port/identityFile) 직접 사용
- **key만 화이트리스트로 허용** — 플러그인은 이 레지스트리의 key로만 원격 참조

---

## 6. 프로젝트 설정

`ssh-remote-agent init --remote <key>:<remote_path>` 실행 시:
1. 레지스트리에서 `<key>` 조회
2. sshfs로 `<remote_path>`를 현재 로컬 프로젝트 경로에 마운트
3. 프로젝트의 `.opencode/` 에 remote 정보 기록

프로젝트 remote 설정 (`.opencode/ssh-agent.jsonc`):
```jsonc
// ssh-remote-agent remote-mode config. Delete this file to return to local mode.
{
  "key": "gpu",                    // 레지스트리 key
  "remotePath": "/home/user/proj", // 원격 실제 경로
  "mountRoot": "/root/proj"        // 로컬 마운트 지점 (`init` 실행 위치)
}
```

플러그인은 이 파일을 읽어서:
- 없으면 → `{}` 반환 (순수 로컬 모드)
- 있으면 → 원격 모드 훅 활성화

---

## 7. CLI 명령 (ssh-remote-agent)

```bash
# 원격 레지스트리 관리
ssh-remote-agent remote add <user@host> --key <key> [--port N] [--identity PATH] [--base PATH]
ssh-remote-agent remote add --key <key> --ssh-host <alias>     # ~/.ssh/config 재사용
ssh-remote-agent remote list
ssh-remote-agent remote remove <key>

# 프로젝트를 원격 모드로 초기화
ssh-remote-agent init --remote <key>:<remote_path>
ssh-remote-agent init --remote <key>:<remote_path> --no-mount

# 마운트 관리
ssh-remote-agent mount <key>:<remote_path>               # 재마운트
ssh-remote-agent unmount <mountRoot>
ssh-remote-agent status <mountRoot>                      # 마운트/연결 상태 확인
```

`remote add`의 `--identity`에는 `.pub` public key가 아니라 private key 경로를 넣는다.
등록 전 SSH preflight가 성공해야만 레지스트리에 저장된다.

---

## 8. 기술 스택

- **언어**: TypeScript
- **런타임**: Bun (opencode 플러그인이 Bun shell `$` 제공, omo도 Bun 기반)
- **SSH 연결 재사용**: ControlMaster (bash 지연 최소화)
- **의존성 최소화**: sshfs(시스템), ssh(시스템) 외 npm 의존성 최소
- **배포**: npm 패키지용 `dist/cli.js` build를 유지하고, release용 단일 실행 파일은 `bun run build:standalone`으로 `dist/ssh-remote-agent` 생성

---

## 9. 개발 순서 (추천순)

### Phase 1: 플러그인 핵심 (가장 위험/핵심) — ✅ 완료
1. ✅ `remoteConfig` 로더 (`src/config.ts`) — 없으면 no-op
2. ✅ 마운트 생존 가드 (`src/mount-guard.ts`) — `mountpoint` + sentinel stat, fail-closed
3. ✅ bash SSH 위임 (`src/remote-exec.ts`) — base64 stdin 파이프 + sync 배리어 + host 화이트리스트
4. ✅ 파일 도구 가드 (`src/plugin/remote-ssh.ts`) — read/edit/write/grep/glob 전 마운트 확인
5. ✅ E2E 검증 — 악질 명령 실제 실행, 로컬모드 no-op, base64 파이프라인

### Phase 2: CLI — ✅ 완료
6. ✅ 레지스트리 로더/에디터 (`src/registry.ts`) — `remotes.jsonc`, `~/.ssh/config` 별칭 재사용
7. ✅ `remote add/list/remove` (`src/cli.ts`) — 등록 전 SSH preflight 포함
8. ✅ `init` (`src/init.ts`) — 프로젝트 설정 생성 + sshfs 마운트
9. ✅ `mount/unmount/status` (`src/mount.ts` + CLI)

### Phase 3: 실환경 통합 검증 (사용자 환경 필요) — ⏳ 남음
10. ⏳ 실제 원격 SSH + sshfs 왕복 (edit → 즉시 remote 실행, 마운트 kill → fail-closed)
11. ⏳ omo 서브에이전트 훅 적용 검증 (Team Mode 병렬 서브에이전트)

> 참고: 이 샌드박스에서는 `/dev/fuse` 노출 후 일반 SSHFS mount와 standalone build는 검증했다.
> 실제 원격 머신의 로컬 mountRoot 분리 모델은 사용자 환경에서 최종 확인이 필요하다.

---

## 10. 알려진 한계 (split-brain)

원격 모드에서 다음은 **여전히 메인/원격이 갈린다**:
- `$HOME`, `/tmp`, `/var`, `/etc` — 파일 도구는 메인 경로, bash는 원격 경로를 봄
- 절대 심볼릭 링크 — 로컬 커널이 SSHFS 통해 resolve
- 도구 캐시, 생성되는 절대경로

→ 프로젝트 디렉토리 내부 작업은 안전. 그 밖의 절대경로는 주의 필요 (문서 경고).

### CT/LXC/container FUSE 요구사항

SSHFS mount에는 host의 FUSE device가 필요하다. CT/LXC/Docker 같은 container 환경에서는
container 내부에 `sshfs`만 설치해서는 충분하지 않고 `/dev/fuse`가 노출되어 있어야 한다.

```bash
ls -l /dev/fuse
```

없으면 `fuse: device /dev/fuse not found. Kernel module not loaded?` 형태로 mount가 실패한다.
LXC/Proxmox 계열에서는 host 설정에 `features: fuse=1,nesting=1`,
`lxc.cgroup2.devices.allow: c 10:229 rwm`, `/dev/fuse` bind mount 같은 설정이 필요할 수 있다.
