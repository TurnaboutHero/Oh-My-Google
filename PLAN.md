# Implementation Plan

Last updated: 2026-04-20

This plan explains the implementation direction for `oh-my-google`. Current task state is tracked in [TODO.md](./TODO.md). Product rationale is tracked in [PRD.md](./PRD.md).

## Planning Rules

- Keep the agent surface narrow and verifiable.
- Prefer existing `gcloud` and Firebase CLI behavior over reimplementing cloud clients.
- Keep CLI and MCP on the same shared core.
- Add live operations only with trust checks, structured errors, tests, and docs.
- For cost-bearing operations, add dry-run first and budget guard before broad live usage.
- For destructive operations, require explicit approval and record enough context to detect mismatch.

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

## Active Phase

### Phase 3D: Budget Guard Expansion

Goal: connect cost/free-tier guardrails to the rest of live Google Cloud execution.

Recommended order:

Progress:

- Live `omg deploy` is budget-guarded.
- Live `omg firebase deploy --execute` is budget-guarded.
- Live `omg secret set` is budget-guarded.

Recommended next order:

1. Classify setup/API-enable operations that need budget guard and which need onboarding exceptions.
2. Add budget guard to setup/API-enable paths where it does not create a first-run deadlock.
3. Add tests for:
   - configured budget allows live execution
   - `missing_budget` blocks live execution
   - `review` blocks live execution
   - dry-run bypasses live budget guard
   - onboarding exception behavior is explicit
4. Update README, TODO, and runbooks after the behavior is implemented.

Important design point:

`omg init` may be the first command that enables the Budget API or links billing. It cannot blindly require a budget that is not inspectable yet. The implementation needs a clear first-run path, not a circular dependency.

## Candidate Future Phases

### Phase 3E: Remaining Admin Surface Decisions

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
