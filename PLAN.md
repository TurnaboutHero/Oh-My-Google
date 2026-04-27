# Implementation Plan

Last updated: 2026-04-24

This plan explains the implementation direction for `oh-my-google`. Current task state is tracked in [TODO.md](./TODO.md). Product rationale is tracked in [PRD.md](./PRD.md).

## Planning Rules

- Keep the agent surface narrow and verifiable.
- Prefer existing `gcloud` and Firebase CLI behavior over reimplementing cloud clients until another backend is clearly safer or more structured.
- Keep CLI and MCP on the same shared core.
- Add live operations only with trust checks, structured errors, tests, and docs.
- For cost-bearing operations, add dry-run first and budget guard before broad live usage.
- For destructive operations, require explicit approval and record enough context to detect mismatch.
- Do not expose raw downstream MCP tools directly to agents; route them through classified intents and the same safety kernel.

## Completed Phases

### Phase 1: Core CLI Harness

Goal: stabilize `init -> link -> deploy -> doctor`.

Completed:

- `omg init` creates/uses project context, links billing, enables required APIs, applies basic IAM, and writes Trust Profile.
- `omg link` detects deployable repo shape and writes `.omg/project.yaml`.
- `omg deploy` loads the plan, applies Trust Profile checks, supports dry-run, and deploys supported Cloud Run/Firebase Hosting flows.
- `omg doctor` reports local and Google/Firebase readiness.
- CLI output supports human and JSON modes.
- Core tests cover trust, planner, wiring, connectors, and CLI hardening.

### Phase 1.5: Approval And Trust Hardening

Goal: make high-risk execution auditable and non-silent.

Completed:

- Approval queue under `.omg/approvals/`.
- Approval TTL.
- Args hash validation.
- Consumed approval markers.
- Structured approval errors.
- Trust deny policy.
- Decision log under `.omg/decisions.log.jsonl`.
- Handoff artifact under `.omg/handoff.md`.

### Phase 2: MCP Surface

Goal: expose the same behavior through MCP for agent-native tool calls.

Completed:

- stdio MCP server.
- Shared response envelope.
- MCP tools for auth context, init, link, deploy, doctor, approvals, budget audit, secret admin, project lifecycle, IAM audit, security audit, Firestore audit, Cloud Storage audit, Cloud SQL audit, and downstream MCP gateway audit/call.

### Phase 2.5: Real-World Validation

Goal: verify that the harness works outside mocks.

Completed:

- MCP client smoke.
- Disposable GCP E2E run.
- Cloud Run + Firebase Hosting deployment.
- Health checks on backend and frontend.
- Disposable test project deletion after validation.
- Runbooks for E2E, MCP smoke, and validation findings.

### Phase 3A: Secret Manager Admin Surface

Goal: add the first narrow admin surface without leaking secret values.

Completed:

- `omg secret list`
- `omg secret set`
- `omg secret delete`
- Secret payload redaction.
- Secret write Trust Profile mapping.
- MCP tools for list/set/delete.
- Live smoke with secret creation, listing, deletion, and final empty list.

### Phase 3B: Project Cleanup And Recovery

Goal: inspect and clean stale projects safely.

Completed:

- `omg project audit`
- `omg project cleanup --dry-run`
- `omg project delete`
- `omg project undelete`
- Approval-gated delete and undelete.
- Protected project blocking.
- Billing-enabled project blocking.
- Non-owner blocking.
- `DELETE_REQUESTED` requirement for undelete.
- Active account capture in approval records.
- `ACCOUNT_MISMATCH` blocking.
- `--expect-account` guard.
- Real stale project delete/undelete/delete-again smoke.

### Phase 3C: Budget/Billing Guard

Goal: start enforcing cost visibility before live writes.

Completed:

- `omg budget audit`
- `omg budget enable-api --dry-run`
- `omg budget enable-api --yes`
- MCP `omg.budget.audit`
- Budget audit risk states: `configured`, `missing_budget`, `billing_disabled`, `review`
- Live `secret set` blocked unless budget audit returns `configured`
- Live `omg deploy` blocked unless budget audit returns `configured`
- Live `omg firebase deploy --execute` blocked unless budget audit returns `configured`
- Existing KRW budget visibility confirmed on the live validation project
- Budget-guarded Secret Manager smoke created and deleted a test secret

### Phase 3D: Budget Guard Expansion

Goal: connect cost/free-tier guardrails to the rest of live Google Cloud execution.

Completed/ongoing:

- Live `omg deploy` is budget-guarded.
- Live `omg firebase deploy --execute` is budget-guarded.
- Live `omg secret set` is budget-guarded.
- `omg init` audits the selected billing account before billing link, default API enablement, and IAM setup.
- `budget enable-api` remains an explicit dry-run/`--yes` bootstrap exception for budget visibility.

Decided:

- `omg budget create` is deferred. Budget creation stays a documented console/manual step; `omg` verifies visibility with `budget audit` instead of creating budgets automatically.

Completed:

- All currently known cost-bearing live operations require budget guard.
- Regression tests fail if a known operation intent or command mapping becomes cost-bearing without `requiresBudget`.

Important design point:

`omg init` may be the first command that links billing. It now audits the selected billing account before linking so a missing or inaccessible budget blocks cost-expanding setup. `budget enable-api` remains the explicit bootstrap path when budget visibility itself is unavailable.

### Phase 3E: Safety Kernel And Adapter Foundation

Goal: make the existing CLI-backed operations and future MCP-backed operations pass through one explicit operation model before execution.

Why now:

- The current product already has two user surfaces: CLI and MCP.
- The current execution backends are mostly `gcloud` and Firebase CLI connectors.
- Google/Firebase service MCPs can be useful, but connecting them directly to the agent would bypass `omg` safety checks.
- A common safety kernel should exist before adding downstream MCP execution.

Recommended order:

1. Define `OperationIntent` for existing operations.
   - service: GCP, Firebase, Secret Manager, Billing, Project Lifecycle
   - action: read, plan, write, deploy, secret write, IAM, lifecycle, destructive
   - project/resource scope
   - cost-bearing/destructive/secret-touching flags
   - dry-run and post-verify capability
2. Build a single safety decision function.
   - input: `OperationIntent`, auth/project context, Trust Profile, approval state, budget state
   - output: allow, require confirm, require approval, deny, blocked with structured code
3. Move existing ad hoc trust/budget checks toward the safety decision function without changing behavior.
4. Add an adapter capability manifest for current backends.
   - `gcloud-cli`
   - `firebase-cli`
   - existing Google client library connectors
5. Add regression tests proving CLI and MCP paths receive the same safety decisions.
6. Only after that, design downstream MCP gateway support.
   - registered downstream MCP servers
   - tool discovery
   - deny-by-default for unknown tools
   - read-only tools first
   - no generic privileged `adapter.call` until capability classification is enforced

Progress:

- Initial `OperationIntent` model exists in `src/safety/intent.ts`.
- Existing trust action IDs are classified by service, action shape, trust level, adapter, budget requirement, secret impact, destructive impact, dry-run support, and post-verify support.
- Initial adapter capability manifest covers `gcloud-cli`, `firebase-cli`, Google client connectors, deny-by-default downstream MCP, and unknown adapters.
- Command-level intent mapping exists in `src/safety/commands.ts`, including multi-action flows such as `init`, `project:delete`, and `secret:delete`.
- Shared safety decision wrapper exists in `src/safety/decision.ts`; it combines adapter capability, Trust Profile, approvals, and supplied or provider-fetched budget guard evidence.
- Regression tests cover operation classification, command surface normalization for CLI/MCP, adapter capability, and shared safety decision outcomes.
- Existing command-level trust checks in `deploy`, `secret`, and project lifecycle now route through the shared safety decision wrapper.
- CLI/MCP implementation equivalence tests cover the adopted command paths for deploy safety blocks, Secret Manager set/list/delete responses, and project delete approval requirements.

Remaining:

- Phase 3E safety-kernel foundation work is complete.
- Design actual downstream MCP client/gateway mechanics only after the next product decision explicitly prioritizes it.

### Phase 3F: Remaining Admin Surface Decisions

Goal: decide whether additional admin surfaces are needed from actual workflows, starting with read-only inspection before writes.

Progress:

- Decided that IAM starts as read-only inspection, not role mutation.
- Added `omg iam audit --project <id>`.
- Added MCP `omg.iam.audit`.
- Added IAM operation intent mapping as L0 read-only.
- Added connector, command, MCP, safety mapping, and CLI/MCP equivalence tests.
- Added [docs/runbooks/iam-audit.md](./docs/runbooks/iam-audit.md).
- Decided that `notify` is deferred until a concrete external notification workflow exists.
- Decided that `security` starts as a read-only posture rollup.
- Added `omg security audit --project <id>`.
- Added MCP `omg.security.audit`.
- Added security operation intent mapping as L0 read-only.
- Added connector, command, MCP, safety mapping, and CLI/MCP equivalence tests.
- Added [docs/runbooks/security-audit.md](./docs/runbooks/security-audit.md).

Remaining:

- Keep IAM write/grant workflows deferred unless a concrete owner-approved workflow requires them.
- Keep `notify` deferred unless a concrete external notification workflow requires it.
- Preserve the cost-bearing invariant before adding any new live Google Cloud operation.

## Active Phase

### Phase 5A/5B: Operational Safety Closure - Budget Policy And Notifications

Goal: make the budget guard more concrete without unsafe live mutation.

Current safe-scope progress:

- Added `omg budget ensure --project <id> --amount <n> --currency <code> --dry-run`.
- Added budget policy normalization for amount, currency, thresholds, and display name.
- Added dry-run comparison against visible budgets with actions: `create`, `update`, `none`, and `blocked`.
- Added `budget.ensure` operation intent as L2 billing governance with dry-run and post-verification semantics.
- Kept live budget create/update blocked with `BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED`, even if `--yes` is supplied.
- Added a live executor design/runbook and pure Budget API mutation contract tests without opening cloud writes.
- Added `omg budget notifications audit --project <id>`.
- Added `omg budget notifications ensure --project <id> --topic <topic> --dry-run`.
- Added budget notification posture reporting with `configured`, `partial`, `none`, and `blocked`.
- Added dry-run planning for budget `notificationsRule.pubsubTopic` and schema version `1.0`.
- Added read-only Pub/Sub topic existence and topic IAM audit for notification planning.
- Added blocker reporting when the target topic is missing, topic IAM is inaccessible, or no `roles/pubsub.publisher` binding is visible.
- Kept live budget notification mutation blocked with `BUDGET_NOTIFICATIONS_LIVE_NOT_IMPLEMENTED`, even if `--yes` is supplied.
- Added [docs/runbooks/budget-notifications.md](./docs/runbooks/budget-notifications.md).

Remaining:

- Implement Budget API create/update executor only after the owner-approved live workflow is designed.
- Post-verify live ensure by re-running budget audit and matching the expected policy.
- Add MCP coverage only after the CLI contract and live executor stabilize.
- Decide whether to support automatic Pub/Sub topic creation and IAM grant, or keep those as manual console steps.
- Add local cost lock after notification posture is ready to feed it.
- Add agent IAM planning/bootstrap after budget controls are stable.

### Phase 4: Resource Add Workflows

Goal: add resource surfaces only when they remain understandable, reversible, and safe for agents.

Completed:

- Started Phase 4 with read-only Firestore inspection.
- Added `omg firestore audit --project <id>`.
- Added MCP `omg.firestore.audit`.
- Added Firestore operation intent mapping as L0 read-only.
- Added connector, command, MCP, safety mapping, and CLI/MCP equivalence tests.
- Added [docs/runbooks/firestore-audit.md](./docs/runbooks/firestore-audit.md).
- Added `omg storage audit --project <id>`.
- Added MCP `omg.storage.audit`.
- Added Cloud Storage operation intent mapping as L0 read-only.
- Added connector, command, MCP, safety mapping, and CLI/MCP equivalence tests.
- Added [docs/runbooks/storage-audit.md](./docs/runbooks/storage-audit.md).
- Added `omg sql audit --project <id>`.
- Added MCP `omg.sql.audit`.
- Added Cloud SQL operation intent mapping as L0 read-only.
- Added connector, command, MCP, safety mapping, and CLI/MCP equivalence tests.
- Added [docs/runbooks/sql-audit.md](./docs/runbooks/sql-audit.md).
- Decided stronger Secret Manager integration is already covered by the current list/set/delete surface plus budget guard; version/access-policy audit remains deferred until a concrete workflow exists.

Remaining:

- Keep Firestore create/delete/export/import/data mutation workflows deferred unless a concrete owner-approved workflow requires them.
- Keep Cloud Storage bucket/object/IAM/lifecycle write workflows deferred unless a concrete owner-approved workflow requires them.
- Keep Cloud SQL instance/backup/export/import/lifecycle write workflows deferred unless a concrete owner-approved workflow requires them.
- Run optional live read-only resource audit smoke only with explicit project/account approval.

## Candidate Future Phases

### Phase 3F Follow-Ups: Remaining Admin Surface Decisions

Do not implement these just because they were listed earlier. Decide from actual workflows.

- `iam` writes: useful only if agents need controlled IAM grants beyond current init.
- `notify`: useful only if approval/budget events need external notification.
- `security` extensions: useful only if a future workflow needs service-specific scan sources beyond the current read-only posture rollup.

Each surface needs:

- trust level mapping
- JSON and human command contracts
- MCP tool contract
- dry-run or read-only-first path
- tests
- runbook

### Phase 4 Follow-Ups: Resource Add Workflows

Candidate commands:

- Firestore write/provisioning workflows
- Cloud Storage bucket/object/IAM/lifecycle workflows
- Cloud SQL instance/backup/export/import/lifecycle workflows
- stronger Secret Manager version/access-policy audit, if a concrete workflow needs it

Principle: add resources only when deployment flow remains understandable and reversible.

Before any Phase 4 resource workflow is implemented, classify it as an `OperationIntent`. If it is cost-bearing, it must require budget guard unless an explicit bootstrap exception is documented and tested.

### Phase 4B: Downstream MCP Gateway

Goal: let `omg` act as a safety gateway for external MCP servers without exposing raw privileged tools.

Completed:

- `.omg/mcp.yaml` for downstream MCP registration.
- downstream tool discovery with no execution by default.
- capability manifests for approved tools.
- read-only proxy tools first.
- explicit deny for unknown or unclassified tools.
- audit logging for every downstream tool call.
- post-call verification when a tool claims to create, update, delete, or restore a resource.
- CLI commands: `omg mcp gateway audit`, `omg mcp gateway audit --discover`, and `omg mcp gateway call`.
- MCP tools: `omg.mcp.gateway.audit` and `omg.mcp.gateway.call`.
- Adapter split: raw `downstream-mcp` stays deny-by-default; `downstream-mcp-readonly` is the only executable downstream adapter.
- Non-read downstream tools are blocked until a concrete verifier is designed.
- Automated coverage now includes a real MCP SDK stdio fixture for discovery/call/denial behavior.
- Automated coverage now locks the exact 23-tool registry and verifies `mcp start` stdio discovery through a real MCP SDK client.
- Added [docs/runbooks/downstream-mcp-gateway.md](./docs/runbooks/downstream-mcp-gateway.md).
- Added [docs/runbooks/phase-4-4b-release-notes.md](./docs/runbooks/phase-4-4b-release-notes.md).

Principle: `omg` may become an MCP server and MCP client, but downstream MCPs stay behind the same safety kernel. Raw Google/Firebase service MCPs should not be exposed to agents for privileged work when `omg` is meant to enforce policy.

Remaining:

- Run optional external live gateway smoke only against a known benign MCP server.
- Do not add downstream write/lifecycle proxying until the workflow includes dry-run or post-verification semantics.

### Later Candidate Phase: AI And Analytics Integrations

Candidate integrations:

- Gemini / Vertex AI
- embeddings / RAG
- Analytics
- BigQuery

Principle: do not add AI/analytics surfaces until the core deployment and cost guard model is stable.

## Verification Policy

For docs-only changes:

- Check links and status consistency.
- Run lightweight repository status checks.

For code changes:

- `npm run typecheck`
- `npm run build`
- `npx vitest run`
- targeted live smoke only with explicit approval when Google Cloud state is touched

For live Google Cloud operations:

- dry-run first when available
- inspect account context
- inspect project
- inspect budget guard where applicable
- execute only with explicit approval/flag
- clean up any temporary resource created for testing
