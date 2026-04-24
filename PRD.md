# Product Requirements Document: oh-my-google

Version: 0.3 safety-gateway direction refresh
Last updated: 2026-04-24

## Summary

`oh-my-google` (`omg`) is an agent-first safety harness for Google Cloud and Firebase.

The product exists because AI coding agents can write and deploy code, but Google Cloud operations still require project context, account context, billing awareness, API enablement, IAM boundaries, and service-to-service wiring. Those details are split across `gcloud`, Firebase CLI, ADC, Firebase login, and Google Cloud Console.

`omg` gives agents one structured surface:

- CLI: `omg --output json <command>`
- MCP: `omg mcp start`
- Shared core: the same implementation path underneath both surfaces
- Safety layer: Trust Profile, approvals, account checks, and budget guard

Current execution mostly uses official `gcloud` and Firebase CLI backends. Existing operations are now classified through an operation-intent model and shared safety decision path, so future Google/Firebase service MCPs can be added without bypassing the same guardrails.

## Problem

Google Cloud and Firebase are powerful but easy for an autonomous agent to misuse.

Primary failure modes:

- Wrong account: active gcloud account and ADC can differ.
- Wrong project: a user may have multiple GCP projects visible.
- Wrong lifecycle target: stale, protected, production, and personal projects can look similar to an agent.
- Cost uncertainty: billing-enabled projects can incur cost even when the operation looks small.
- Console-only context: budget, IAM, Firebase project linkage, and enabled APIs are not obvious from repo files.
- Split tooling: Cloud Run and Firebase Hosting require different commands and wiring.
- Unstructured CLI output: plain text output is brittle for agents to parse.

The product requirement is not simply "wrap gcloud." The requirement is to make agent behavior auditable, bounded, and recoverable.

## Goals

1. Provide a single agent-friendly command surface for common GCP + Firebase workflows.
2. Make every response structured and machine-actionable.
3. Keep human approval in the loop for destructive, high-risk, production, or ambiguous actions.
4. Detect account/project mismatches before live operations.
5. Make cost-bearing operations increasingly dependent on explicit budget visibility.
6. Keep CLI and MCP behavior equivalent by sharing core implementation.
7. Prepare a common operation classification layer for CLI, Firebase CLI, gcloud, REST/SDK, and downstream MCP adapters.
8. Prefer narrow, composable workflows over a broad cloud automation layer.

## Non-Goals

- Replacing Google Cloud Console.
- Replacing `gcloud` or Firebase CLI for expert users.
- Supporting every GCP service.
- Silent account switching.
- Silent ADC switching.
- Creating or mutating budgets without an explicit future workflow.
- Fully preventing spend through budgets; Google Cloud budgets are alerts, not hard caps.
- Supporting Next.js SSR deployment in the current phase.
- Exposing arbitrary downstream MCP tools directly to agents without operation classification, capability metadata, and safety review.

## Target Users

Primary users:

- AI coding agents such as Codex, Claude Code, Gemini CLI, Cursor-style agents, and similar tools.
- Developers who want those agents to deploy into Google Cloud with safer defaults.

Secondary users:

- Humans who want a JSON-first wrapper around common Google Cloud + Firebase workflows.
- CI or local scripts that need predictable response contracts.

## Product Principles

### One Google Project Flow

Firebase and GCP should be treated as one project-level workflow where possible. The agent should not have to infer whether a deployment belongs to Firebase Hosting, Cloud Run, Secret Manager, or Billing APIs from scratch each time.

### Trust Profile Decides

The agent should not independently decide whether a risky operation is safe. It should ask the Trust Profile and follow the result:

- `auto`
- `require_confirm`
- `require_approval`
- `deny`

### JSON Is The Agent Contract

Every command must be readable by machines:

```json
{
  "ok": true,
  "command": "doctor",
  "data": {},
  "next": []
}
```

Failures must use stable `error.code` values so agents can branch safely.

### Dry-Run First

Where practical, live operations should have a dry-run path. Agents should be able to show the plan before touching Google Cloud.

### No Silent Context Mutation

Switching gcloud configurations and aligning ADC are side effects. They must be explicit through a command flag, interactive confirmation, or documented approval flow.

## Current Scope

Implemented core workflow:

- `omg setup`
- `omg auth context/list/create/switch/project`
- `omg init`
- `omg link`
- `omg deploy`
- `omg doctor`
- `omg approve/reject/approvals list`

Implemented admin and safety workflow:

- `omg budget audit`
- `omg budget enable-api`
- `omg firestore audit`
- `omg iam audit`
- `omg security audit`
- `omg secret list/set/delete`
- `omg project audit/cleanup/delete/undelete`

Implemented MCP tools:

- `omg.auth.context`
- `omg.init`
- `omg.link`
- `omg.deploy`
- `omg.doctor`
- `omg.approve`
- `omg.reject`
- `omg.approvals.list`
- `omg.budget.audit`
- `omg.firestore.audit`
- `omg.iam.audit`
- `omg.security.audit`
- `omg.secret.list`
- `omg.secret.set`
- `omg.secret.delete`
- `omg.project.audit`
- `omg.project.cleanup`
- `omg.project.delete`
- `omg.project.undelete`

Current execution boundary:

- CLI and MCP surfaces call shared TypeScript command functions.
- Service execution currently uses narrow connectors over `gcloud`, Firebase CLI, and selected Google client libraries.
- `omg` is not yet a downstream MCP client or MCP gateway. Future service MCPs must be routed through the same safety kernel rather than exposed as raw privileged tools.

## Safety Requirements

### Account Safety

- `doctor` and `auth context` must expose active gcloud account, active project, ADC account, and mismatch state when available.
- `auth switch` must not align ADC unless `--align-adc` is present.
- `setup` may prompt for ADC alignment in interactive mode, but JSON mode requires explicit flags.
- Project delete/undelete approvals must record the active gcloud account.
- Consuming those approvals with a different active account must fail with `ACCOUNT_MISMATCH`.
- `--expect-account <email>` must fail early when the active account differs from the expected account.

### Project Lifecycle Safety

- `project audit` and `project cleanup --dry-run` must be read-only.
- `project delete` must be L3 and approval-gated.
- `project undelete` must be L3 and approval-gated.
- Protected projects must be blocked before approval.
- Billing-enabled projects must be blocked before deletion approval.
- Non-owner callers must be blocked before deletion approval.
- Undelete must only run for `DELETE_REQUESTED` projects.

### Cost Safety

- Budget audit must be read-only.
- Budget API enablement must require explicit `--yes` after a dry-run option.
- Live deploys, Firebase helper deploys, `secret set`, and `init` billing/API/IAM setup must be blocked unless budget audit returns `risk: configured`.
- `budget enable-api` is the explicit onboarding exception for budget visibility bootstrap.
- Budget guard coverage must expand before additional broad live operations are added.

### Secret Safety

- Secret payloads must never be printed.
- Secret payloads must not be stored in approval args.
- `--value-file` should be preferred over `--value`.
- Secret delete must require dry-run or explicit `--yes`.

### IAM Safety

- `iam audit` must be read-only.
- IAM audit must not grant, revoke, create, delete, or mutate IAM resources.
- IAM write/grant workflows must stay deferred until there is a concrete owner-approved workflow.
- Public principals, primitive roles, high-impact IAM administration roles, and missing IAM policy visibility must be surfaced as structured audit signals.

### Security Audit Safety

- `security audit` must be read-only.
- Security audit must use existing project, IAM, and budget audit surfaces rather than enabling new Google APIs.
- Section errors must be surfaced as partial audit results.
- `risk: high` must tell agents to stop before autonomous live operations.

### Firestore Safety

- `firestore audit` must be read-only.
- Firestore audit must not read documents, write documents, create databases, delete databases, export, import, or mutate indexes.
- Firestore write/provisioning/data workflows must stay deferred until there is a concrete owner-approved workflow.
- Future Firestore live workflows must preserve the cost-bearing invariant.

## Validation State

Completed validation:

- Local typecheck/build/test baseline.
- MCP client smoke.
- Disposable GCP E2E for `init -> link -> deploy -> doctor`.
- Disposable E2E project deletion after validation.
- Real stale project delete/undelete/delete-again smoke.
- Budget API enablement on the live validation project.
- Budget audit returning configured budget state.
- Secret Manager smoke secret creation and deletion under budget guard.
- History cleanup for local machine paths.
- Regression tests for first-run `init` budget guard decisions.
- OperationIntent and shared safety decision regression tests.
- CLI/MCP implementation equivalence tests for adopted command paths.
- Cost-bearing operation invariant tests for operation intents and command mappings.
- Read-only Firestore audit tests and CLI/MCP equivalence tests.

Current open validation need:

- Optional live Firestore audit smoke on a known validation project.
- Downstream MCP gateway design before any service MCP execution is added.

## Success Criteria

Short-term:

- Agents can inspect, initialize, link, dry-run, and deploy supported apps without parsing human text.
- Agents can switch and inspect account context without silently mutating ADC.
- Project cleanup/recovery operations are auditable and approval-gated.
- Live deploys, Secret Manager writes, Firebase helper deploys, and `init` billing/API/IAM setup are guarded by budget visibility.

Medium-term:

- All cost-bearing live Google Cloud operations have a budget guard or explicit onboarding exception.
- Remaining admin surfaces and downstream MCP adapters are added only when justified by actual workflows.
- MCP and CLI remain equivalent surfaces over the same core.

Long-term:

- `omg` becomes the default safety gateway between AI coding agents and Google Cloud/Firebase projects, including selected service MCPs where they are safer or more structured than raw CLI execution.
