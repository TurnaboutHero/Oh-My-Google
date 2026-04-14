# oh-my-google (omg) — Project Instructions

## Identity

**omg = AI 에이전트가 Google 생태계를 안전하게 다루는 하네스.**
gcloud/firebase CLI는 사람용. omg는 에이전트용. 서비스는 교체 가능한 부품, 하네스가 본체.

## Coding Principles

1. **에이전트 퍼스트** — 모든 커맨드는 `--output json` 지원. 에이전트가 파싱 가능한 구조화된 출력이 기본 설계.
2. **JSON 출력 구조** — `{ ok, command, data?, error?, next? }`. 에러는 `{ code, message, recoverable, hint? }`.
3. **dry-run 먼저** — 배포/변경 커맨드는 `--dry-run` 지원. 에이전트는 항상 dry-run으로 계획 확인 후 `--yes`로 실행.
4. **확인 게이트** — 비용/배포 영향 있는 작업은 사용자 확인 필수. JSON 모드에서는 `--yes` 없으면 실행 안 함.
5. **하드 하네스** — Google 서비스 호출은 에이전트가 아닌 코드가 통제. 검증 → 실행 → 검증 → 롤백 패턴.
6. **2홉 원칙** — `에이전트 → omg → Google 서비스`. 중간에 다른 에이전트 CLI 끼우지 않음.

## Don'ts

- gcloud/firebase 단순 래퍼 금지 — omg만의 가치(JSON 출력, 검증, 롤백)가 있어야 함
- 사람용 텍스트 출력만 있는 커맨드 금지 — 반드시 `output.ts`의 `success()`/`fail()`/`info()` 사용
- 에이전트가 판단해야 할 것을 하드코딩 금지 — SKILL.md(소프트 하네스)로 가이드
- 인증을 단일 방식으로 가정 금지 — 서비스별 인증 프로바이더 패턴 (GCP ADC / Jules API 키 / 기타)

## Project Structure

```
src/cli/          CLI 커맨드 (commander) — output.ts가 에이전트 인터페이스 핵심
src/auth/         인증 (AuthManager → 서비스별 프로바이더)
src/connectors/   Google 서비스 커넥터 (Connector 인터페이스 구현)
src/orchestrator/ 파이프라인 오케스트레이션 (하드 하네스)
src/adapters/     툴별 어댑터 (Claude Code, Gemini CLI 등)
src/types/        공통 타입 (errors, connector, pipeline)
skills/           SKILL.md 파일 (소프트 하네스)
```

## Documentation Map

| 문서 | 내용 |
|---|---|
| `PRD.md` | 기획, 커맨드 명세, MVP 범위, 로드맵 |
| `ARCHITECTURE.md` | 모듈 의존성, 인터페이스 정의, 하네스 설계 |
| `AGENTS.md` | 에이전트가 omg를 사용하는 방법 (에러 코드 대응표, 워크플로우) |

## Tech Stack

TypeScript, Node.js >=20, tsup (ESM), commander, google-auth-library, @google-cloud/run, vitest
