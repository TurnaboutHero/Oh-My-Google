# oh-my-google — Implementation Plan

> 다음 세션부터 이어서 진행할 작업 계획.
> 완료된 항목은 체크하고, 변경사항은 바로 업데이트할 것.

---

## Phase 1: 커넥터 정비 (1-2 세션)

### 1.1 deploy 커맨드 → CloudRunConnector 연결
- [ ] `src/cli/commands/deploy.ts`가 `cloudRunConnector.execute()`를 호출하도록 리팩터
- [ ] 현재 gcloud 직접 호출 코드를 커넥터 내부로 이동 (이미 `cloud-run.ts`에 있음)
- [ ] deploy status → `cloudRunConnector.execute("describe")` 사용
- [ ] deploy logs → `cloudRunConnector.execute("logs")` 사용
- [ ] deploy rollback 서브커맨드 추가 → `cloudRunConnector.execute("rollback")`
- **수용 기준**: `omg --output json deploy --dry-run` 결과가 ConnectorResult 형태

### 1.2 Firebase CLI 커맨드 → 글로벌 --output 통합
- [ ] firebase.ts의 자체 `--output` 옵션 제거, 글로벌 `--output json` 사용하도록 통합
- [ ] firebase deploy의 `--execute` 플래그 → deploy 커맨드와 동일한 패턴으로 (기본 dry-run, `--yes`로 실행)
- **수용 기준**: `omg --output json firebase deploy --dry-run` 동작

### 1.3 단위 테스트
- [ ] `vitest` 설정 (`vitest.config.ts`)
- [ ] `tests/unit/connectors/cloud-run.test.ts` — mock spawnSync, 각 action 테스트
- [ ] `tests/unit/connectors/firebase.test.ts` — 동일 패턴
- [ ] `tests/unit/auth/auth-manager.test.ts` — config 로드/저장, 상태 체크
- [ ] `tests/unit/cli/output.test.ts` — JSON/Human 모드 출력 검증
- [ ] `package.json`에 `"test": "vitest run"` 스크립트
- **수용 기준**: `npm test` 통과

---

## Phase 2: Jules 커넥터 (1 세션)

### 2.1 Jules Auth
- [ ] `src/auth/auth-manager.ts`에 `saveJulesApiKey()` 메서드 추가
- [ ] `src/cli/commands/jules.ts` — `omg jules setup` (API 키 입력 + 저장)
- **수용 기준**: `omg --output json auth` 에서 julesApiKey: true

### 2.2 Jules 커넥터 (AsyncConnector)
- [ ] `src/connectors/jules.ts` — AsyncConnector 인터페이스 구현
  - `submit()`: POST `jules.googleapis.com/v1alpha/sessions` → 세션 ID 반환
  - `poll()`: GET `sessions/<id>` + `sessions/<id>/activities` → 상태 반환
  - `result()`: GET `sessions/<id>/sources` → PR URL/변경사항
  - `cancel()`: 세션 취소
- [ ] API 키 인증: `x-goog-api-key` 헤더
- [ ] fetch/undici로 직접 호출 (공식 SDK 없음)
- **수용 기준**: `omg --output json jules submit "Fix the bug" --repo https://github.com/...` → 세션 ID 반환

### 2.3 Jules CLI 커맨드
- [ ] `omg jules setup` — API 키 설정
- [ ] `omg jules submit <prompt> [--repo <url>]` — 작업 제출
- [ ] `omg jules status [<session-id>]` — 상태 확인
- [ ] `omg jules result [<session-id>]` — 결과 회수
- [ ] `omg jules list` — 활성 세션 목록
- [ ] `omg jules cancel <session-id>` — 취소

---

## Phase 3: 파이프라인 오케스트레이터 (1-2 세션)

### 3.1 ExecutionRepository
- [ ] `src/orchestrator/execution-repo.ts`
  - 파이프라인 실행 상태를 `~/.omg/state/executions/<id>.json`에 저장
  - `save()`, `get()`, `listOpen()` 구현
- **수용 기준**: 프로세스 재시작 후 `omg status`로 이전 실행 상태 확인 가능

### 3.2 PipelineExecutor
- [ ] `src/orchestrator/pipeline.ts`
  - `compile()`: 사용자 요청 → 실행 계획
  - `execute()`: 단계별 실행 (pre-validate → execute → post-validate → next)
  - `resume()`: 중단된 파이프라인 재시작
  - `cancel()`: 실행 중 취소
- [ ] 단계 간 데이터 전달 (이전 단계 결과 → 다음 단계 params)
- [ ] 실패 시 롤백 (역순 실행)
- [ ] StepSelector 지원 (all, single, from, only)

### 3.3 내장 파이프라인 정의
- [ ] `src/orchestrator/pipelines/code-to-deploy.ts`
  - Jules submit → Jules poll (완료 대기) → Cloud Run deploy
- [ ] `src/orchestrator/pipelines/firebase-fullstack.ts`
  - Firebase init → Functions 개발(Jules) → Firebase deploy

### 3.4 CLI 커맨드
- [ ] `omg pipeline [name] [--dry-run] [--from step] [--only step]`
- [ ] `omg status` — 현재/과거 파이프라인 실행 상태
- **수용 기준**: `omg --output json pipeline code-to-deploy --dry-run` → 단계별 실행 계획 JSON

---

## Phase 4: SKILL.md + Claude Code 어댑터 (1 세션)

### 4.1 스킬 로더
- [ ] `src/skills/loader.ts` — skills/ 디렉토리 스캔, frontmatter 파싱
- [ ] `src/skills/registry.ts` — 스킬 인덱싱, 커맨드 바인딩
- [ ] 3단계 탐색: project > user (`~/.omg/skills/`) > bundled

### 4.2 SKILL.md 작성
- [ ] `skills/omg-setup/SKILL.md` — 초기 설정 가이드
- [ ] `skills/deploy/SKILL.md` — Cloud Run 배포 워크플로우
- [ ] `skills/firebase/SKILL.md` — Firebase 워크플로우
- [ ] `skills/jules/SKILL.md` — Jules 작업 위임 가이드
- [ ] `skills/pipeline/SKILL.md` — 파이프라인 사용 가이드

### 4.3 Claude Code 어댑터
- [ ] `src/adapters/claude-code/index.ts`
  - 환경 감지 (CLAUDE_CODE 환경변수 등)
  - omg 커맨드를 Claude Code에서 호출 가능하게
  - 결과를 Claude Code 친화적 형태로 포맷
- [ ] `src/adapters/claude-code/skills/` — Claude Code 전용 SKILL.md

---

## Phase 5: 마무리 + 배포 (1 세션)

### 5.1 품질
- [ ] 통합 테스트 (mock API 서버)
- [ ] E2E 테스트 스크립트 (실제 GCP 프로젝트)
- [ ] `omg --verbose` / `omg --debug` 로깅
- [ ] MetadataLookupWarning 억제 (google-auth-library 초기화 시)

### 5.2 npm 배포
- [ ] `package.json` 정리 (files, repository, homepage)
- [ ] `npx oh-my-google` 동작 확인
- [ ] npm publish

### 5.3 문서
- [ ] README 업데이트 (실제 사용 예시, GIF/스크린샷)
- [ ] AGENTS.md 업데이트 (Jules, pipeline 추가)
- [ ] CHANGELOG.md

---

## 우선순위 요약

```
Phase 1 (커넥터 정비)     ← 바로 다음 세션
Phase 2 (Jules)           ← API 확인 후
Phase 3 (파이프라인)       ← 핵심 차별점
Phase 4 (스킬 + 어댑터)   ← 에이전트 퍼스트 완성
Phase 5 (배포)            ← npm publish
```

**Phase 3이 가장 중요**: 파이프라인 오케스트레이터가 omg의 존재 이유.
개별 커넥터는 gcloud/firebase 래퍼에 불과하지만, 파이프라인은 omg만의 가치.
