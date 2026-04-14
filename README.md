# oh-my-google (omg)

**AI 에이전트가 Google 생태계를 안전하게 다루는 하네스.**

gcloud, firebase CLI는 사람용입니다. omg는 에이전트용입니다.

| 사람용 CLI | omg (에이전트용) |
|---|---|
| 텍스트 출력 → 사람이 읽음 | **JSON 출력** → 에이전트가 파싱 |
| 사용자가 다음 명령 판단 | **`next` 필드**로 다음 액션 제안 |
| 실수하면 사람이 롤백 | **하드 하네스**가 자동 검증 + 롤백 |
| 세션 끊기면 처음부터 | **상태 영속**, 재시작 가능 |
| gcloud, firebase 따로 | `omg` **하나로 통합** |

## Install

```bash
npm install -g oh-my-google
```

## Quick Start

```bash
# 1. GCP 프로젝트 설정
omg setup --project-id my-project

# 2. 연결 확인
omg doctor

# 3. Cloud Run 배포 (dry-run 먼저)
omg deploy --dry-run --service my-app

# 4. 실제 배포
omg deploy --yes --service my-app
```

## Agent Integration

에이전트에서 사용할 때는 `--output json`:

```bash
omg --output json deploy --dry-run --service my-app
```

```json
{
  "ok": true,
  "command": "deploy:dry-run",
  "data": {
    "projectId": "my-project",
    "service": "my-app",
    "region": "asia-northeast3",
    "source": "."
  },
  "next": ["omg deploy --yes"]
}
```

에러 시 `error.code`로 분기:

```json
{
  "ok": false,
  "command": "deploy",
  "error": {
    "code": "AUTH_ERROR",
    "message": "Not authenticated.",
    "recoverable": false,
    "hint": "Run 'omg setup' first."
  }
}
```

자세한 에이전트 통합 가이드는 [AGENTS.md](./AGENTS.md) 참고.

## Commands

```
omg setup              GCP 프로젝트 설정 + 인증
omg auth               인증 상태 확인 / 갱신 / 삭제
omg doctor             전체 연결 진단
omg deploy             Cloud Run 배포
omg firebase init      Firebase 프로젝트 초기화
omg firebase deploy    Firebase Hosting/Functions 배포
omg firebase emulators Firebase 에뮬레이터 실행
```

모든 커맨드에 `--output json`, `--dry-run` 지원.

## Architecture

```
┌─────────────────────────────────┐
│  SKILL.md (소프트 하네스)        │  에이전트에게 워크플로우 가이드
├─────────────────────────────────┤
│  Agent Interface                │  JSON 출력, 구조화된 에러, next steps
├─────────────────────────────────┤
│  Hard Harness                   │  검증, 롤백, dry-run, 확인 게이트
├─────────────────────────────────┤
│  Connectors (교체 가능)          │  Cloud Run, Firebase, Jules, Stitch...
└─────────────────────────────────┘
```

서비스는 교체 가능한 부품. 하네스가 본체.

## Supported Agents

| Agent | Subagents | Support Level |
|---|---|---|
| Claude Code | Yes | Full (parallel orchestration) |
| OpenCode | Yes | Full |
| Codex CLI | Yes | Full |
| Gemini CLI | Yes | Native tool calls |
| Antigravity | No | Sequential (degraded) |

## Roadmap

- [x] CLI scaffolding + agent-first output
- [x] GCP auth (ADC + API key)
- [x] Cloud Run connector
- [x] Firebase connector
- [ ] Jules connector (API alpha)
- [ ] Pipeline orchestrator (state persistence)
- [ ] Claude Code adapter (SKILL.md)
- [ ] Stitch connector (when API stabilizes)

## Docs

| Document | Purpose |
|---|---|
| [AGENTS.md](./AGENTS.md) | How AI agents should use omg |
| [PRD.md](./PRD.md) | Product requirements |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Technical architecture |

## Background

oh-my 시리즈 (omc, omo, omx)에서 영감을 받았지만, 특정 툴의 플러그인이 아닌 **독립 오케스트레이션 레이어**입니다.

[oh-my-antigravity](https://github.com/TurnaboutHero/oh-my-antigravity)에서 서브에이전트 부재로 진짜 오케스트레이션이 불가능했던 경험이 이 프로젝트의 시작점입니다.

## License

MIT
