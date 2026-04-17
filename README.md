# oh-my-google (omg)

`oh-my-google`은 AI 코딩 에이전트가 Google Cloud와 Firebase를 **하나의 프로젝트**로 안전하게 다루도록 돕는 **CLI + MCP 이중 surface** 하네스입니다.

같은 shared core를 CLI (`omg`)와 MCP 서버 (`omg mcp start`)가 함께 호출합니다.

- 4개 핵심 명령: `omg init`, `omg link`, `omg deploy`, `omg doctor`
- Approval 보조 명령: `omg approve`, `omg reject`, `omg approvals list`
- MCP 서버: 7개 tool (`omg.init`, `omg.link`, `omg.deploy`, `omg.doctor`, `omg.approve`, `omg.reject`, `omg.approvals.list`)

핵심 아이디어는 세 가지입니다.

- GCP와 Firebase를 하나의 프로젝트 흐름으로 다룬다.
- 에이전트가 파싱하기 쉬운 JSON 출력 계약을 제공한다 — `{ok, command, data?, error?, next?}`.
- Trust Profile이 결정한다. 필요 시 `require_approval` 워크플로가 사람 승인을 게이트로 삽입한다.

## 현재 상태

구현 범위:

- GCP 프로젝트 선택/생성, 빌링 연결, 필수 API 활성화, IAM 기본 바인딩
- 리포 감지 후 `.omg/project.yaml` 생성
- Trust Profile + 배포 게이트 (`auto` / `require_confirm` / `require_approval` / `deny`)
- Trust Profile deny policy (`.omg/trust.yaml`의 action pattern 차단선)
- `require_approval` end-to-end 워크플로 — `.omg/approvals/` 파일 큐, TTL, `argsHash` 조작 방지, `consumed` 마킹, 8종 `reasonCode`
- `.omg/decisions.log.jsonl` decision log와 `.omg/handoff.md` handoff artifact
- Cloud Run + Firebase Hosting 순차 배포 + rewrites 자동 주입
- stdio MCP 서버가 CLI와 동일한 shared core 호출
- `--output json` 구조화 출력

아직 구현되지 않았거나 유보된 범위:

- admin surface (`secret`, `iam`, `budget`, `notify`, `security`)
- 고급 rollback orchestration
- Next.js SSR 지원

## 설치

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

## CLI 명령 개요

### `omg init`

GCP 프로젝트, 빌링, API, IAM, Trust Profile을 초기화합니다.

```bash
omg init
omg init --project my-project --billing 000000-000000-000000 --environment dev --region asia-northeast3 --yes
omg --output json init --project my-project --billing 000000-000000-000000 --environment dev --region asia-northeast3 --yes
```

JSON 모드에서는 `--project`, `--billing`, `--environment`, `--region`, `--yes`가 모두 필요합니다.

### `omg link`

현재 리포를 분석해 `.omg/project.yaml`을 생성합니다. `spa-plus-api`로 감지되면 backend 먼저, frontend 나중 순서로 계획이 생성됩니다.

```bash
omg link
omg --output json link
```

### `omg deploy`

`.omg/project.yaml`과 `.omg/trust.yaml`을 읽어 배포합니다.

```bash
omg deploy --dry-run
omg deploy --yes
omg deploy --approval <id>
omg --output json deploy --dry-run
```

trust 규칙이 `require_approval`이면 deploy가 approval 파일을 자동 생성하고 `APPROVAL_REQUIRED` 에러 + `data.approvalId` + `next` 힌트를 반환합니다. 사람이 `omg approve <id>` 후 `omg deploy --approval <id>`로 재실행합니다.

### `omg doctor`

연결 상태를 점검합니다 — config / ADC / gcloud / firebase / Cloud Run API / Firebase project link.

### `omg approve <id>`, `omg reject <id>`, `omg approvals list`

Approval 워크플로 조작.

```bash
omg approve apr_20260417_143022_abc --reason "ship it"
omg reject apr_xxx --reason "args look wrong"
omg approvals list --status pending
```

### `omg mcp start`

stdio 기반 MCP 서버를 실행합니다. MCP 클라이언트(Claude Code, Codex 등)가 여기 붙어 7개 tool을 호출합니다.

## MCP tool 목록

| Tool | 설명 |
|---|---|
| `omg.init` | 프로젝트/빌링/환경/리전 초기화 + Trust Profile 생성 |
| `omg.link` | 리포 감지 후 Plan 생성 |
| `omg.deploy` | Trust gate + approval 경로를 거쳐 배포 (또는 dry-run) |
| `omg.doctor` | 연결 상태 진단 |
| `omg.approve` | Approval 승인 |
| `omg.reject` | Approval 거부 |
| `omg.approvals.list` | Approval 목록 조회 |

모든 tool은 CLI와 동일한 `{ok, command, data?, error?, next?}` 응답 구조를 사용합니다. MCP 응답은 이 객체를 `content[0].text`에 JSON 문자열로 감쌉니다.

## JSON 출력 계약

성공 예시:

```json
{
  "ok": true,
  "command": "link",
  "data": {
    "plan": {
      "version": 1,
      "detected": { "stack": "spa-plus-api" }
    }
  },
  "next": ["omg deploy --dry-run"]
}
```

실패 예시 (`APPROVAL_REQUIRED`):

```json
{
  "ok": false,
  "command": "deploy",
  "data": {
    "approvalId": "apr_20260417_143022_abc",
    "action": "deploy.cloud-run",
    "expiresAt": "2026-04-17T15:30:22Z"
  },
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "Deploy requires manual approval. Approval apr_... created.",
    "recoverable": true
  },
  "next": [
    "omg approve apr_20260417_143022_abc",
    "omg deploy --approval apr_20260417_143022_abc"
  ]
}
```

대표 에러 코드:

- `VALIDATION_ERROR`
- `NO_PROJECT`, `NO_BILLING`, `NO_AUTH`
- `NO_DEPLOYABLE_CONTENT`
- `NO_PLAN`, `NO_TRUST_PROFILE`
- `TRUST_DENIED`, `TRUST_REQUIRES_CONFIRM`, `TRUST_REQUIRES_APPROVAL`
- Approval 계열: `APPROVAL_REQUIRED`, `APPROVAL_NOT_FOUND`, `APPROVAL_EXPIRED`, `APPROVAL_NOT_APPROVED`, `APPROVAL_MISMATCH`, `APPROVAL_CONSUMED`, `APPROVAL_ALREADY_FINALIZED`

## 리포 구조

```text
src/
  approval/
    types.ts / hash.ts / queue.ts
  auth/
    auth-manager.ts
  cli/
    index.ts / output.ts / doctor.ts
    commands/
      init.ts / link.ts / deploy.ts / firebase.ts
      approve.ts / reject.ts / approvals.ts / mcp.ts
  connectors/
    cloud-run.ts / firebase.ts
  executor/
    apply.ts
  mcp/
    server.ts
    tools/
      doctor.ts / approvals-list.ts / approve.ts / reject.ts / deploy.ts / init.ts / link.ts / types.ts
  planner/
    detect.ts / gcp-state.ts / plan-builder.ts / schema.ts
  setup/
    project.ts / billing.ts / apis.ts / iam.ts
  trust/
    profile.ts / levels.ts / check.ts
  types/
    connector.ts / errors.ts / plan.ts / trust.ts
  wiring/
    firebase-rewrites.ts / env-inject.ts
```

## 문서

- [PRD.md](./PRD.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
- [PLAN.md](./PLAN.md)
- [AGENTS.md](./AGENTS.md)
- [MCP client smoke runbook](./docs/runbooks/mcp-client-smoke.md)
- [GCP E2E runbook](./docs/runbooks/gcp-e2e.md)

## 참고

이 문서는 현재 `main` 브랜치의 커밋된 코드 기준입니다. PRD의 장기 비전을 전체 설명하지는 않습니다.
