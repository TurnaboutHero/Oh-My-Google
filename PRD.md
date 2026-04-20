# Product Requirements Document: oh-my-google

Version: 0.2 current-state refresh
Last updated: 2026-04-20

## Summary

`oh-my-google` (`omg`) is an agent-first safety harness for Google Cloud and Firebase.

The product exists because AI coding agents can write and deploy code, but Google Cloud operations still require project context, account context, billing awareness, API enablement, IAM boundaries, and service-to-service wiring. Those details are split across `gcloud`, Firebase CLI, ADC, Firebase login, and Google Cloud Console.

`omg` gives agents one structured surface:

- CLI: `omg --output json <command>`
- MCP: `omg mcp start`
- Shared core: the same implementation path underneath both surfaces
- Safety layer: Trust Profile, approvals, account checks, and budget guard

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
7. Prefer narrow, composable workflows over a broad cloud automation layer.

## Non-Goals

- Replacing Google Cloud Console.
- Replacing `gcloud` or Firebase CLI for expert users.
- Supporting every GCP service.
- Silent account switching.
- Silent ADC switching.
- Creating or mutating budgets without an explicit future workflow.
- Fully preventing spend through budgets; Google Cloud budgets are alerts, not hard caps.
- Supporting Next.js SSR deployment in the current phase.

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
- `omg.secret.list`
- `omg.secret.set`
- `omg.secret.delete`
- `omg.project.audit`
- `omg.project.cleanup`
- `omg.project.delete`
- `omg.project.undelete`

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
- Live deploys and `secret set` live writes must be blocked unless budget audit returns `risk: configured`.
- Budget guard coverage must expand before additional broad live operations are added.

### Secret Safety

- Secret payloads must never be printed.
- Secret payloads must not be stored in approval args.
- `--value-file` should be preferred over `--value`.
- Secret delete must require dry-run or explicit `--yes`.

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

Current open validation need:

- Budget guard integration on first-run setup/API-enable paths.
- Regression tests for setup/API-enable budget guard decisions.

## Success Criteria

Short-term:

- Agents can inspect, initialize, link, dry-run, and deploy supported apps without parsing human text.
- Agents can switch and inspect account context without silently mutating ADC.
- Project cleanup/recovery operations are auditable and approval-gated.
- Live deploys and Secret Manager writes are guarded by budget visibility.

Medium-term:

- All cost-bearing live Google Cloud operations have a budget guard or explicit onboarding exception.
- Remaining admin surfaces are added only when justified by actual workflows.
- MCP and CLI remain equivalent surfaces over the same core.

Long-term:

- `omg` becomes the default safe adapter between AI coding agents and Google Cloud/Firebase projects.
