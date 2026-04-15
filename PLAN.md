# Plan

## 현재 기준선

`main`에는 Phase 1.1 구현 커밋이 반영되어 있습니다.

완료된 묶음:

- skeleton
- cleanup
- trust
- setup
- planner
- wiring
- executor
- cli + polish

현재 문서상 기준은 “Phase 1.1 완료, MCP와 admin surface는 미구현”입니다.

## Phase 1.1 완료 범위

### 초기화

- `omg init` 구현
- GCP 프로젝트 선택/생성
- 빌링 계정 연결
- 필수 API 활성화
- 기본 IAM 바인딩 적용
- `.omg/trust.yaml` 생성
- `~/.omg/config.json` 저장

### 계획 생성

- `omg link` 구현
- 리포 감지 로직 구현
- GCP 상태 조회 로직 구현
- `.omg/project.yaml` 저장
- `spa-plus-api` 감지 시 backend-first 계획 생성

### 배포

- `omg deploy` 구현
- dry-run 경로 구현
- trust gate 적용
- 순차 실행기 구현
- Firebase rewrites 자동 주입
- Secret Manager 값 해석 지원

### 보조

- Jules auth 흔적 제거
- `doctor` 유지 및 JSON 출력 확인
- 기본 테스트 추가

## 현재 남은 작업

### 문서

- README를 실제 구현 기준으로 유지
- ARCHITECTURE를 현재 코드 구조와 일치시키기
- PRD와 구현 간 차이를 명시적으로 구분하기

### Phase 1.x

- `src/mcp/server.ts` 구현
- MCP 엔트리포인트 추가
- MCP tool surface를 CLI와 맞추기

### 운영 안정화

- `doctor`의 체크 항목 정교화
- `deploy` 후 검증 강화
- best-effort rollback 범위 명확화
- Windows/Unix 경로와 줄바꿈 정리

### 테스트

- `init` JSON 플래그 검증 테스트
- `link` 감지 케이스 확대
- `deploy` trust gate 테스트
- connector 단위 테스트

## 커밋 구조

현재 Phase 1.1 커밋 구조는 subsystem 단위로 유지합니다.

- skeleton: Claude
- cleanup 이후 구현 커밋: Codex CLI

이 구조는 “무엇이 먼저 scaffold 됐고, 무엇이 실제 구현됐는지”를 분리해서 보여주기 때문에 유지하는 편이 낫습니다.

## 다음 우선순위

1. MCP 서버
2. 배포 후 검증 강화
3. admin surface의 실제 범위 결정
4. 문서/명령 예시 지속 동기화
