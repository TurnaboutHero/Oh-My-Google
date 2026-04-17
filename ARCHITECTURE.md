# Architecture

## 목표

현재 `oh-my-google`의 구현 목표는 다음 세 단계를 안정적으로 연결하는 것입니다.

1. `init`
2. `link`
3. `deploy`

즉, “Google Cloud/Firebase 전체를 추상화한다”가 아니라, 에이전트가 배포 가능한 최소 경로를 구조화된 출력과 안전 게이트로 실행하게 만드는 것이 현재 아키텍처의 중심입니다.

## 현재 계층

```text
CLI
  -> output
  -> auth
  -> setup
  -> planner
  -> trust
  -> executor
  -> connectors
  -> wiring
```

핵심 원칙:

- planner가 무엇을 할지 결정한다
- executor가 그 계획을 순서대로 실행한다
- connector는 서비스별 실행 단위만 담당한다
- output은 human/json 출력을 통일한다

## 실제 디렉터리 구조

```text
src/
  approval/
    types.ts
    hash.ts
    queue.ts
  auth/
    auth-manager.ts
  cli/
    index.ts
    output.ts
    auth.ts
    doctor.ts
    setup.ts
    commands/
      init.ts
      link.ts
      deploy.ts
      firebase.ts
      approve.ts
      reject.ts
      approvals.ts
  connectors/
    cloud-run.ts
    firebase.ts
  executor/
    apply.ts
  planner/
    detect.ts
    gcp-state.ts
    plan-builder.ts
    schema.ts
  setup/
    project.ts
    billing.ts
    apis.ts
    iam.ts
  trust/
    profile.ts
    levels.ts
    check.ts
  types/
    connector.ts
    errors.ts
    plan.ts
    trust.ts
  wiring/
    firebase-rewrites.ts
    env-inject.ts
  mcp/
    server.ts
```

`src/mcp/server.ts`는 현재 stub입니다.

## 명령 흐름

### `omg init`

입력:

- 프로젝트 ID
- 빌링 계정
- 환경
- 리전

처리:

- `auth-manager`로 로컬 설정과 인증 상태 확인
- `setup/project.ts`로 프로젝트 생성 또는 선택
- `setup/billing.ts`로 빌링 연결
- `setup/apis.ts`로 필수 API enable
- `setup/iam.ts`로 기본 IAM 바인딩 적용
- `trust/profile.ts`로 `.omg/trust.yaml` 생성
- `AuthManager.saveConfig()`로 `~/.omg/config.json` 저장

출력:

- JSON 모드면 `{ ok, command, data, next }`
- 다음 단계는 `omg link`

### `omg link`

입력:

- 현재 작업 디렉터리
- 선택적 region/service/site override

처리:

- `planner/detect.ts`가 리포를 감지
- `planner/gcp-state.ts`가 현재 GCP 상태를 읽음
- `planner/plan-builder.ts`가 Plan 생성
- `planner/schema.ts`가 `.omg/project.yaml` 저장

주요 판단:

- `static`
- `api-only`
- `spa-plus-api`
- `functions`
- `unknown`

`spa-plus-api`면 backend 먼저, frontend 나중 순서와 rewrites wiring을 생성합니다.

### `omg deploy`

입력:

- `.omg/project.yaml`
- `.omg/trust.yaml`
- `--dry-run`
- `--yes`

처리:

- plan 로드
- trust profile 로드
- `trust/check.ts`로 배포 허용 여부 판단
- `executor/apply.ts`가 deployment order대로 순차 실행
- 필요 시 `wiring/firebase-rewrites.ts` 적용
- 필요 시 `wiring/env-inject.ts`로 Secret Manager 값 해석

출력:

- 배포 URL
- step 목록

## 핵심 데이터 구조

### Plan

현재 저장 경로:

- `.omg/project.yaml`

핵심 필드:

- `version`
- `detected`
- `targets`
- `wiring`
- `environment`
- `deploymentOrder`
- `checks`

이 구조는 planner와 executor 사이의 계약입니다.

### Trust Profile

현재 저장 경로:

- `.omg/trust.yaml`

핵심 필드:

- `projectId`
- `environment`
- `allowedServices`
- `allowedRegions`
- `rules`

`rules`는 `L0`~`L3` 액션 레벨별 정책을 가집니다.

## Trust 모델

현재 액션 레벨 매핑은 `trust/levels.ts`에 있습니다.

대표 예시:

- `deploy.cloud-run` -> `L1`
- `deploy.firebase-hosting` -> `L1`
- `billing.link` -> `L2`
- `iam.role.grant` -> `L2`
- destructive action -> `L3`

정책 해석은 `trust/check.ts`가 담당합니다.

현재 동작:

- `auto` -> 바로 허용
- `require_confirm` -> human에서는 진행 가능, JSON에서는 `--yes` 필요
- `require_approval` -> 승인 워크플로. `.omg/approvals/<id>.yaml` 파일 기반 큐를 사용합니다. `omg deploy`가 처음 만나면 approval 파일을 자동 생성하고 `APPROVAL_REQUIRED` + approvalId + next 힌트를 반환합니다. 사람이 `omg approve <id>`로 승인한 뒤 `omg deploy --approval <id>`로 재실행합니다. TTL 기본 1시간. `argsHash`로 승인 후 배포 인자 조작을 막습니다. 통과한 approval은 `consumed`로 마킹되어 1회만 사용됩니다.
- `deny` -> 항상 차단

`PermissionCheck.reasonCode`는 8종 구조화 에러를 분기합니다: `DENIED`, `REQUIRES_CONFIRM`, `APPROVAL_REQUIRED`, `APPROVAL_NOT_FOUND`, `APPROVAL_EXPIRED`, `APPROVAL_NOT_APPROVED`, `APPROVAL_MISMATCH`, `APPROVAL_CONSUMED`.

## Connector 모델

공통 인터페이스는 `types/connector.ts`에 있습니다.

```ts
interface Connector<TRequest, TResult> {
  healthCheck(config): Promise<HealthStatus>;
  execute(action, params, config): Promise<ConnectorResult<TResult>>;
  validate(result): Promise<boolean>;
  rollback?(action, config): Promise<void>;
}
```

현재 구현된 connector:

- `CloudRunConnector`
- `FirebaseConnector`

역할 분리:

- planner는 connector를 직접 쓰지 않음
- executor가 connector를 호출함

## MCP Prep Boundary

MCP를 붙일 때 새 business logic를 만들지 않는다.

경계는 이렇게 고정한다.

- shared core
  - `auth/`
  - `setup/`
  - `planner/`
  - `trust/`
  - `executor/`
  - `connectors/`
  - `wiring/`
- CLI
  - commander 명령 정의
  - interactive prompt
  - human/json 출력
  - exit code 처리
- MCP
  - tool schema
  - tool input validation
  - tool result serialization
  - shared core 호출

즉 MCP는 CLI를 호출하는 layer가 아니라, CLI와 같은 core를 호출하는 별도 surface다.

## Wiring

현재 wiring은 두 개입니다.

- `firebase-rewrites.ts`
- `env-inject.ts`

### Firebase rewrites

backend가 Cloud Run이고 frontend가 Firebase Hosting일 때:

- `firebase.json`의 rewrites를 수정
- 동일한 pattern은 교체
- 다른 rewrites는 유지

### Secret env injection

`${SECRET:KEY}` 형식의 값을 만나면:

- `gcloud secrets versions access latest` 호출
- 해석된 값을 backend env로 전달

## Auth

`auth/auth-manager.ts`는 현재 두 역할만 맡습니다.

- `~/.omg/config.json` 로드/저장
- ADC 존재 여부 확인

현재는 ADC 존재 여부를 로컬 파일 기준으로 확인합니다.
이 설계는 `doctor` JSON 출력에서 메타데이터 조회 경고를 줄이기 위한 선택입니다.

## 현재 구현과 장기 비전의 차이

현재 구현된 것:

- CLI 중심
- 4개 핵심 명령
- Plan/Trust 파일 저장
- Cloud Run/Firebase 배포 경로

아직 없는 것:

- MCP server runtime
- admin surface
- 고급 rollback orchestration
- Next.js SSR 지원

즉, 지금 아키텍처는 “배포 하네스 MVP”이고, “Google 전체 운영 플랫폼”까지는 아직 아닙니다.

## 문서 해석 원칙

이 문서는 PRD 전체 비전이 아니라 현재 `main` 코드 기준의 구조를 설명합니다. PRD와 차이가 있을 때는 구현이 우선입니다.
