# oh-my-google (omg)

한국어 | [English](./README.en.md)

`oh-my-google`은 AI 코딩 에이전트가 Google Cloud와 Firebase를 하나의 안전한 작업 단위로 다루게 하는 CLI + MCP 하네스입니다.

이 프로젝트의 의도는 `gcloud`와 `firebase` CLI를 감추는 것이 아닙니다. AI 에이전트가 두 CLI, 두 인증 흐름, 두 콘솔, 여러 승인 경계를 직접 추측하지 않도록, 하나의 구조화된 진입점과 안전 규칙을 제공하는 것입니다.

## 왜 필요한가

Google Cloud와 Firebase는 같은 프로젝트 ID를 공유할 수 있지만, 실제 작업 표면은 분리되어 있습니다.

- `gcloud auth`와 Application Default Credentials(ADC)는 다릅니다.
- Firebase 로그인과 gcloud 계정은 별도로 관리됩니다.
- Cloud Run, Firebase Hosting, Secret Manager, Billing Budget은 서로 다른 API와 권한을 사용합니다.
- AI 에이전트는 사람이 보던 콘솔 맥락을 모르기 때문에 프로젝트, 계정, 비용, 파괴적 작업을 잘못 판단할 수 있습니다.

`omg`는 이 문제를 세 가지 방식으로 줄입니다.

- 모든 명령은 에이전트가 파싱할 수 있는 `{ ok, command, data, error, next }` JSON 계약을 가집니다.
- Trust Profile이 자동 실행, 확인 필요, 승인 필요, 거부를 결정합니다.
- CLI와 MCP가 같은 core를 호출하므로 사람과 에이전트가 같은 안전 모델을 씁니다.

자세한 제품 배경은 [PRD.md](./PRD.md)를, 구현 순서와 다음 작업은 [PLAN.md](./PLAN.md)를, 최신 체크리스트는 [TODO.md](./TODO.md)를 참고하세요.

## 현재 상태

최신 상태 기준: 2026-04-24

완료된 핵심 범위:

- `init -> link -> deploy -> doctor` 기본 배포 흐름 구현
- Cloud Run + Firebase Hosting 배포와 Firebase rewrites 자동 연결
- Trust Profile 기반 L0/L1/L2/L3 게이트
- approval 파일 큐, TTL, args hash 검증, consumed 마킹
- decision log와 handoff artifact 생성
- stdio MCP 서버와 19개 MCP tool
- gcloud named configuration 생성, 목록 조회, 전환, 프로젝트 선택
- gcloud 계정과 ADC 계정 불일치 진단 및 명시적 ADC alignment
- Secret Manager list/set/delete
- Budget audit와 Budget API enable workflow
- live `omg deploy`, `omg firebase deploy --execute`, Secret Manager write, `omg init` billing/API/IAM setup 전 budget guard 적용
- Project audit, cleanup dry-run, approval-gated delete, approval-gated undelete
- Read-only IAM audit
- Read-only security posture audit
- Read-only Firestore database/index audit
- project delete/undelete approval의 active account mismatch 차단

실제 검증된 범위:

- disposable GCP 프로젝트에서 `init -> link -> deploy -> doctor` E2E 검증 완료
- 해당 disposable 프로젝트는 검증 후 삭제 완료
- stale 프로젝트 삭제, 복구, 재삭제 lifecycle smoke 검증 완료
- live validation project에서 Budget API enable 후 기존 KRW budget visibility 확인
- Budget guard가 켜진 상태에서 Secret Manager smoke secret 생성 후 삭제 완료
- 최종 smoke secret list는 빈 목록으로 확인

현재 안전 상태와 남은 범위:

- budget guard는 현재 live `omg deploy`, `omg firebase deploy --execute`, `omg secret set`, `omg init` billing/API/IAM setup 전에 강제 적용됩니다.
- `budget enable-api`는 budget visibility bootstrap을 위한 명시적 예외이며 dry-run/`--yes`를 요구합니다.
- 현재 실행 backend는 주로 `gcloud`와 Firebase CLI connector입니다.
- `omg`는 현재 MCP server이지만, 아직 다른 Google/Firebase MCP를 내부에서 호출하는 downstream MCP gateway는 아닙니다.
- budget 생성/수정은 아직 구현하지 않았습니다. 현재는 audit과 Budget API enable만 지원합니다.
- Firestore write/provisioning, IAM write와 `notify` admin surface는 아직 설계/구현 전입니다.
- 고급 rollback orchestration은 아직 없습니다.
- Next.js SSR 배포는 지원하지 않습니다.

중요한 안전 한계:

- Google Cloud budget은 지출 알림/감시 장치이지, 하드 지출 상한이 아닙니다.
- `omg`는 계정을 조용히 바꾸지 않습니다. gcloud configuration 전환과 ADC alignment는 명령 또는 사용자 승인으로만 실행합니다.
- destructive lifecycle 작업은 approval-gated여도 보호 프로젝트, billing-enabled 프로젝트, owner 권한 없음, account mismatch에서 차단됩니다.

다음 아키텍처 방향:

- 기존 CLI backend도 `OperationIntent`로 분류하고 공통 safety decision을 통과하게 정리합니다.
- adapter capability manifest를 도입해 `gcloud-cli`, `firebase-cli`, 향후 downstream MCP/REST backend의 위험도를 같은 방식으로 표현합니다.
- Google/Firebase 서비스 MCP를 붙이더라도 raw tool을 agent에게 직접 노출하지 않고, `omg` safety gateway 아래에서 deny-by-default로 등록합니다.
- downstream MCP execution은 read-only discovery와 capability classification이 먼저입니다.

## 설치와 확인

필수 전제:

- Node.js 20+
- Google Cloud CLI: `gcloud`
- Firebase 작업 시 Firebase CLI: `firebase`
- 접근 가능한 GCP 프로젝트와 필요한 IAM 권한

설치:

```bash
npm install
npm run typecheck
npm run build
```

로컬 실행:

```bash
node bin/omg --help
node bin/omg --output json doctor
```

## 기본 워크플로

처음 설정:

```bash
omg setup
omg auth context
omg init
omg link
omg deploy --dry-run
```

승인 없이 가능한 dev 배포:

```bash
omg deploy --dry-run
omg deploy --yes
```

승인이 필요한 작업:

```bash
omg deploy
omg approve <approval-id> --reason "approved by owner"
omg deploy --approval <approval-id>
```

JSON 모드는 에이전트와 스크립트의 기본 경로입니다.

```bash
omg --output json doctor
omg --output json link
omg --output json deploy --dry-run
```

## Auth와 계정 전환

`omg`는 gcloud account와 ADC account를 구분합니다. 둘이 다르면 `doctor`와 `auth context`가 경고하고, `next`에 ADC alignment 힌트를 제공합니다.

주요 명령:

```bash
omg --output json auth list
omg --output json auth context
omg --output json auth create main --login
omg --output json auth create main --login --align-adc
omg --output json auth switch main
omg --output json auth switch main --align-adc
omg auth project
omg --output json auth project --project my-project
```

동작 원칙:

- `auth create --login`은 브라우저 gcloud login을 실행할 수 있습니다.
- 프로젝트를 명시하지 않았고 여러 프로젝트가 보이면 interactive mode에서 선택 UI를 띄웁니다.
- JSON mode에서는 프로젝트를 자동 추측하지 않고 필요한 경우 `PROJECT_SELECTION_REQUIRED`를 반환합니다.
- `--align-adc`가 있을 때만 `gcloud auth application-default login`을 실행합니다.

## Trust와 Approval

Trust level:

| Level | 의미 | 예시 |
|---|---|---|
| L0 | read-only | `doctor`, `auth context`, `project audit`, `budget audit`, `firestore audit`, `iam audit`, `security audit`, `secret list` |
| L1 | 일반 설정/배포 | API enable, Cloud Run deploy, Firebase Hosting deploy |
| L2 | 비용/권한/secret write 영향 | billing link, secret set, prod deploy |
| L3 | destructive 또는 lifecycle 작업 | project delete, project undelete, data delete |

기본 Trust Profile은 환경에 따라 다르게 동작합니다.

| Environment | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| `local`, `dev` | auto | auto | require_confirm | deny |
| `staging` | auto | require_confirm | require_approval | deny |
| `prod` | auto | require_approval | require_approval | deny |

Approval은 1회용입니다. 생성 당시 action과 args hash가 실행 시점과 다르면 `APPROVAL_MISMATCH`로 거부됩니다. project delete/undelete는 승인 생성 시점의 active gcloud account도 기록하며, 다른 계정으로 실행하면 `ACCOUNT_MISMATCH`로 거부됩니다.

## CLI 명령 표면

Core:

```bash
omg init
omg link
omg deploy
omg doctor
omg setup
```

Auth:

```bash
omg auth status
omg auth list
omg auth create <configuration>
omg auth context
omg auth switch <configuration>
omg auth project
omg auth refresh
omg auth logout
```

Approval:

```bash
omg approve <id>
omg reject <id>
omg approvals list
```

Budget:

```bash
omg budget audit --project <id>
omg budget enable-api --project <id> --dry-run
omg budget enable-api --project <id> --yes
```

IAM:

```bash
omg iam audit --project <id>
```

Security:

```bash
omg security audit --project <id>
```

Secret Manager:

```bash
omg secret list --limit 20
omg secret set API_KEY --value-file .secrets/api-key.txt --dry-run
omg secret set API_KEY --value-file .secrets/api-key.txt --yes
omg secret delete API_KEY --dry-run
omg secret delete API_KEY --yes
```

Project lifecycle:

```bash
omg project audit --project <id>
omg project cleanup --project <id> --dry-run
omg project delete --project <id> --expect-account owner@example.com
omg project undelete --project <id> --expect-account owner@example.com
```

Firebase helper surface:

```bash
omg firebase init
omg firebase deploy --dry-run
omg firebase deploy --execute --yes
omg firebase emulators
```

Firestore:

```bash
omg firestore audit --project <id>
```

MCP:

```bash
omg mcp start
```

## MCP tools

The MCP server exposes 19 tools:

| Tool | 설명 |
|---|---|
| `omg.auth.context` | gcloud/ADC/project context 조회 |
| `omg.init` | 프로젝트, 빌링, API, IAM, Trust Profile 초기화 |
| `omg.link` | repo 감지 후 deploy plan 생성 |
| `omg.deploy` | Trust gate와 approval을 거친 배포 또는 dry-run |
| `omg.doctor` | 로컬/Google/Firebase 연결 진단 |
| `omg.approve` | approval 승인 |
| `omg.reject` | approval 거부 |
| `omg.approvals.list` | approval 목록 조회 |
| `omg.budget.audit` | billing/budget guard audit |
| `omg.firestore.audit` | Firestore database/index audit |
| `omg.iam.audit` | IAM policy/service account audit |
| `omg.security.audit` | read-only project/IAM/budget security posture audit |
| `omg.secret.list` | Secret Manager metadata 조회 |
| `omg.secret.set` | Secret Manager secret 생성 또는 version 추가 |
| `omg.secret.delete` | Secret Manager secret 삭제 |
| `omg.project.audit` | 프로젝트 cleanup risk audit |
| `omg.project.cleanup` | cleanup dry-run plan |
| `omg.project.delete` | approval-gated project deletion |
| `omg.project.undelete` | approval-gated project recovery |

모든 MCP tool은 CLI와 같은 response envelope을 JSON string으로 반환합니다.

## 응답 계약

성공:

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

실패:

```json
{
  "ok": false,
  "command": "project:delete",
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "Project deletion requires manual approval.",
    "recoverable": true
  },
  "data": {
    "approvalId": "apr_20260420_120000_example",
    "action": "gcp.project.delete"
  },
  "next": [
    "omg approve apr_20260420_120000_example",
    "omg project delete --project example-project --approval apr_20260420_120000_example"
  ]
}
```

대표 error code:

- `VALIDATION_ERROR`
- `NO_PROJECT`, `NO_BILLING`, `NO_AUTH`
- `NO_DEPLOYABLE_CONTENT`
- `NO_PLAN`, `NO_TRUST_PROFILE`
- `TRUST_DENIED`, `TRUST_REQUIRES_CONFIRM`, `TRUST_REQUIRES_APPROVAL`
- `APPROVAL_REQUIRED`, `APPROVAL_NOT_FOUND`, `APPROVAL_EXPIRED`, `APPROVAL_NOT_APPROVED`, `APPROVAL_MISMATCH`, `APPROVAL_CONSUMED`, `APPROVAL_ALREADY_FINALIZED`
- `PROJECT_ACCESS_DENIED`, `PROJECT_SELECTION_REQUIRED`, `ACCOUNT_MISMATCH`
- `BUDGET_GUARD_BLOCKED`

## 문서 지도

- [PRD.md](./PRD.md): 제품 목적, 문제 정의, 사용 대상, non-goals
- [PLAN.md](./PLAN.md): 단계별 구현 방향과 다음 작업 순서
- [TODO.md](./TODO.md): 현재 완료/진행/미완료 체크리스트
- [ARCHITECTURE.md](./ARCHITECTURE.md): 내부 구조와 경계
- [docs/runbooks/gcp-e2e.md](./docs/runbooks/gcp-e2e.md): disposable GCP E2E 검증 절차
- [docs/runbooks/project-cleanup-audit.md](./docs/runbooks/project-cleanup-audit.md): project lifecycle safety
- [docs/runbooks/budget-billing-guard.md](./docs/runbooks/budget-billing-guard.md): budget guard audit
- [docs/runbooks/firestore-audit.md](./docs/runbooks/firestore-audit.md): Firestore resource audit
- [docs/runbooks/iam-audit.md](./docs/runbooks/iam-audit.md): IAM audit safety
- [docs/runbooks/security-audit.md](./docs/runbooks/security-audit.md): security posture audit
- [docs/runbooks/secret-admin.md](./docs/runbooks/secret-admin.md): Secret Manager admin surface
- [docs/runbooks/mcp-client-smoke.md](./docs/runbooks/mcp-client-smoke.md): MCP client smoke
- [docs/runbooks/history-rewrite-and-conflict-safety.md](./docs/runbooks/history-rewrite-and-conflict-safety.md): history rewrite 이후 충돌/푸시 안전 절차

## 개발 원칙

- AI 에이전트는 `--output json` 또는 MCP tool을 사용합니다.
- 사람이 필요한 작업은 `approval`과 `next`를 통해 명시합니다.
- dry-run을 먼저 실행하고, live write/delete는 명시적으로 실행합니다.
- 계정과 프로젝트는 추측하지 않습니다. 불확실하면 선택 또는 오류로 중단합니다.
- 비용이 발생할 수 있는 새 live 작업은 budget guard invariant를 먼저 만족해야 합니다.
- 외부 Google/Firebase MCP를 붙일 때도 raw privileged tool을 직접 노출하지 않고 `omg`의 safety layer를 통과시킵니다.
