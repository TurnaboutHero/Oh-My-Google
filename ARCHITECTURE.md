# Architecture

Last updated: 2026-04-24

This document describes the current `main` implementation. Product intent lives in [PRD.md](./PRD.md), execution sequencing lives in [PLAN.md](./PLAN.md), and checklist status lives in [TODO.md](./TODO.md).

## Architectural Goal

`oh-my-google` is an agent-first harness over Google Cloud and Firebase.

The architecture is intentionally not a general cloud abstraction layer. It is a narrow orchestration layer that gives AI agents:

- one CLI surface
- one MCP surface
- one structured response envelope
- one Trust Profile safety model
- auditable approvals and artifacts
- explicit account, project, and budget checks before risky operations

## High-Level Shape

```text
CLI surface                 MCP surface
    |                           |
    +-----------+---------------+
                |
          shared command core
                |
  +-------------+-------------+----------------+
  |                           |                |
auth/setup/planner       trust/approval       connectors
  |                           |                |
  +-------------+-------------+----------------+
                |
           executor/wiring
                |
        gcloud + firebase CLI
```

Core principles:

- CLI and MCP do not implement separate business logic.
- Planner decides what should happen before executor runs anything.
- Trust checks run before live operations.
- Approval artifacts are one-use and hash-bound.
- Connectors are thin service execution adapters over existing CLIs/APIs.
- Output is always shaped as human text or the shared JSON envelope.
- Future downstream MCP adapters must sit behind the same safety checks; raw privileged service tools should not bypass `omg`.

Target adapter direction:

```text
CLI surface                 MCP surface
    |                           |
    +-----------+---------------+
                |
        shared operation core
                |
        OperationIntent
                |
          safety kernel
                |
  +-------------+-------------+----------------+
  |             |             |                |
gcloud CLI   Firebase CLI   REST/SDK     downstream MCP
```

This target shape is not fully implemented yet. It is the next refactoring direction for making current CLI-backed operations and future MCP-backed operations share one policy path.

## Source Layout

```text
src/
  approval/
    hash.ts
    queue.ts
    types.ts
  auth/
    auth-manager.ts
    gcloud-context.ts
  cli/
    index.ts
    output.ts
    auth.ts
    doctor.ts
    setup.ts
    commands/
      approvals.ts
      approve.ts
      budget.ts
      deploy.ts
      firebase.ts
      iam.ts
      init.ts
      link.ts
      mcp.ts
      project.ts
      reject.ts
      secret.ts
      security.ts
  connectors/
    billing-audit.ts
    cloud-run.ts
    firebase.ts
    iam-audit.ts
    project-audit.ts
    security-audit.ts
    secret-manager.ts
  executor/
    apply.ts
  harness/
    decision-log.ts
    handoff.ts
  mcp/
    server.ts
    tools/
      approvals-list.ts
      approve.ts
      auth.ts
      budget.ts
      deploy.ts
      doctor.ts
      iam.ts
      init.ts
      link.ts
      project.ts
      reject.ts
      secret.ts
      security.ts
      types.ts
  planner/
    detect.ts
    gcp-state.ts
    plan-builder.ts
    schema.ts
  setup/
    apis.ts
    billing.ts
    iam.ts
    project.ts
  safety/
    commands.ts
    decision.ts
    intent.ts
  system/
    cli-runner.ts
  trust/
    check.ts
    levels.ts
    profile.ts
  types/
    connector.ts
    errors.ts
    index.ts
    plan.ts
    trust.ts
  wiring/
    env-inject.ts
    firebase-rewrites.ts
```

## Response Boundary

All agent-facing commands should fit this envelope:

```json
{
  "ok": true,
  "command": "doctor",
  "data": {},
  "next": []
}
```

Failures use stable `error.code` values:

```json
{
  "ok": false,
  "command": "project:delete",
  "error": {
    "code": "APPROVAL_REQUIRED",
    "message": "Project deletion requires manual approval.",
    "recoverable": true
  },
  "next": []
}
```

The response envelope is used by:

- CLI JSON mode
- MCP tool responses
- tests and runbooks
- downstream agent logic

## CLI Surface

The CLI entrypoint is [src/cli/index.ts](./src/cli/index.ts). It registers:

- Core: `init`, `link`, `deploy`, `doctor`, `setup`
- Auth: `auth status/list/create/context/switch/project/refresh/logout`
- Approval: `approve`, `reject`, `approvals list`
- Budget: `budget audit`, `budget enable-api`
- IAM: `iam audit`
- Security: `security audit`
- Secret Manager: `secret list/set/delete`
- Project lifecycle: `project audit/cleanup/delete/undelete`
- Firebase helpers: `firebase init/deploy/emulators`
- MCP server: `mcp start`

CLI responsibilities:

- commander parsing
- interactive prompts
- human/json output formatting
- process exit behavior
- converting command options into shared core input

CLI should not contain cloud-specific business rules that MCP cannot reuse.

## MCP Surface

The MCP server is [src/mcp/server.ts](./src/mcp/server.ts). It exposes 18 tools:

- `omg.auth.context`
- `omg.init`
- `omg.link`
- `omg.deploy`
- `omg.doctor`
- `omg.approve`
- `omg.reject`
- `omg.approvals.list`
- `omg.budget.audit`
- `omg.iam.audit`
- `omg.security.audit`
- `omg.secret.list`
- `omg.secret.set`
- `omg.secret.delete`
- `omg.project.audit`
- `omg.project.cleanup`
- `omg.project.delete`
- `omg.project.undelete`

MCP responsibilities:

- tool schema
- tool input validation
- response serialization as JSON text
- calling the same core functions as CLI commands

MCP is not a wrapper around shelling out to `omg`. It is a second surface over the same TypeScript implementation.

## Auth And Setup

Auth has two layers:

- [src/auth/auth-manager.ts](./src/auth/auth-manager.ts): local `~/.omg/config.json` management and lightweight auth status
- [src/auth/gcloud-context.ts](./src/auth/gcloud-context.ts): gcloud configuration/account/project/ADC discovery and mutation helpers

Important account model:

- active gcloud account and ADC account are separate
- named gcloud configurations are supported
- `omg` does not silently switch ADC
- `--align-adc` is required for non-interactive ADC alignment
- interactive `setup` may ask before running ADC login

Setup flow:

1. Check `gcloud`.
2. Check `firebase`.
3. Optionally activate a named gcloud configuration.
4. Resolve or initiate gcloud login.
5. Detect gcloud/ADC mismatch.
6. Optionally align ADC.
7. Save local project config.
8. Run `doctor`.

## Planner And Plan Contract

Planner files:

- [src/planner/detect.ts](./src/planner/detect.ts)
- [src/planner/gcp-state.ts](./src/planner/gcp-state.ts)
- [src/planner/plan-builder.ts](./src/planner/plan-builder.ts)
- [src/planner/schema.ts](./src/planner/schema.ts)

The plan is stored at:

- `.omg/project.yaml`

The plan is the contract between detection and execution.

Core fields:

- `version`
- `detected`
- `targets`
- `wiring`
- `environment`
- `deploymentOrder`
- `checks`

Supported detection classes include:

- `static`
- `api-only`
- `spa-plus-api`
- `functions`
- `unknown`

For `spa-plus-api`, the plan uses backend-first deployment and then wires Cloud Run into Firebase Hosting rewrites.

## Executor And Wiring

Executor file:

- [src/executor/apply.ts](./src/executor/apply.ts)

Wiring files:

- [src/wiring/firebase-rewrites.ts](./src/wiring/firebase-rewrites.ts)
- [src/wiring/env-inject.ts](./src/wiring/env-inject.ts)

Executor responsibilities:

- load deployment order from the plan
- run connector actions sequentially
- collect deployment URLs
- update Firebase rewrites when Cloud Run backs a Firebase frontend
- resolve `${SECRET:KEY}` values for backend env injection
- update harness artifacts with outcomes

The executor should remain simple. Complex choices belong in planner or trust checks.

## Connectors

Connector interface lives in [src/types/connector.ts](./src/types/connector.ts).

Implemented connectors:

- [src/connectors/cloud-run.ts](./src/connectors/cloud-run.ts)
- [src/connectors/firebase.ts](./src/connectors/firebase.ts)
- [src/connectors/iam-audit.ts](./src/connectors/iam-audit.ts)
- [src/connectors/secret-manager.ts](./src/connectors/secret-manager.ts)
- [src/connectors/project-audit.ts](./src/connectors/project-audit.ts)
- [src/connectors/billing-audit.ts](./src/connectors/billing-audit.ts)
- [src/connectors/security-audit.ts](./src/connectors/security-audit.ts)

Connector responsibilities:

- issue narrow service-specific commands
- normalize outputs into structured payloads
- avoid broad orchestration decisions
- avoid printing secrets

Most connectors intentionally rely on `gcloud` or Firebase CLI rather than duplicating large portions of cloud client behavior.

Current backend boundary:

- `omg` is currently a CLI plus MCP server over shared TypeScript command functions.
- It is not yet an MCP client or downstream MCP gateway.
- Existing service execution is mostly done through `gcloud`, Firebase CLI, and selected Google client libraries.
- A future downstream MCP backend must be registered with capability metadata and evaluated through the safety kernel before execution.
- Unknown downstream MCP tools should be denied by default.

## Trust Model

Trust files:

- [src/trust/levels.ts](./src/trust/levels.ts)
- [src/trust/check.ts](./src/trust/check.ts)
- [src/trust/profile.ts](./src/trust/profile.ts)

Trust Profile path:

- `.omg/trust.yaml`

Trust levels:

| Level | Meaning | Examples |
|---|---|---|
| L0 | read-only | `doctor.run`, `project.audit`, `billing.audit`, `iam.audit`, `security.audit`, `secret.list` |
| L1 | normal setup/deploy changes | `deploy.cloud-run`, `deploy.firebase-hosting`, `apis.enable` |
| L2 | cost/permission/secret write impact | `billing.link`, `iam.role.grant`, `secret.set` |
| L3 | destructive/lifecycle actions | `gcp.project.delete`, `gcp.project.undelete`, data delete |

Trust decisions:

- `auto`: allowed
- `require_confirm`: human mode may confirm, JSON mode needs `--yes`
- `require_approval`: creates or consumes approval
- `deny`: blocked

The `deny` action-pattern list in `.omg/trust.yaml` runs before trust level policy and before approvals.

## Approval Model

Approval files live under:

- `.omg/approvals/`

Approval properties:

- action
- project ID
- args hash
- created/expiry timestamps
- status
- approver/rejecter data
- requested account for account-sensitive lifecycle operations
- consumed marker after use

Approval safety:

- approvals are one-use
- args hash must match
- expired approvals fail
- unapproved approvals fail
- consumed approvals fail
- project delete/undelete approvals fail with `ACCOUNT_MISMATCH` if the active gcloud account differs from the recorded account

Structured reason codes include:

- `DENIED`
- `REQUIRES_CONFIRM`
- `APPROVAL_REQUIRED`
- `APPROVAL_NOT_FOUND`
- `APPROVAL_EXPIRED`
- `APPROVAL_NOT_APPROVED`
- `APPROVAL_MISMATCH`
- `ACCOUNT_MISMATCH`
- `APPROVAL_CONSUMED`

## Budget Guard

Budget connector:

- [src/connectors/billing-audit.ts](./src/connectors/billing-audit.ts)

Budget command:

- [src/cli/commands/budget.ts](./src/cli/commands/budget.ts)

Current behavior:

- `budget audit` checks billing state and visible budgets.
- `budget enable-api` explicitly enables `billingbudgets.googleapis.com`.
- Budget audit is read-only.
- Budget creation is not implemented.
- Live `secret set` is blocked unless budget audit returns `risk: configured`.
- Live `omg deploy` is blocked unless budget audit returns `risk: configured`.
- Live `omg firebase deploy --execute` is blocked unless budget audit returns `risk: configured`.
- `omg init` checks the selected billing account before billing link, default API enablement, and IAM setup.

Risk states:

- `configured`
- `missing_budget`
- `billing_disabled`
- `review`

Known gap:

- Budget guard is now enforced for live deploy, Firebase helper deploy, Secret Manager writes, and `omg init` before billing link/default API enable/IAM setup. Coverage still needs review as new live Google Cloud operations are added.

## IAM Audit

IAM audit connector:

- [src/connectors/iam-audit.ts](./src/connectors/iam-audit.ts)

IAM command:

- [src/cli/commands/iam.ts](./src/cli/commands/iam.ts)

Current behavior:

- `iam audit` is read-only.
- MCP `omg.iam.audit` calls the same command core.
- The audit reads visible IAM policy bindings and service account metadata.
- It classifies public principals, primitive project roles, high-impact IAM administration roles, and missing IAM policy visibility.
- IAM write/grant workflows are intentionally not implemented.

Risk states:

- `low`
- `review`
- `high`

## Security Audit

Security audit connector:

- [src/connectors/security-audit.ts](./src/connectors/security-audit.ts)

Security command:

- [src/cli/commands/security.ts](./src/cli/commands/security.ts)

Current behavior:

- `security audit` is read-only.
- MCP `omg.security.audit` calls the same command core.
- The audit rolls up project lifecycle/cleanup risk, IAM posture, and budget guard state.
- It does not call Security Command Center and does not enable new Google APIs.
- Section errors are surfaced as partial audit results.

Risk states:

- `low`
- `review`
- `high`

## Project Lifecycle Safety

Project lifecycle command:

- [src/cli/commands/project.ts](./src/cli/commands/project.ts)

Project audit connector:

- [src/connectors/project-audit.ts](./src/connectors/project-audit.ts)

Safety behavior:

- `project audit` is read-only.
- `project cleanup --dry-run` is plan-only.
- `project delete` is L3 approval-gated.
- `project undelete` is L3 approval-gated.
- protected projects are blocked before approval.
- billing-enabled projects are blocked before deletion approval.
- callers without owner role are blocked before deletion approval.
- undelete only runs for `DELETE_REQUESTED`.
- approval consumption is bound to the active gcloud account.

## Harness Artifacts

Harness files:

- [src/harness/decision-log.ts](./src/harness/decision-log.ts)
- [src/harness/handoff.ts](./src/harness/handoff.ts)

Runtime artifacts:

- `.omg/decisions.log.jsonl`
- `.omg/handoff.md`

Decision log:

- append-only JSONL
- records major `init`, `link`, `deploy`, `approve`, `reject` events
- redacts secret-like values before writing

Handoff:

- latest run artifact
- summarizes deploy result, URLs, pending approvals, risks, rollback state, and next steps

## Current Boundaries

Implemented and verified:

- Core deploy harness
- CLI + MCP dual surface
- auth context and setup helpers
- initial OperationIntent classification for existing trust action IDs
- command-level intent mapping for CLI/MCP surface normalization
- shared safety decision wrapper over adapter capability, Trust Profile, approvals, and supplied or provider-fetched budget guard evidence
- command-level trust checks in deploy, secret, and project lifecycle routed through the shared safety decision wrapper
- CLI/MCP implementation equivalence tests around concrete command implementations after safety-wrapper adoption
- adapter capability manifest for current CLI/client-library backends and deny-by-default downstream MCP
- approval workflow
- Secret Manager admin surface
- read-only IAM audit surface
- read-only security posture audit surface
- budget audit and budget guard for live deploy, Firebase helper deploy, Secret Manager writes, and `omg init` billing/API/IAM setup
- project cleanup/delete/undelete safety surface

Not implemented:

- downstream MCP client/gateway support
- budget creation/mutation
- IAM write/grant workflows
- `notify` admin surface
- advanced rollback orchestration
- Next.js SSR deployment

## Documentation Rule

This document should reflect current implementation boundaries. When implementation changes module boundaries or safety behavior, update this file with the code change.
