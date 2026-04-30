# oh-my-google (omg)

[한국어](./README.md) | English

`oh-my-google` is a CLI + MCP harness that lets AI coding agents operate on Google Cloud, Firebase, and later broader Google services as one explicit, safer project workflow.

The goal is not to hide `gcloud` or the Firebase CLI. The goal is to stop agents from guessing across two CLIs, separate authentication contexts, separate consoles, project boundaries, cost boundaries, and destructive lifecycle actions. `omg` gives agents one structured entry point and one safety model.

The long-term direction is to help agents use Google Cloud and Firebase free programs and free tiers as effectively as possible, then bring broader Google services such as Google Workspace, Maps, Analytics, YouTube, Ads, and Gemini/Vertex under the same safety harness. Free trials and free tiers are provider-controlled and usage-dependent, so `omg` does not promise zero cost. It should prefer official-doc-backed guidance, dry-runs, budget guard, local cost lock, and conservative service-level `unknown` classifications.

## Why This Exists

Google Cloud and Firebase can share the same project ID, but the operational surface is split.

- `gcloud auth` and Application Default Credentials (ADC) are different contexts.
- Firebase login and gcloud login are managed separately.
- Cloud Run, Firebase Hosting, Firestore, Cloud Storage for Firebase, Secret Manager, and Billing Budgets use different APIs and permissions.
- Firebase secondary services such as Hosting, Firestore, and Storage each have different quotas, rules, IAM, and billing surfaces.
- AI agents do not see the operator's console context, so they can choose the wrong account, project, or cost-bearing action unless the workflow forces explicit checks.

`omg` reduces that risk in three ways.

- Every command has a structured `{ ok, command, data, error, next }` JSON contract.
- A Trust Profile decides whether an action is automatic, needs confirmation, needs approval, or is denied.
- CLI and MCP call the same core, so humans and agents use the same safety rules.

For product background, read [PRD.md](./PRD.md). For implementation sequencing, read [PLAN.md](./PLAN.md). For the current checklist, read [TODO.md](./TODO.md).

## Current Status

Status snapshot: 2026-04-30

Implemented:

- `init -> link -> deploy -> doctor` deployment flow
- Cloud Run + Firebase Hosting deployment with automatic Firebase rewrites
- Trust Profile gates across L0/L1/L2/L3 actions
- approval file queue with TTL, args hash validation, and consumed markers
- decision log and handoff artifact generation
- stdio MCP server with 32 tools
- gcloud named configuration creation, listing, switching, and project selection
- gcloud account vs ADC account mismatch detection and explicit ADC alignment
- Secret Manager list/set/delete
- Budget audit and Budget API enable workflow
- Budget ensure dry-run policy planning
- Budget Pub/Sub notification audit and dry-run routing planning
- Budget Pub/Sub alert to local cost lock ingestion dry-run planning
- Local cost lock: `omg cost status/lock/unlock`
- budget guard before live `omg deploy`, `omg firebase deploy --execute`, Secret Manager writes, and `omg init` billing/API/IAM setup
- Project audit, cleanup dry-run, approval-gated delete, and approval-gated undelete
- Read-only IAM audit
- Agent IAM separated-identity planning and bootstrap dry-run
- Read-only security posture audit
- Read-only Firestore database/index audit
- Read-only Cloud Storage bucket/IAM audit
- Read-only Cloud SQL instance/backup audit
- Downstream MCP gateway registry audit, tool discovery, and allowlisted read-only proxy calls
- active account mismatch blocking for project delete/undelete approvals
- free-tier-aware GCP+Firebase service coverage direction captured in PRD/PLAN/runbook docs

Live validation completed:

- Disposable GCP project E2E validation for `init -> link -> deploy -> doctor`
- Disposable E2E project verified through delete-request state after validation
- Stale project delete, undelete, and delete-again lifecycle smoke completed
- Existing KRW budget visibility confirmed on the live validation project after Budget API enablement
- Secret Manager smoke secret created under budget guard and deleted afterward
- Final smoke secret list confirmed empty

Current safety status and pending scope:

- The budget guard is currently enforced before live `omg deploy`, `omg firebase deploy --execute`, `omg secret set`, and `omg init` billing/API/IAM setup.
- If a project has an active local cost lock, those cost-bearing live operations fail with `COST_LOCKED` before budget audit runs.
- `budget enable-api` remains an explicit onboarding exception for budget visibility bootstrap and requires dry-run/`--yes`.
- The current execution backends are mostly `gcloud` and Firebase CLI connectors.
- `omg` is an MCP server and now has a narrow downstream MCP gateway for registered, allowlisted read-only tools.
- Live budget creation and budget mutation are not opened in the production CLI runtime yet. Current support is audit, Budget API enablement, `budget ensure --dry-run` policy planning, injected Budget API executor core, live gate contract, approval/decision-log command-core wiring, transport failure mapping, opt-in transport factory, mock-only live tests, budget notification audit/dry-run planning, read-only Pub/Sub topic/IAM audit, and budget alert to cost lock ingestion dry-run planning. Pub/Sub topic/IAM setup, alert ingestion setup, and live agent IAM bootstrap stay behind a manual-first boundary.
- Firestore, Cloud Storage, Cloud SQL, live IAM writes/provisioning, and external `notify` sender surfaces are not designed or implemented yet.
- Free-tier guidance commands/output are still design work. The documented direction is to classify Firebase Hosting, Firestore, Cloud Storage for Firebase, Cloud Run, Cloud Build, Artifact Registry, logging, and egress as separate service surfaces.
- Google Cloud/Firebase free policies can change in provider documentation. `omg` docs avoid fixed pricing numbers and use official links plus `unknown` as the conservative default.
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
- Downstream MCP write or lifecycle proxying is not implemented until a concrete verifier exists.
- Treat Firebase Hosting, Firestore, and Cloud Storage for Firebase as separate audit/plan/free-tier-risk surfaces rather than one undifferentiated Firebase target.
- Later Google Workspace, Maps Platform, Analytics, YouTube, Ads, and similar Google services should be added as separate service surfaces with explicit OAuth scopes, data-access posture, quota, cost, and approval boundaries.
- Start free-tier judgments from the [Google Cloud free program documentation](https://docs.cloud.google.com/free/docs/free-cloud-features?hl=ko), but keep ambiguous or stale policy claims as `unknown`.

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
| L0 | read-only | `doctor`, `auth context`, `project audit`, `budget audit`, `firestore audit`, `storage audit`, `sql audit`, `secret list`, `iam audit`, `security audit` |
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
omg budget ensure --project <id> --amount 50000 --currency KRW --dry-run
omg budget notifications audit --project <id> --topic budget-alerts
omg budget notifications ensure --project <id> --topic budget-alerts --dry-run
omg budget notifications lock-ingestion --project <id> --topic budget-alerts --dry-run
```

Cost lock:

```bash
omg cost status
omg cost status --project <id>
omg cost lock --project <id> --reason "budget alert threshold exceeded"
omg cost unlock --project <id> --yes
```

IAM:

```bash
omg iam audit --project <id>
omg iam plan --project <id>
omg iam bootstrap --project <id> --dry-run
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

Cloud Storage:

```bash
omg storage audit --project <id>
```

Cloud SQL:

```bash
omg sql audit --project <id>
```

MCP:

```bash
omg mcp start
```

## MCP Tools

The MCP server exposes 32 tools:

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
| `omg.budget.ensure` | Dry-run expected budget policy; live mutation blocked |
| `omg.budget.notifications.audit` | Audit budget Pub/Sub notification routing |
| `omg.budget.notifications.ensure` | Dry-run budget Pub/Sub notification routing; live mutation blocked |
| `omg.budget.notifications.lock_ingestion` | Dry-run budget alert to local cost lock ingestion setup |
| `omg.cost.status` | Read local cost lock status |
| `omg.cost.lock` | Set a local cost lock |
| `omg.cost.unlock` | Clear a local cost lock with explicit confirmation |
| `omg.firestore.audit` | Audit Firestore databases and composite indexes |
| `omg.iam.audit` | Audit IAM policy bindings and service accounts |
| `omg.iam.plan` | Plan separated agent IAM identities |
| `omg.iam.bootstrap` | Dry-run separated agent IAM bootstrap; live mutation blocked |
| `omg.security.audit` | Audit project security posture using read-only project, IAM, and budget checks |
| `omg.sql.audit` | Audit Cloud SQL instances and backups |
| `omg.storage.audit` | Audit Cloud Storage buckets and bucket IAM |
| `omg.mcp.gateway.audit` | Audit and optionally discover registered downstream MCP tools |
| `omg.mcp.gateway.call` | Call allowlisted read-only downstream MCP tools |
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
- `BUDGET_GUARD_BLOCKED`, `COST_LOCKED`

## Documentation Map

- [PRD.md](./PRD.md): product purpose, problem framing, users, and non-goals
- [PLAN.md](./PLAN.md): implementation direction and next work
- [TODO.md](./TODO.md): current done/in-progress/pending checklist
- [ARCHITECTURE.md](./ARCHITECTURE.md): internal architecture and boundaries
- [docs/runbooks/gcp-e2e.md](./docs/runbooks/gcp-e2e.md): disposable GCP E2E validation
- [docs/runbooks/project-cleanup-audit.md](./docs/runbooks/project-cleanup-audit.md): project lifecycle safety
- [docs/runbooks/budget-billing-guard.md](./docs/runbooks/budget-billing-guard.md): budget guard audit
- [docs/runbooks/budget-notifications.md](./docs/runbooks/budget-notifications.md): budget Pub/Sub notification audit and dry-run planning
- [docs/runbooks/cost-lock.md](./docs/runbooks/cost-lock.md): local cost-bearing operation lock
- [docs/runbooks/budget-cost-lock-ingestion.md](./docs/runbooks/budget-cost-lock-ingestion.md): Budget Pub/Sub alert to cost lock ingestion planning
- [docs/runbooks/free-tier-service-coverage.md](./docs/runbooks/free-tier-service-coverage.md): free-tier-aware GCP/Firebase service coverage direction
- [docs/runbooks/manual-first-cloud-writes.md](./docs/runbooks/manual-first-cloud-writes.md): Pub/Sub/IAM live setup manual-first decision
- [docs/runbooks/firestore-audit.md](./docs/runbooks/firestore-audit.md): Firestore resource audit
- [docs/runbooks/storage-audit.md](./docs/runbooks/storage-audit.md): Cloud Storage resource audit
- [docs/runbooks/sql-audit.md](./docs/runbooks/sql-audit.md): Cloud SQL resource audit
- [docs/runbooks/downstream-mcp-gateway.md](./docs/runbooks/downstream-mcp-gateway.md): downstream MCP gateway safety
- [docs/runbooks/phase-4-4b-release-notes.md](./docs/runbooks/phase-4-4b-release-notes.md): Phase 4 resource audits and Phase 4B gateway release notes
- [docs/runbooks/iam-audit.md](./docs/runbooks/iam-audit.md): IAM audit safety
- [docs/runbooks/agent-iam-planning.md](./docs/runbooks/agent-iam-planning.md): separated agent IAM planning
- [docs/runbooks/security-audit.md](./docs/runbooks/security-audit.md): security posture audit
- [docs/runbooks/secret-admin.md](./docs/runbooks/secret-admin.md): Secret Manager admin surface
- [docs/runbooks/mcp-client-smoke.md](./docs/runbooks/mcp-client-smoke.md): MCP client smoke
- [docs/runbooks/history-rewrite-and-conflict-safety.md](./docs/runbooks/history-rewrite-and-conflict-safety.md): post-rewrite conflict and push safety

## Development Principles

- AI agents should use `--output json` or MCP tools.
- Human approval is surfaced through `approval` and `next`, never hidden.
- Run dry-runs first; live writes and deletes must be explicit.
- Do not guess accounts or projects. Ask, select, or return a structured error.
- Treat an active cost lock as a hard blocker for cost-bearing live work.
- Preserve the cost-bearing invariant before adding broader live operations.
- Route external Google/Firebase MCP tools through the `omg` safety layer before exposing privileged execution to agents.
