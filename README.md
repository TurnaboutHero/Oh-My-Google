# oh-my-google (omg)

`oh-my-google`은 AI 코딩 에이전트가 Google Cloud와 Firebase를 더 예측 가능하게 다루도록 돕는 CLI 하네스입니다.

현재 구현 초점은 Phase 1.1 기준의 4개 명령입니다.

- `omg init`
- `omg link`
- `omg deploy`
- `omg doctor`

핵심 아이디어는 두 가지입니다.

- GCP와 Firebase를 하나의 프로젝트 흐름으로 다룬다.
- 에이전트가 파싱하기 쉬운 JSON 출력 계약을 제공한다.

## 현재 상태

현재 저장소에서 실제로 구현된 범위:

- GCP 프로젝트 선택/생성, 빌링 연결, 필수 API 활성화, IAM 기본 바인딩
- 리포 감지 후 `.omg/project.yaml` 생성
- Trust Profile 저장과 배포 게이트
- Cloud Run + Firebase Hosting 순차 배포
- Firebase rewrites 자동 주입
- `--output json` 구조화 출력

아직 구현되지 않았거나 유보된 범위:

- MCP 서버
- admin surface (`budget`, `secret`, `iam`, `notify`, `security`)
- 고급 승인 UX
- 서비스별 세밀한 롤백

## 설치

개발 환경:

```bash
npm install
npm run typecheck
npm run build
```

로컬 실행:

```bash
npm run dev -- --help
node bin/omg --help
```

필수 전제:

- Node.js 20+
- `gcloud` CLI
- 필요 시 `firebase` CLI
- GCP ADC 인증

## 명령 개요

### `omg init`

GCP 프로젝트, 빌링, API, IAM, Trust Profile을 초기화합니다.

예시:

```bash
omg init
omg init --project my-project --billing 000000-000000-000000 --environment dev --region asia-northeast3 --yes
omg --output json init --project my-project --billing 000000-000000-000000 --environment dev --region asia-northeast3 --yes
```

JSON 모드에서는 다음 플래그가 모두 필요합니다.

- `--project`
- `--billing`
- `--environment`
- `--region`
- `--yes`

### `omg link`

현재 리포를 분석해 `.omg/project.yaml`을 생성합니다.

감지하는 대표 신호:

- `Dockerfile`
- `package.json`
- `firebase.json`
- `public/`
- `index.html`
- `functions/`
- `next.config.js` / `next.config.ts`

예시:

```bash
omg link
omg --output json link
```

`spa-plus-api` 리포로 감지되면 backend 먼저, frontend 나중 순서로 계획이 생성됩니다.

### `omg deploy`

`.omg/project.yaml`과 `.omg/trust.yaml`을 읽어 배포합니다.

예시:

```bash
omg deploy --dry-run
omg deploy --yes
omg --output json deploy --dry-run
```

현재 동작:

- `--dry-run`이면 계획만 출력
- backend가 있으면 `deploy.cloud-run` trust 게이트 적용
- `require_confirm`이면 JSON 모드에서 `--yes`가 필요
- `require_approval`이면 현재는 구조화 에러로 차단

### `omg doctor`

현재 환경 상태를 점검합니다.

체크 항목:

- 로컬 omg config
- ADC 인증 존재 여부
- Cloud Run API 점검 가능 여부
- `firebase` CLI 존재 여부
- `gcloud` CLI 존재 여부

## JSON 출력 계약

성공 예시:

```json
{
  "ok": true,
  "command": "link",
  "data": {
    "plan": {
      "version": 1,
      "detected": {
        "stack": "spa-plus-api"
      }
    }
  },
  "next": ["omg deploy --dry-run"]
}
```

실패 예시:

```json
{
  "ok": false,
  "command": "init",
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "JSON mode requires --project, --billing, --environment, --region, and --yes.",
    "recoverable": false,
    "hint": "Provide --project, --billing, --environment, --region, and --yes in JSON mode."
  }
}
```

대표 에러 코드:

- `VALIDATION_ERROR`
- `NO_PROJECT`
- `NO_DEPLOYABLE_CONTENT`
- `NO_PLAN`
- `NO_TRUST_PROFILE`
- `NO_BILLING`
- `NO_AUTH`
- `TRUST_REQUIRES_CONFIRM`
- `TRUST_REQUIRES_APPROVAL`

## 리포 구조

현재 핵심 디렉터리:

```text
src/
  auth/
  cli/
    commands/
  connectors/
  executor/
  planner/
  setup/
  trust/
  types/
  wiring/
```

주요 파일:

- `src/cli/index.ts`
- `src/cli/output.ts`
- `src/cli/commands/init.ts`
- `src/cli/commands/link.ts`
- `src/cli/commands/deploy.ts`
- `src/planner/schema.ts`
- `src/trust/profile.ts`
- `src/executor/apply.ts`

## 문서

- [PRD.md](./PRD.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PLAN.md](./PLAN.md)
- [AGENTS.md](./AGENTS.md)

## 참고

현재 이 문서는 “지금 커밋된 코드” 기준입니다. PRD의 장기 비전 전체를 설명하지 않고, 실제 구현 범위만 반영합니다.
