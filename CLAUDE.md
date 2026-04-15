# oh-my-google (omg) — Project Instructions

## Identity

**omg = AI 에이전트가 GCP + Firebase를 하나의 프로젝트로 통합해서 안전하게 다루는 하네스.**

핵심 존재 이유: Firebase 프로젝트 = GCP 프로젝트인데 현실은 **별도 CLI, 별도 auth, 별도 console**. 에이전트는 이 경계에서 자주 깨짐. omg가 통합 진입점.

타겟: AI 에이전트 (Claude Code, Codex, Antigravity 등). 사람이 직접 쓰는 경우는 소수.

MVP 4개 명령어: `omg init` → `omg link` → `omg deploy` (+ `omg doctor`).

핵심 패턴: **Setup-time intense + Runtime hands-off** — init 1회 승인으로 Trust Profile 생성, 이후 profile이 자동/승인 결정. 에이전트 자체 판단 금지.

## Coding Principles

1. **GCP + Firebase 통합이 본질** — 두 CLI/auth를 하나로 묶는 게 omg의 존재 이유. 한쪽만 다루면 의미 없음.
2. **4-command MVP** — `init`, `link`, `deploy`, `doctor`. admin surface (budget/secret/iam/notify/security)는 Phase 2.
3. **Trust Profile이 결정** — 에이전트 자체 판단 금지. init에서 설정한 profile이 자동/승인 결정.
4. **Dual surface** — CLI + MCP 서버 둘 다 같은 core 호출. 로직 중복 없음.
5. **Planner > Executor** — 실행 전 "무엇을 어디에 어떻게"를 먼저 결정 (`link`). 실행기는 단순.
6. **Cross-service wiring** — Cloud Run URL → Firebase rewrites 자동 연결이 MVP 킬러 기능.
7. **No premature abstraction** — Pipeline/Adapter 추상화 금지. 동일 패턴 3회 반복 후에만 등장.
8. **Agent-first output** — 모든 커맨드 `--output json` 지원. `{ok, command, data?, error?, next?}` 구조.
9. **Safe defaults** — Cloud Run 기본 비공개, Firestore rules 변경 전 diff.
10. **Service-specific auth** — GCP ADC + Firebase 토큰 + API 키 각자 프로바이더. AuthManager가 통합.

## Don'ts

- Pipeline orchestrator 추상화 금지 (Phase 6에서 재고)
- Adapter 레이어 금지 (CLI로 충분)
- SKILL 로더 금지 (v1은 문서로)
- `AsyncConnector` 부활 금지 (Jules 복귀 시 재도입)
- gcloud/firebase 단순 래퍼 금지 — planner + wiring이 반드시 개입
- 사람용 텍스트 출력만 금지 — 반드시 `output.ts`의 `success()`/`fail()`/`info()` 사용
- Next.js SSR MVP 지원 금지 — 감지 시 경고만 (Vercel 권장)

## Project Structure (목표)

```
src/
├── cli/         commander 진입 + commands/
├── planner/     detect / gcp-state / plan-builder / schema
├── executor/    apply (단순 순차 실행)
├── setup/       project / billing / apis / iam
├── wiring/      firebase-rewrites / env-inject / secret-link
├── connectors/  cloud-run / firebase (+ Phase 2: firestore, storage, ...)
├── auth/        auth-manager + providers
└── types/       errors / connector / plan
```

MVP에서 **없음**: `orchestrator/`, `adapters/`, `skills/` (src 안), `pipeline.ts`.

## Documentation Map

| 문서 | 내용 |
|---|---|
| `PRD.md` | 포지셔닝, MVP 범위, 전체 비전 |
| `ARCHITECTURE.md` | 모듈 구조, 인터페이스, 실행 흐름 |
| `AGENTS.md` | AI 에이전트가 omg를 쓰는 방법 |
| `PLAN.md` | Phase별 구현 계획 |

## Tech Stack

TypeScript, Node.js >=20, tsup (ESM), commander, google-auth-library, @google-cloud/run, firebase-tools (CLI 호출), @inquirer/prompts, yaml, vitest.
