# oh-my-google (omg)

[한국어](./README.md) | English

`oh-my-google` is a CLI + MCP harness that lets AI coding agents operate on Google Cloud and Firebase as one explicit, safer project workflow.

The goal is not to hide `gcloud` or the Firebase CLI. The goal is to stop agents from guessing across two CLIs, separate authentication contexts, separate consoles, project boundaries, cost boundaries, and destructive lifecycle actions. `omg` gives agents one structured entry point and one safety model.

## Why This Exists

Google Cloud and Firebase can share the same project ID, but the operational surface is split.

- `gcloud auth` and Application Default Credentials (ADC) are different contexts.
- Firebase login and gcloud login are managed separately.
- Cloud Run, Firebase Hosting, Secret Manager, and Billing Budgets use different APIs and permissions.
- AI agents do not see the operator's console context, so they can choose the wrong account, project, or cost-bearing action unless the workflow forces explicit checks.

`omg` reduces that risk in three ways.

- Every command has a structured `{ ok, command, data, error, next }` JSON contract.
- A Trust Profile decides whether an action is automatic, needs confirmation, needs approval, or is denied.
- CLI and MCP call the same core, so humans and agents use the same safety rules.

For product background, read [PRD.md](./PRD.md). For implementation sequencing, read [PLAN.md](./PLAN.md). For the current checklist, read [TODO.md](./TODO.md).

## Current Status

Status snapshot: 2026-04-24

Implemented:

- `init -> link -> deploy -> doctor` deployment flow
- Cloud Run + Firebase Hosting deployment with automatic Firebase rewrites
- Trust Profile gates across L0/L1/L2/L3 actions
- approval file queue with TTL, args hash validation, and consumed markers
- decision log and handoff artifact generation
- stdio MCP server with 18 tools
- gcloud named configuration creation, listing, switching, and project selection
- gcloud account vs ADC account mismatch detection and explicit ADC alignment
- Secret Manager list/set/delete
- Budget audit and Budget API enable workflow
- budget guard before live `omg deploy`, `omg firebase deploy --execute`, Secret Manager writes, and `omg init` billing/API/IAM setup
- Project audit, cleanup dry-run, approval-gated delete, and approval-gated undelete
- Read-only IAM audit
- Read-only security posture audit
- active account mismatch blocking for project delete/undelete approvals

Live validation completed:

- Disposable GCP project E2E validation for `init -> link -> deploy -> doctor`
- Disposable E2E project deleted after validation
- Stale project delete, undelete, and delete-again lifecycle smoke completed
- Existing KRW budget visibility confirmed on the live validation project after Budget API enablement
- Secret Manager smoke secret created under budget guard and deleted afterward
- Final smoke secret list confirmed empty

Current safety status and pending scope:

- The budget guard is currently enforced before live `omg deploy`, `omg firebase deploy --execute`, `omg secret set`, and `omg init` billing/API/IAM setup.
- `budget enable-api` remains an explicit onboarding exception for budget visibility bootstrap and requires dry-run/`--yes`.
- The current execution backends are mostly `gcloud` and Firebase CLI connectors.
- `omg` is currently an MCP server, but it is not yet a downstream MCP gateway that calls other Google/Firebase MCP servers internally.
- Budget creation and budget mutation are not implemented yet. Current support is audit plus Budget API enablement.
- IAM writes and `notify` admin surfaces are not designed or implemented yet.
- Advanced rollback orchestration is not implemented.
- Next.js SSR deployment is not supported.

Important safety limits:

- Google Cloud budgets are alerts and monitoring controls, not hard spend caps.
- `omg` does not silently switch accounts. gcloud configuration changes and ADC alignment require a command or user approval.
- Destructive lifecycle actions are blocked even before approval when the project is protected, billing is enabled, owner permission is missing, or the active account does not match.

Next architecture direction:

- Represent existing CLI-backed operations as `OperationIntent` objects and send them through one shared safety decision path.
- Add adapter capability manifests for `gcloud-cli`, `firebase-cli`, and future downstream MCP/REST backends.
- If Google/Firebase service MCPs are added, do not expose their raw privileged tools directly to agents; register them behind the `omg` safety gateway with deny-by-default classification.
- Downstream MCP execution should start with read-only discovery and capability classification before any write proxy exists.

## Install And Verify

Prerequisites:

- Node.js 20+
- Google Cloud CLI: `gcloud`
- Firebase CLI for Firebase workflows: `firebase`
- Access to a GCP project with the required IAM permissions

Install:

```bash
npm install
npm run typecheck
npm run build
```

Run locally:

```bash
node bin/omg --help
node bin/omg --output json doctor
```

## Basic Workflow

Initial setup:

```bash
omg setup
omg auth context
omg init
omg link
omg deploy --dry-run
```

Dev deploy when the Trust Profile allows it:

```bash
omg deploy --dry-run
omg deploy --yes
```

Approval-gated work:

```bash
omg deploy
omg approve <approval-id> --reason "approved by owner"
omg deploy --approval <approval-id>
```

JSON mode is the default path for agents and scripts:

```bash
omg --output json doctor
omg --output json link
omg --output json deploy --dry-run
```

## Auth And Account Switching

`omg` treats the gcloud account and ADC account as separate. If they differ, `doctor` and `auth context` report the mismatch and include an ADC alignment hint in `next`.

Core auth commands:

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

Behavior:

- `auth create --login` can open browser-based gcloud login.
- If no project is provided and multiple projects are visible, interactive mode shows a selection prompt.
- JSON mode does not guess when multiple projects are visible; it returns `PROJECT_SELECTION_REQUIRED`.
- `gcloud auth application-default login` runs only when `--align-adc` is provided or the interactive setup prompt is approved.

## Trust And Approval

Trust levels:

| Level | Meaning | Examples |
|---|---|---|
| L0 | read-only | `doctor`, `auth context`, `project audit`, `budget audit`, `secret list`, `iam audit`, `security audit` |
| L1 | normal configuration/deploy | API enable, Cloud Run deploy, Firebase Hosting deploy |
| L2 | cost, permission, or secret-write impact | billing link, secret set, prod deploy |
| L3 | destructive or lifecycle actions | project delete, project undelete, data delete |

Default Trust Profile behavior:

| Environment | L0 | L1 | L2 | L3 |
|---|---|---|---|---|
| `local`, `dev` | auto | auto | require_confirm | deny |
| `staging` | auto | require_confirm | require_approval | deny |
| `prod` | auto | require_approval | require_approval | deny |

Approvals are one-use artifacts. If the action or args hash changes, execution returns `APPROVAL_MISMATCH`. Project delete and undelete also record the active gcloud account at approval creation time; using a different active account returns `ACCOUNT_MISMATCH`.

## CLI Surface

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

MCP:

```bash
omg mcp start
```

## MCP Tools

The MCP server exposes 18 tools:

| Tool | Description |
|---|---|
| `omg.auth.context` | Read gcloud/ADC/project context |
| `omg.init` | Initialize project, billing, APIs, IAM, and Trust Profile |
| `omg.link` | Detect the repo and create a deploy plan |
| `omg.deploy` | Deploy or dry-run through Trust and approval gates |
| `omg.doctor` | Diagnose local, Google, and Firebase connectivity |
| `omg.approve` | Approve an approval request |
| `omg.reject` | Reject an approval request |
| `omg.approvals.list` | List approval requests |
| `omg.budget.audit` | Audit billing and budget guard state |
| `omg.iam.audit` | Audit IAM policy bindings and service accounts |
| `omg.security.audit` | Audit project security posture using read-only project, IAM, and budget checks |
| `omg.secret.list` | List Secret Manager metadata |
| `omg.secret.set` | Create a secret or add a new secret version |
| `omg.secret.delete` | Delete a Secret Manager secret |
| `omg.project.audit` | Audit project cleanup risk |
| `omg.project.cleanup` | Produce a cleanup dry-run plan |
| `omg.project.delete` | Approval-gated project deletion |
| `omg.project.undelete` | Approval-gated project recovery |

Every MCP tool returns the same response envelope as the CLI, wrapped as JSON text.

## Response Contract

Success:

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

Failure:

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

Representative error codes:

- `VALIDATION_ERROR`
- `NO_PROJECT`, `NO_BILLING`, `NO_AUTH`
- `NO_DEPLOYABLE_CONTENT`
- `NO_PLAN`, `NO_TRUST_PROFILE`
- `TRUST_DENIED`, `TRUST_REQUIRES_CONFIRM`, `TRUST_REQUIRES_APPROVAL`
- `APPROVAL_REQUIRED`, `APPROVAL_NOT_FOUND`, `APPROVAL_EXPIRED`, `APPROVAL_NOT_APPROVED`, `APPROVAL_MISMATCH`, `APPROVAL_CONSUMED`, `APPROVAL_ALREADY_FINALIZED`
- `PROJECT_ACCESS_DENIED`, `PROJECT_SELECTION_REQUIRED`, `ACCOUNT_MISMATCH`
- `BUDGET_GUARD_BLOCKED`

## Documentation Map

- [PRD.md](./PRD.md): product purpose, problem framing, users, and non-goals
- [PLAN.md](./PLAN.md): implementation direction and next work
- [TODO.md](./TODO.md): current done/in-progress/pending checklist
- [ARCHITECTURE.md](./ARCHITECTURE.md): internal architecture and boundaries
- [docs/runbooks/gcp-e2e.md](./docs/runbooks/gcp-e2e.md): disposable GCP E2E validation
- [docs/runbooks/project-cleanup-audit.md](./docs/runbooks/project-cleanup-audit.md): project lifecycle safety
- [docs/runbooks/budget-billing-guard.md](./docs/runbooks/budget-billing-guard.md): budget guard audit
- [docs/runbooks/iam-audit.md](./docs/runbooks/iam-audit.md): IAM audit safety
- [docs/runbooks/security-audit.md](./docs/runbooks/security-audit.md): security posture audit
- [docs/runbooks/secret-admin.md](./docs/runbooks/secret-admin.md): Secret Manager admin surface
- [docs/runbooks/mcp-client-smoke.md](./docs/runbooks/mcp-client-smoke.md): MCP client smoke
- [docs/runbooks/history-rewrite-and-conflict-safety.md](./docs/runbooks/history-rewrite-and-conflict-safety.md): post-rewrite conflict and push safety

## Development Principles

- AI agents should use `--output json` or MCP tools.
- Human approval is surfaced through `approval` and `next`, never hidden.
- Run dry-runs first; live writes and deletes must be explicit.
- Do not guess accounts or projects. Ask, select, or return a structured error.
- Keep expanding budget guard coverage before adding broader live operations.
- Route external Google/Firebase MCP tools through the `omg` safety layer before exposing privileged execution to agents.
