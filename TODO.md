# TODO

## Active

### Phase 1.1 hardening

- [ ] `init` 테스트 추가
- [ ] `deploy` trust gate 테스트 추가
- [ ] connector 단위 테스트 추가
- [ ] `require_approval` 경로를 지금은 차단으로 둘지, 최소 승인 워크플로를 넣을지 결정
- [ ] `doctor`에서 실제 인증 상태와 ADC 파일 존재를 분리해서 보여주기
- [ ] `doctor`에 Firebase 프로젝트 링크 상태 점검 추가
- [ ] `deploy` 후 health verification 강화
- [ ] rollback 범위와 실패 전략 정교화
- [ ] `src/cli/output.ts` human 출력 포맷 다듬기
- [ ] command help 예시 보강
- [ ] 더 이상 쓰지 않는 키워드/설명 제거

### Link quality

- [ ] Next.js SSR 감지 시 warning 출력 추가
- [ ] detection 케이스를 더 세분화
- [ ] `link` 테스트 확대

### Tooling

- [ ] Windows line-ending 정책 정리
- [ ] CI에서 `typecheck`, `build`, `vitest` 고정

### Phase 2 prep

- [ ] MCP 서버를 admin surface보다 먼저 붙이는 방향으로 세부 작업 분해
- [ ] CLI와 MCP가 공유할 core 경계 명시

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
- [x] `bin/omg` 경로 정리
- [x] `package.json` entry/start 정리
- [x] `src/cli/index.ts` 명령 연결

### Test baseline

- [x] trust 테스트 추가
- [x] planner/wiring 테스트 추가
