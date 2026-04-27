# AGENTS.md — How AI Agents Should Use omg

Last updated: 2026-04-24

This file is the project-local operating guide for AI coding agents using `oh-my-google` (`omg`) in this repository.

## What omg Is

`omg` is an agent-first harness for operating Google Cloud and Firebase as one explicit project workflow.

Firebase and GCP can refer to the same underlying project, but the real operational surface is split across separate CLIs, auth contexts, APIs, consoles, and billing boundaries. `omg` gives agents a structured surface so they do not guess across those boundaries.

Agents can use two equivalent surfaces:

1. CLI: `omg --output json <command>`
2. MCP: `omg mcp start`, then call MCP tools

Both surfaces call the same shared core and use the same response contract.

Implementation note: `omg` exposes its own MCP server and a narrow internal downstream MCP gateway. Downstream MCP support must preserve the same Trust Profile, budget guard, approval, audit, and post-verification rules.

Current downstream MCP note: `omg` now supports a narrow gateway for registered downstream MCP servers. Use `.omg/mcp.yaml`, audit/discover first, and call only explicitly allowlisted read-only tools through `omg.mcp.gateway.call` or `omg mcp gateway call`.

## Agent Rules

1. Use JSON mode or MCP tools. Do not parse human-mode output.
2. Follow `next`. Every structured response may include the recommended next steps.
3. Branch on `error.code`, not error message text.
4. Run dry-runs before live deploy/write/delete operations when available.
5. Do not silently switch accounts, gcloud configurations, projects, or ADC.
6. Let the Trust Profile decide. Agents must not invent their own safety override.
7. Treat approval-gated operations as blocked until a human approval is recorded.
8. Treat budget visibility failures as blockers for autonomous cost-bearing writes.
9. Never print, log, or store secret payloads.
10. Verify final state before claiming that a live resource was created, deleted, restored, or cleaned up.
11. Do not call raw downstream Google/Firebase MCP tools for privileged operations unless they are routed through `omg` safety checks.
12. Treat unclassified downstream MCP tools as denied by default.

## Response Contract

All agent-facing responses use this envelope:

```json
{
  "ok": true,
  "command": "<name>",
  "data": {},
  "error": {
    "code": "",
    "message": "",
    "recoverable": true,
    "hint": ""
  },
  "next": []
}
```

MCP tool responses wrap this object as JSON text in `content[0].text`.

## Standard Workflows

### Initial Setup

CLI:

```bash
omg --output json setup
omg --output json auth context
omg --output json init --project <project-id> --billing <billing-account-id> --environment dev --region asia-northeast3 --yes
omg --output json link
omg --output json deploy --dry-run
```

MCP:

```text
omg.auth.context
omg.init
omg.link
omg.deploy { "dryRun": true }
```

### Account Context

Use these before live Google Cloud operations:

```bash
omg --output json auth list
omg --output json auth context
omg --output json doctor
```

If gcloud account and ADC account differ, `auth context` and `doctor` report it. Do not fix it silently. Use an explicit command:

```bash
omg --output json auth switch <configuration> --align-adc
```

or:

```bash
gcloud auth application-default login
```

### Project Selection

If multiple projects are visible, interactive CLI mode may show a selection prompt.

In JSON mode, do not guess. Expect `PROJECT_SELECTION_REQUIRED` and ask the user to choose or rerun with `--project`.

### Deploy

```bash
omg --output json deploy --dry-run
omg --output json deploy --yes
```

If approval is required:

```bash
omg --output json deploy
omg --output json approve <approval-id> --reason "approved by owner"
omg --output json deploy --approval <approval-id>
```

### Budget Guard

Budget audit is read-only:

```bash
omg --output json budget audit --project <project-id>
```

Budget API enablement is explicit:

```bash
omg --output json budget enable-api --project <project-id> --dry-run
omg --output json budget enable-api --project <project-id> --yes
```

Budget policy planning is read-only in the current implementation:

```bash
omg --output json budget ensure --project <project-id> --amount 50000 --currency KRW --dry-run
omg --output json budget notifications audit --project <project-id> --topic budget-alerts
omg --output json budget notifications ensure --project <project-id> --topic budget-alerts --dry-run
```

Current behavior: budget guard is enforced before all currently known cost-bearing live operations: live `omg deploy`, `omg firebase deploy --execute`, `omg secret set`, and `omg init` billing/API/IAM setup. `budget enable-api` remains an explicit dry-run/`--yes` bootstrap exception for budget visibility. `budget ensure --dry-run` plans expected policy only; live budget create/update is still blocked. `budget notifications audit` and `budget notifications ensure --dry-run` inspect visible budget routing plus optional Pub/Sub topic/IAM state; live notification mutation is still blocked.

### IAM Audit

IAM audit is read-only:

```bash
omg --output json iam audit --project <project-id>
```

MCP:

```text
omg.iam.audit { "project": "<project-id>" }
```

Rules:

- Use IAM audit before designing any IAM write/grant workflow.
- Treat `risk: high` or `inaccessible` IAM policy results as blockers for autonomous IAM writes.
- IAM writes are not implemented.

### Security Audit

Security audit is a read-only posture rollup:

```bash
omg --output json security audit --project <project-id>
```

MCP:

```text
omg.security.audit { "project": "<project-id>" }
```

Rules:

- Treat `risk: high` as a blocker for autonomous live operations until a human reviews the findings.
- Treat section errors as partial audit results, not proof that the project is safe.
- This is not Security Command Center integration and does not enable new Google APIs.

### Firestore Audit

Firestore audit is read-only:

```bash
omg --output json firestore audit --project <project-id>
```

MCP:

```text
omg.firestore.audit { "project": "<project-id>" }
```

Rules:

- Do not read or write Firestore documents through raw tools.
- Treat `risk: review` as a blocker before adding Firestore create, delete, export, import, or data mutation workflows.
- Future Firestore live workflows must be classified as operation intents and must preserve the cost-bearing invariant.

### Cloud Storage Audit

Cloud Storage audit is read-only:

```bash
omg --output json storage audit --project <project-id>
```

MCP:

```text
omg.storage.audit { "project": "<project-id>" }
```

Rules:

- Do not list, read, write, or delete Storage objects through raw tools.
- Treat `risk: high` as a blocker before adding bucket, object, IAM, or lifecycle mutation workflows.
- Future Storage live workflows must be classified as operation intents and must preserve the cost-bearing invariant.

### Cloud SQL Audit

Cloud SQL audit is read-only:

```bash
omg --output json sql audit --project <project-id>
```

MCP:

```text
omg.sql.audit { "project": "<project-id>" }
```

Rules:

- Do not connect to databases, read database data, export/import data, or mutate instances through raw tools.
- Treat `risk: high` as a blocker before adding instance, backup, network, export, import, or lifecycle workflows.
- Future SQL live workflows must be classified as operation intents and must preserve the cost-bearing invariant.

### Downstream MCP Gateway

Registry audit is read-only:

```bash
omg --output json mcp gateway audit
omg --output json mcp gateway audit --discover
```

Read-only proxy calls:

```bash
omg --output json mcp gateway call --server <id> --tool <name> --args-json "{}"
```

MCP:

```text
omg.mcp.gateway.audit { "discover": true }
omg.mcp.gateway.call { "server": "<id>", "tool": "<name>", "arguments": {} }
```

Rules:

- Configure downstream servers only in `.omg/mcp.yaml`.
- Use `envAllowlist`; never store secret env values in `.omg/mcp.yaml`.
- Unknown, unallowlisted, disabled, destructive, or non-read tools are denied.
- Do not expose raw downstream Google/Firebase MCP tools directly to agents.
- Downstream write/lifecycle proxying is intentionally not implemented until a verifier exists.

### Secret Manager

```bash
omg --output json secret list --limit 20
omg --output json secret set API_KEY --value-file .secrets/api-key.txt --dry-run
omg --output json secret set API_KEY --value-file .secrets/api-key.txt --yes
omg --output json secret delete API_KEY --dry-run
omg --output json secret delete API_KEY --yes
```

Rules:

- Prefer `--value-file` over `--value`.
- Do not print secret values.
- Live `secret set` must pass budget guard with `risk: configured`.
- Verify final list state after test cleanup.

### Project Lifecycle

Read-only inspection:

```bash
omg --output json project audit --project <project-id>
omg --output json project cleanup --project <project-id> --dry-run
```

Deletion:

```bash
omg --output json project delete --project <project-id> --expect-account <email>
omg --output json approve <approval-id> --reason "approved by owner"
omg --output json project delete --project <project-id> --approval <approval-id>
```

Recovery:

```bash
omg --output json project undelete --project <project-id> --expect-account <email>
omg --output json approve <approval-id> --reason "approved by owner"
omg --output json project undelete --project <project-id> --approval <approval-id>
```

Rules:

- `project audit` and `project cleanup --dry-run` are read-only.
- `project delete` and `project undelete` are L3 approval-gated.
- Delete is blocked for protected projects, billing-enabled projects, do-not-touch audit results, and non-owner callers.
- Undelete only runs for `DELETE_REQUESTED` projects.
- Delete/undelete approvals record the active gcloud account.
- Consuming those approvals with another active account fails with `ACCOUNT_MISMATCH`.
- Use `--expect-account` when the intended account is known.

## MCP Tools

The MCP server exposes 23 tools:

| Tool | Input | Meaning |
|---|---|---|
| `omg.auth.context` | none | Read gcloud configuration, active account, project, ADC account, and mismatch state |
| `omg.init` | `projectId`, `billingAccount`, `environment`, `region`, `yes?` | Initialize project, billing, APIs, IAM, and Trust Profile |
| `omg.link` | `region?`, `service?`, `site?` | Detect repo and create deploy plan |
| `omg.deploy` | `dryRun?`, `approval?`, `yes?` | Deploy or dry-run through Trust and approval gates |
| `omg.doctor` | none | Diagnose local, Google, and Firebase readiness |
| `omg.approve` | `approvalId`, `reason?`, `approver?` | Approve an approval request |
| `omg.reject` | `approvalId`, `reason?`, `rejecter?` | Reject an approval request |
| `omg.approvals.list` | `status?`, `action?` | List approvals |
| `omg.budget.audit` | `project` | Read billing/budget guard state |
| `omg.firestore.audit` | `project` | Read Firestore database and composite index metadata |
| `omg.iam.audit` | `project` | Read IAM policy bindings and service account metadata |
| `omg.security.audit` | `project` | Read-only project/IAM/budget security posture rollup |
| `omg.sql.audit` | `project` | Read Cloud SQL instance and backup metadata |
| `omg.storage.audit` | `project` | Read Cloud Storage bucket metadata and bucket IAM |
| `omg.mcp.gateway.audit` | `config?`, `discover?` | Audit registered downstream MCP servers and tools |
| `omg.mcp.gateway.call` | `server`, `tool`, `arguments?`, `config?` | Call allowlisted read-only downstream MCP tools |
| `omg.secret.list` | `project?`, `limit?` | List Secret Manager metadata only |
| `omg.secret.set` | `project?`, `name`, `value?`, `valueFile?`, `dryRun?`, `yes?` | Create a secret or add a version |
| `omg.secret.delete` | `project?`, `name`, `dryRun?`, `yes?` | Delete a Secret Manager secret |
| `omg.project.audit` | `project` | Audit project cleanup risk |
| `omg.project.cleanup` | `project`, `dryRun` | Return cleanup plan only |
| `omg.project.delete` | `project`, `approval?`, `expectAccount?` | Approval-gated project deletion |
| `omg.project.undelete` | `project`, `approval?`, `expectAccount?` | Approval-gated project recovery |

## Trust And Approval

Trust levels:

| Level | Meaning | Examples |
|---|---|---|
| L0 | read-only | `doctor`, `auth context`, `project audit`, `budget audit`, `firestore audit`, `storage audit`, `sql audit`, `iam audit`, `security audit`, `secret list` |
| L1 | normal setup/deploy changes | API enable, Cloud Run deploy, Firebase Hosting deploy |
| L2 | cost/permission/secret write impact | billing link, IAM grant, `secret set` |
| L3 | destructive/lifecycle actions | project delete, project undelete, data delete |

Approval rules:

- Approvals are one-use.
- Approval args are hash-bound.
- Expired approvals fail.
- Already consumed approvals fail.
- Action/args mismatch returns `APPROVAL_MISMATCH`.
- Project lifecycle account mismatch returns `ACCOUNT_MISMATCH`.
- `deny` rules in `.omg/trust.yaml` run before approval.

## Error Code Handling

| `error.code` | Meaning | Agent response |
|---|---|---|
| `VALIDATION_ERROR` | Invalid input | Fix parameters |
| `NO_PROJECT` | No project configured | Run setup/init or provide project |
| `NO_BILLING` | Billing is missing | Provide/link billing account |
| `NO_AUTH` | Auth missing | Run login/setup |
| `NO_PLAN` | No `.omg/project.yaml` | Run `omg link` |
| `NO_TRUST_PROFILE` | No `.omg/trust.yaml` | Run `omg init` |
| `NO_DEPLOYABLE_CONTENT` | Repo not deployable | Add supported app structure or stop |
| `TRUST_DENIED` | Trust policy denied action | Do not bypass; ask user |
| `TRUST_REQUIRES_CONFIRM` | JSON mode needs explicit confirm | Rerun with `yes: true` only if user approved |
| `APPROVAL_REQUIRED` | Human approval needed | Preserve `approvalId`; wait for approval |
| `APPROVAL_NOT_FOUND` | Approval id missing | Check id or create new approval |
| `APPROVAL_NOT_APPROVED` | Approval still pending | Ask user to approve |
| `APPROVAL_EXPIRED` | Approval expired | Create a new approval |
| `APPROVAL_MISMATCH` | Args/action changed | Use approved args or create a new approval |
| `APPROVAL_CONSUMED` | Approval already used | Create a new approval |
| `APPROVAL_ALREADY_FINALIZED` | Approval is no longer pending | Inspect approval state |
| `PROJECT_ACCESS_DENIED` | Project cannot be accessed safely | Stop and ask user |
| `PROJECT_SELECTION_REQUIRED` | Multiple/no visible projects | Ask user to choose project |
| `ACCOUNT_MISMATCH` | Active account differs from expected/approved account | Switch explicitly or ask user |
| `BUDGET_GUARD_BLOCKED` | Budget guard not configured | Stop; inspect budget state |

## CLI Reference

```bash
omg init [--project --billing --environment --region --yes]
omg link [--region --service --site]
omg deploy [--dry-run] [--yes] [--approval <id>]
omg doctor
omg setup [--configuration <name>] [--project-id <id>] [--login] [--align-adc]

omg auth list
omg auth context
omg auth create <configuration> [--account <email>] [--project <id>] [--login] [--align-adc]
omg auth switch <configuration> [--align-adc]
omg auth project [--project <id>]

omg approve <id> [--reason <text>]
omg reject <id> [--reason <text>]
omg approvals list [--status <s>] [--action <a>]

omg budget audit --project <id>
omg budget enable-api --project <id> [--dry-run] [--yes]
omg budget ensure --project <id> --amount <n> --currency <code> [--thresholds <list>] --dry-run
omg budget notifications audit --project <id> [--topic <topic>]
omg budget notifications ensure --project <id> --topic <topic> [--display-name <name>] --dry-run

omg iam audit --project <id>

omg security audit --project <id>

omg secret list [--project <id>] [--limit <n>]
omg secret set <name> [--project <id>] [--value <value> | --value-file <path>] [--dry-run] [--yes]
omg secret delete <name> [--project <id>] [--dry-run] [--yes]

omg project audit --project <id>
omg project cleanup --project <id> --dry-run
omg project delete --project <id> [--expect-account <email>] [--approval <id>]
omg project undelete --project <id> [--expect-account <email>] [--approval <id>]

omg firebase init
omg firebase deploy [--dry-run | --execute --yes]
omg firebase emulators

omg firestore audit --project <id>

omg storage audit --project <id>

omg sql audit --project <id>

omg mcp gateway audit

omg mcp gateway audit --discover

omg mcp gateway call --server <id> --tool <name> --args-json "{}"

omg mcp start
```

Global JSON mode:

```bash
omg --output json <command>
```

## Documentation Map

- [README.md](./README.md): human overview and current status
- [README.en.md](./README.en.md): English overview
- [PRD.md](./PRD.md): product intent and requirements
- [PLAN.md](./PLAN.md): implementation phases and next work
- [TODO.md](./TODO.md): current checklist and known risks
- [ARCHITECTURE.md](./ARCHITECTURE.md): current module boundaries
- [docs/runbooks](./docs/runbooks): validation and live-operation records
- [docs/runbooks/firestore-audit.md](./docs/runbooks/firestore-audit.md): Firestore resource audit
- [docs/runbooks/storage-audit.md](./docs/runbooks/storage-audit.md): Cloud Storage resource audit
- [docs/runbooks/sql-audit.md](./docs/runbooks/sql-audit.md): Cloud SQL resource audit
- [docs/runbooks/downstream-mcp-gateway.md](./docs/runbooks/downstream-mcp-gateway.md): downstream MCP gateway safety
- [docs/runbooks/phase-4-4b-release-notes.md](./docs/runbooks/phase-4-4b-release-notes.md): Phase 4 and Phase 4B release notes
- [docs/runbooks/iam-audit.md](./docs/runbooks/iam-audit.md): IAM audit safety
- [docs/runbooks/security-audit.md](./docs/runbooks/security-audit.md): security posture audit
- [docs/runbooks/budget-notifications.md](./docs/runbooks/budget-notifications.md): budget Pub/Sub notification audit and dry-run planning
- [docs/runbooks/history-rewrite-and-conflict-safety.md](./docs/runbooks/history-rewrite-and-conflict-safety.md): conflict, clone, and push rules after history rewrite
