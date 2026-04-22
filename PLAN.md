# Implementation Plan

Last updated: 2026-04-22

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
- MCP tools for auth context, init, link, deploy, doctor, approvals, budget audit, secret admin, and project lifecycle.

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

Remaining decisions:

- Decide whether `omg budget create` is needed, or leave budget creation as a documented manual console step.
- Continue adding budget/free-tier guardrails to any new cost-bearing live operation.

Important design point:

`omg init` may be the first command that links billing. It now audits the selected billing account before linking so a missing or inaccessible budget blocks cost-expanding setup. `budget enable-api` remains the explicit bootstrap path when budget visibility itself is unavailable.

## Active Phase

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

Remaining:

- add CLI/MCP equivalence tests around command implementations after adoption
- design actual downstream MCP client/gateway mechanics after the safety wrapper is used by current commands

## Candidate Future Phases

### Phase 3F: Remaining Admin Surface Decisions

Do not implement these just because they were listed earlier. Decide from actual workflows.

- `iam`: useful if agents need controlled IAM grants beyond current init.
- `notify`: useful if approval/budget events need external notification.
- `security`: useful if audit posture needs a read-only security scan.

Each surface needs:

- trust level mapping
- JSON and human command contracts
- MCP tool contract
- dry-run or read-only-first path
- tests
- runbook

### Phase 4: Resource Add Workflows

Candidate commands:

- Firestore
- Cloud Storage
- Cloud SQL
- stronger Secret Manager integration

Principle: add resources only when deployment flow remains understandable and reversible.

### Phase 4B: Downstream MCP Gateway

Candidate scope:

- `.omg/mcp.yaml` for downstream MCP registration.
- downstream tool discovery with no execution by default.
- capability manifests for approved tools.
- read-only proxy tools first.
- explicit deny for unknown or unclassified tools.
- audit logging for every downstream tool call.
- post-call verification when a tool claims to create, update, delete, or restore a resource.

Principle: `omg` may become an MCP server and MCP client, but downstream MCPs stay behind the same safety kernel. Raw Google/Firebase service MCPs should not be exposed to agents for privileged work when `omg` is meant to enforce policy.

### Phase 5: AI And Analytics Integrations

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
