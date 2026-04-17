# PLAN

## Intent

이 문서는 `oh-my-google`의 구현 계획서다.

- 상태 보고서를 대신하지 않는다.
- 체크리스트 보드를 대신하지 않는다.
- 완료/미완료 추적은 `TODO.md`에서 한다.

여기서는 앞으로 어떤 순서로, 어떤 단위로, 어떤 완료 기준으로 구현할지 정의한다.

## Planning Rules

- 계획은 실행 순서 기준으로 쪼갠다.
- 각 단계는 끝났는지 판별 가능한 결과물을 가져야 한다.
- 추상 계층보다 실제 사용자 경로를 먼저 완성한다.
- PRD의 장기 비전보다 현재 배포 가능한 CLI 흐름을 우선한다.
- 각 단계 안에서도 `detect -> plan -> execute -> verify` 흐름이 보이게 쪼갠다.
- 문서화된 제품 원칙을 따른다.
  - GCP + Firebase 통합이 본질
  - Trust Profile이 결정한다
  - Planner가 Executor보다 먼저다
  - Cross-service wiring이 MVP의 핵심 가치다
  - CLI와 MCP는 같은 core를 공유해야 한다

## Definition Of Done

각 단계는 아래 조건을 만족해야 완료로 본다.

- 사용자 명령이 실제로 실행된다.
- JSON 출력 계약이 유지된다.
- 실패 시 에러 코드와 hint가 구조화되어 나온다.
- 관련 타입체크와 테스트가 통과한다.
- README/ARCHITECTURE와 차이가 생기면 함께 갱신한다.

## Phase 1

목표: `init -> link -> deploy -> doctor`를 안정적인 배포 하네스로 고정한다.

### 1.1 Init

구현 범위:

- GCP 프로젝트 선택 또는 생성
- 빌링 계정 연결
- 필수 API 활성화
- 기본 IAM 바인딩 적용
- Trust Profile 저장
- 로컬 config 저장

완료 기준:

- human 모드에서 프로젝트/빌링/환경/리전을 수집할 수 있다.
- JSON 모드에서는 필수 플래그가 없을 때 구조화 에러를 반환한다.
- 성공 시 `.omg/trust.yaml`과 `~/.omg/config.json`이 생성된다.

### 1.2 Link

구현 범위:

- 현재 repo 감지
- 감지 결과와 GCP 상태를 조합해 `.omg/project.yaml` 생성
- backend/frontend/wiring/deploymentOrder 결정

완료 기준:

- 배포 가능한 repo에서 plan을 만든다.
- 빈 repo에서는 `NO_DEPLOYABLE_CONTENT`를 반환한다.
- `spa-plus-api` 경로에서 backend-first 계획과 rewrites wiring이 생긴다.

### 1.3 Deploy

구현 범위:

- `.omg/project.yaml` 로드
- Trust Profile 확인
- dry-run 출력
- 순차 실행
- rewrites 자동 주입
- backend/frontend URL 수집

완료 기준:

- dry-run과 실제 실행 경로가 분리된다.
- trust gate가 적용된다.
- plan의 deployment order를 따른다.
- wiring과 secret env 해석이 실행 흐름에 결합된다.
- Cloud Run URL -> Firebase rewrites 자동 연결이 실제 사용자 경로에서 동작한다.

### 1.4 Doctor

구현 범위:

- omg config
- ADC 존재 여부
- Cloud Run API 점검 가능 여부
- gcloud/firebase CLI 존재 여부

완료 기준:

- human/json 모두에서 읽을 수 있는 결과를 반환한다.
- 최소한 초기 세팅 문제를 빠르게 식별할 수 있다.

### 1.5 CLI Surface

구현 범위:

- 진입점 정리
- build/start/bin 경로 정리
- JSON 출력 계약 고정

완료 기준:

- `node bin/omg --help`가 정상 동작한다.
- 빌드 산출물 경로와 런처가 일치한다.
- 주요 명령이 모두 CLI에 연결되어 있다.

### 1.6 Cleanup

구현 범위:

- Jules 관련 auth 흔적 제거
- premature abstraction 제거

완료 기준:

- Jules auth 잔여물이 없어야 한다.
- `pipeline.ts`, `AsyncConnector`가 제거되어야 한다.

## Phase 1.5

목표: Phase 1 기능을 “돌아간다”에서 “다시 만져도 안 깨진다” 상태로 올린다.

구현 범위:

- trust의 `require_approval` 경로를 end-to-end로 구현한다
  - `.omg/approvals/` 파일 기반 approval queue
  - `omg approve`, `omg reject`, `omg approvals list` CLI
  - `omg deploy`가 approval을 자동 생성하고 `argsHash`로 조작을 막는다
  - `PermissionCheck.reasonCode`로 에러 경로를 8종으로 구조화한다
- trust/planner/wiring/init/deploy/connector 테스트 보강
- CI 고정
- line-ending 및 경로 안정화

완료 기준:

- 핵심 경로가 테스트로 잠겨 있어야 한다.
- `require_approval` 워크플로가 테스트로 잠겨 있어야 한다.
- CI에서 `typecheck`, `build`, `vitest`가 기본 검증으로 동작해야 한다.
- trust 모델의 남은 미구현 영역이 TODO와 문서에 명확히 드러난다.

## Phase 2

목표: CLI-only MVP를 agent-native surface로 확장한다.

구현 범위:

- `src/mcp/server.ts` 구현
- CLI 명령과 MCP tool mapping 정의
- MCP 상의 trust gate 표현
- CLI와 MCP가 같은 core를 호출하도록 경계 정리

세부 작업 분해:

1. `init`, `link`, `deploy`, `doctor`를 MCP로 그대로 노출할 최소 tool set 정의
2. CLI 전용 책임과 shared core 책임 분리
3. MCP에서 human confirmation이 없는 상태에서 trust gate를 어떻게 표현할지 결정
4. stdio 기준 서버 구동과 tool 응답 포맷 검증

shared core 경계:

- shared core
  - `auth-manager`
  - `setup/*`
  - `planner/*`
  - `trust/*`
  - `executor/*`
  - `connectors/*`
  - `wiring/*`
- CLI layer
  - commander option parsing
  - human prompt 수집
  - human/json 출력 formatting
  - process exit / shell ergonomics
- MCP layer
  - tool schema
  - tool input validation
  - MCP response shaping
  - same core 호출

완료 기준:

- stdio 기준으로 최소 동작이 된다.
- CLI와 MCP의 핵심 동작 계약이 일치한다.
- dual surface 원칙이 문서와 구현 모두에서 성립한다.

## Phase 3

목표: admin surface 중 실제 수요가 큰 것만 좁게 추가한다.

우선순위 후보:

1. secret
2. iam
3. budget
4. notify
5. security

완료 기준:

- 각 명령의 trust level이 정의된다.
- 각 명령의 입력/출력 계약이 CLI와 JSON 모드에서 명확하다.
- 배포 하네스보다 우선순위를 침범하지 않는다.

## Phase 4

목표: 추가 GCP 리소스를 `add` 계열로 점진적으로 붙인다.

후보:

- Firestore
- Cloud Storage
- Cloud SQL
- Secret Manager 강화

완료 기준:

- `add` 명령이 plan/environment와 충돌 없이 결합된다.
- 리소스 추가가 배포 흐름을 깨지 않는다.

## Phase 5

목표: AI/analytics 같은 비핵심 기능은 배포 하네스가 충분히 안정화된 뒤 붙인다.

후보:

- Gemini / Vertex AI
- Analytics
- Ads

완료 기준:

- 실제 수요가 확인된 범위만 붙인다.
- 배포 하네스의 복잡도를 먼저 악화시키지 않는다.

## Document Discipline

이 문서에서는 다음을 하지 않는다.

- 현재 기준선 요약
- 완료 범위 회고
- 구현 후 감상
- 커밋 히스토리 설명

그 내용은 README, TODO, CHANGELOG, PR 설명에 둔다.
