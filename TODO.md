# TODO

## Active

### Phase 3 secret admin surface

- [x] `omg secret list` metadata-only JSON/human command
- [x] `omg secret set <name>` dry-run and write command
- [x] Secret write trust mapping (`secret.set` as L2)
- [x] Secret value redaction in outputs and approval args
- [x] Secret admin runbook with cost boundary
- [x] MCP tool coverage for secret admin surface
- [ ] Live Secret Manager smoke on an approved disposable project

### Phase 3 project cleanup audit surface

- [x] `omg project audit --project <id>` read-only risk classification
- [x] `omg project cleanup --project <id> --dry-run` plan-only command
- [x] MCP tool coverage for project audit/cleanup dry-run
- [x] `omg project delete --project <id>` approval-gated L3 workflow
- [x] Protected/do-not-touch projects blocked before approval
- [x] Read-only audit smoke against existing ambiguous projects
- [ ] Live delete approved stale projects

### Phase 2.5 harness foundation

- [x] `.omg/decisions.log.jsonl` schema와 append writer 설계
- [x] `init`, `link`, `deploy`, `approve`, `reject`에 decision event 기록 연결
- [x] decision log redaction 규칙 추가
- [x] `.omg/handoff.md` 생성기 추가
- [x] deploy 성공/실패 후 handoff 갱신 연결
- [x] `.omg/trust.yaml` deny policy schema 추가
- [x] deny policy가 trust level과 approval보다 먼저 적용되도록 `checkPermission` 확장
- [x] deny policy 테스트 추가
- [x] MCP client smoke runbook 추가
- [x] 실제 GCP E2E runbook 추가
- [x] Phase 2.5 문서와 README/ARCHITECTURE 간 용어 정합성 점검
- [x] MCP client smoke를 실제 Claude Code/Codex 설정에서 실행
- [x] 테스트용 GCP 프로젝트로 실제 E2E 실행

### Phase 1.1 hardening

- [x] `init` 테스트 추가
- [x] `deploy` trust gate 테스트 추가
- [x] connector 단위 테스트 추가
- [x] `require_approval` 경로를 지금은 차단으로 둘지, 최소 승인 워크플로를 넣을지 결정
- [x] `doctor`에서 실제 인증 상태와 ADC 파일 존재를 분리해서 보여주기
- [x] `doctor`에 Firebase 프로젝트 링크 상태 점검 추가
- [x] `deploy` 후 health verification 강화
- [x] rollback 범위와 실패 전략 정교화
- [x] `src/cli/output.ts` human 출력 포맷 다듬기
- [x] command help 예시 보강
- [x] 더 이상 쓰지 않는 키워드/설명 제거

### Link quality

- [x] Next.js SSR 감지 시 warning 출력 추가
- [x] detection 케이스를 더 세분화
- [x] `link` 테스트 확대

### Tooling

- [x] Windows line-ending 정책 정리
- [x] CI에서 `typecheck`, `build`, `vitest` 고정

### Phase 2 prep

- [x] MCP 서버를 admin surface보다 먼저 붙이는 방향으로 세부 작업 분해
- [x] CLI와 MCP가 공유할 core 경계 명시

## Completed

### Phase 1.1 implementation

- [x] Jules auth remnants 제거
- [x] `pipeline.ts` 제거
- [x] `AsyncConnector` 제거
- [x] `src/cli/commands/init.ts` 구현
- [x] `src/setup/project.ts` 구현
- [x] `src/setup/billing.ts` 구현
- [x] `src/setup/apis.ts` 구현
- [x] `src/setup/iam.ts` 구현
- [x] human 모드 입력 흐름 추가
- [x] JSON 모드 필수 플래그 검증 추가
- [x] `src/cli/commands/link.ts` 구현
- [x] `src/planner/detect.ts` 구현
- [x] `src/planner/gcp-state.ts` 구현
- [x] `src/planner/plan-builder.ts` 구현
- [x] `src/planner/schema.ts` 구현
- [x] `spa-plus-api` 경로 구현
- [x] `NO_DEPLOYABLE_CONTENT` 에러 경로 구현
- [x] `src/cli/commands/deploy.ts` 재작성
- [x] `src/executor/apply.ts` 구현
- [x] `src/wiring/firebase-rewrites.ts` 구현
- [x] `src/wiring/env-inject.ts` 구현
- [x] trust gate 적용
- [x] backend-first deployment order 반영
- [x] `doctor` JSON 출력 유지
- [x] ADC 파일 기반 확인으로 doctor 잡음 완화
- [x] `require_approval`는 우선 hard block으로 유지
- [x] `bin/omg` 경로 정리
- [x] `package.json` entry/start 정리
- [x] `src/cli/index.ts` 명령 연결

### Test baseline

- [x] CLI hardening 테스트 추가
- [x] connector 단위 테스트 추가
- [x] trust 테스트 추가
- [x] planner/wiring 테스트 추가
