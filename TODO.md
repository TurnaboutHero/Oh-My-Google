# TODO

Status snapshot: 2026-04-24

This file tracks current implementation state. Product rationale lives in [PRD.md](./PRD.md). Sequencing and phase intent live in [PLAN.md](./PLAN.md).

## Now

### Phase 3D: Budget Guard Expansion

- [x] Define the `budget` command scope and trust level.
- [x] Implement read-only billing/budget audit.
- [x] Implement explicit Budget API enablement with `--dry-run` and `--yes`.
- [x] Add MCP coverage for `omg.budget.audit`.
- [x] Add budget guard before live `omg secret set`.
- [x] Add budget guard before live `omg deploy`.
- [x] Add budget guard before live `omg firebase deploy --execute`.
- [x] Add budget guard before `omg init` performs billing link, default API enablement, and IAM setup.
- [x] Preserve onboarding flow: `budget enable-api` remains an explicit dry-run/`--yes` bootstrap path for budget visibility.
- [x] Document budget guard live smoke in [docs/runbooks/budget-billing-guard.md](./docs/runbooks/budget-billing-guard.md).
- [x] Decide that `omg budget create` is deferred; budget creation remains a documented console/manual step.
- [ ] Apply cost/free-tier guardrails before all cost-bearing live Google Cloud operations.

### Phase 3E: Safety Kernel And Adapter Foundation

- [x] Add initial `OperationIntent` model for existing trust action IDs.
- [x] Add tested operation classification for current trust actions by risk level, service, adapter, cost impact, destructive impact, secret impact, dry-run support, and post-verify support.
- [x] Extend command-level intent mapping for command flows that currently span multiple trust actions, such as `init`, `secret delete`, and project lifecycle verification.
- [x] Extract a shared safety decision path that combines Trust Profile, approvals, adapter capability, and budget guard evidence.
- [x] Add an initial capability manifest for existing execution backends: `gcloud-cli`, `firebase-cli`, current Google client connectors, and deny-by-default downstream MCP.
- [x] Add regression tests proving CLI and MCP calls normalize to equivalent command intent plans.
- [x] Document the rule that downstream Google/Firebase MCPs must not be exposed raw for privileged operations.
- [x] Design downstream MCP discovery as read-only/deny-by-default before any execution proxy is added.
- [x] Adopt the shared safety decision wrapper for existing command-level trust checks without changing behavior.
- [x] Add CLI/MCP equivalence tests around the command implementations after adoption.

### Phase 3F: Remaining Admin Surfaces

- [x] Decide that `iam` starts as a read-only `omg iam audit` surface before Phase 4.
- [x] Implement `omg iam audit --project <id>`.
- [x] Add MCP coverage for `omg.iam.audit`.
- [x] Add IAM audit command, connector, safety-intent, and CLI/MCP equivalence tests.
- [x] Add IAM audit runbook.
- [ ] Keep IAM write/grant workflows deferred until a concrete owner-approved workflow exists.
- [x] Decide that `notify` is deferred until a concrete external notification workflow exists.
- [x] Decide that `security` starts as a read-only posture rollup before Phase 4.
- [x] Implement `omg security audit --project <id>`.
- [x] Add MCP coverage for `omg.security.audit`.
- [x] Add security audit command, connector, safety-intent, and CLI/MCP equivalence tests.
- [x] Add security audit runbook.

### Documentation

- [x] Rewrite the Korean README around purpose, context, status, and safety model.
- [x] Add an English README.
- [x] Refresh PRD/PLAN/TODO to reflect current implementation state.
- [x] Refresh `ARCHITECTURE.md` for current CLI/MCP/auth/budget/secret/project lifecycle boundaries.
- [x] Refresh `CLAUDE.md` project instructions for the current product surface.
- [x] Refresh project-local `AGENTS.md` for current agent usage rules and MCP tool surface.
- [x] Refresh stale validation/runbook wording after Phase 2.5.
- [x] Add history rewrite and conflict safety runbook after sanitized-history reintroduction incident.

## Recommended Next Work

1. Keep IAM write/grant workflows deferred unless a concrete owner-approved workflow requires them.
2. Keep `notify` deferred unless a concrete external notification workflow requires it.
3. Continue applying cost/free-tier guardrails before any new cost-bearing live Google Cloud operation.
4. Only then consider downstream MCP execution or additional admin surfaces.
5. Re-run the local verification suite before each push.

## Completed

### Auth And Setup

- [x] `omg setup` checks local Google tooling, can activate a named gcloud configuration, can run login, can align ADC, saves local project config, and runs `doctor`.
- [x] `omg auth context` reports active gcloud configuration, active gcloud account, active project, ADC account, and mismatch state.
- [x] `omg auth list` reports credentialed gcloud accounts and named configurations.
- [x] `omg auth create <configuration>` can create a gcloud configuration and optionally run browser login.
- [x] `omg auth project` can set the active project and prompts interactively when multiple visible projects exist.
- [x] `omg auth switch <configuration>` activates a named configuration.
- [x] ADC alignment happens only when `--align-adc` is provided or an interactive setup prompt is approved.
- [x] `doctor` reports gcloud/ADC mismatch instead of silently changing credentials.

### Phase 3 Secret Admin Surface

- [x] `omg secret list` metadata-only command.
- [x] `omg secret set <name>` dry-run and live write command.
- [x] `omg secret delete <name>` dry-run and explicit delete command.
- [x] Secret write trust mapping (`secret.set` as L2).
- [x] Secret value redaction in outputs and approval args.
- [x] Secret admin runbook with cost boundary.
- [x] MCP tool coverage for secret list/set/delete.
- [x] Live Secret Manager smoke on the configured validation project: smoke secret was created, listed, deleted, and final list was empty.

### Phase 3 Project Cleanup And Lifecycle Surface

- [x] `omg project audit --project <id>` read-only risk classification.
- [x] `omg project cleanup --project <id> --dry-run` plan-only command.
- [x] `omg project delete --project <id>` approval-gated L3 workflow.
- [x] `omg project undelete --project <id>` approval-gated L3 workflow.
- [x] MCP tool coverage for project audit/cleanup/delete/undelete.
- [x] Protected/do-not-touch projects are blocked before approval.
- [x] Billing-enabled projects are blocked before deletion approval.
- [x] Non-owner callers are blocked before deletion approval.
- [x] Delete/undelete approvals record the active gcloud account and fail with `ACCOUNT_MISMATCH` if consumed by another account.
- [x] `--expect-account <email>` guard added for project delete/undelete.
- [x] Real stale project delete, undelete, and delete-again smoke completed.
- [x] Confirmed protected/current projects were not touched during cleanup validation.

### Phase 2.5 Harness Foundation

- [x] `.omg/decisions.log.jsonl` append-only decision log schema and writer.
- [x] Decision event logging for `init`, `link`, `deploy`, `approve`, and `reject`.
- [x] Decision log redaction rules.
- [x] `.omg/handoff.md` generator.
- [x] Handoff update after deploy success/failure.
- [x] `.omg/trust.yaml` deny policy schema.
- [x] Deny policy applied before trust level and approval checks.
- [x] Deny policy tests.
- [x] MCP client smoke runbook.
- [x] GCP E2E runbook.
- [x] Phase 2.5 terminology alignment across README/ARCHITECTURE.
- [x] MCP client smoke in actual Claude Code/Codex configuration.
- [x] Actual E2E run against a disposable GCP project.

### Phase 2 MCP Surface

- [x] stdio MCP server.
- [x] Shared response envelope between CLI and MCP.
- [x] `omg.auth.context`.
- [x] `omg.doctor`.
- [x] `omg.approvals.list`.
- [x] `omg.approve`.
- [x] `omg.reject`.
- [x] `omg.deploy`.
- [x] `omg.init`.
- [x] `omg.link`.
- [x] `omg.budget.audit`.
- [x] `omg.secret.list`.
- [x] `omg.secret.set`.
- [x] `omg.secret.delete`.
- [x] `omg.project.audit`.
- [x] `omg.project.cleanup`.
- [x] `omg.project.delete`.
- [x] `omg.project.undelete`.
- [x] `omg.iam.audit`.
- [x] `omg.security.audit`.

### Phase 1.1 Hardening

- [x] `init` tests.
- [x] `deploy` trust gate tests.
- [x] Connector unit tests.
- [x] Minimal approval workflow decision and implementation.
- [x] `doctor` separates auth state from ADC file existence.
- [x] `doctor` checks Firebase project link state.
- [x] Post-deploy health verification.
- [x] Rollback scope and failure strategy.
- [x] Human output formatting in `src/cli/output.ts`.
- [x] Command help examples.
- [x] Removal of stale keywords/descriptions.

### Link Quality

- [x] Warning for detected Next.js SSR repositories.
- [x] More granular repo detection cases.
- [x] Expanded `link` tests.

### Tooling

- [x] Windows line-ending policy.
- [x] CI baseline for `typecheck`, `build`, and `vitest`.
- [x] Local machine paths removed from committed files and rewritten git history.

### Phase 1.1 Implementation

- [x] Removed Jules auth remnants.
- [x] Removed `pipeline.ts`.
- [x] Removed `AsyncConnector`.
- [x] Implemented `src/cli/commands/init.ts`.
- [x] Implemented `src/setup/project.ts`.
- [x] Implemented `src/setup/billing.ts`.
- [x] Implemented `src/setup/apis.ts`.
- [x] Implemented `src/setup/iam.ts`.
- [x] Added human-mode input flow.
- [x] Added JSON-mode required flag validation.
- [x] Implemented `src/cli/commands/link.ts`.
- [x] Implemented `src/planner/detect.ts`.
- [x] Implemented `src/planner/gcp-state.ts`.
- [x] Implemented `src/planner/plan-builder.ts`.
- [x] Implemented `src/planner/schema.ts`.
- [x] Implemented `spa-plus-api` path.
- [x] Implemented `NO_DEPLOYABLE_CONTENT` path.
- [x] Implemented `src/cli/commands/deploy.ts`.
- [x] Implemented `src/executor/apply.ts`.
- [x] Implemented `src/wiring/firebase-rewrites.ts`.
- [x] Implemented `src/wiring/env-inject.ts`.
- [x] Applied trust gate.
- [x] Applied backend-first deployment order.
- [x] Stabilized `doctor` JSON output.
- [x] Improved ADC file based doctor check.
- [x] Kept `require_approval` as a hard block before approval workflow.
- [x] Normalized `bin/omg` path.
- [x] Normalized `package.json` entry/start fields.
- [x] Wired commands in `src/cli/index.ts`.

### Test Baseline

- [x] CLI hardening tests.
- [x] Connector unit tests.
- [x] Trust tests.
- [x] Planner/wiring tests.
- [x] Auth/setup tests.
- [x] Budget tests.
- [x] Secret Manager tests.
- [x] Project lifecycle tests.

## Known Remaining Risks

- Budget alerts do not enforce a hard spend cap.
- Budget visibility depends on billing permissions and the Budget API.
- Budget guard now covers `omg init` before billing link/default API enablement/IAM setup; broader live-operation coverage is still being expanded.
- `omg` is currently an MCP server, not yet a downstream MCP client/gateway.
- Existing service execution is mostly through `gcloud` and Firebase CLI connectors; raw downstream Google/Firebase MCP tools are not safety-wrapped yet.
- IAM audit is read-only; IAM write/grant workflows are intentionally not implemented.
- Security audit is a read-only rollup, not Security Command Center integration.
- Notify is intentionally deferred until external notification recipients/channels are specified.
- Live project lifecycle testing is intentionally narrow and should stay approval-gated.
- gcloud configuration reads can be flaky if multiple gcloud commands are run concurrently; live auth/budget/doctor checks should run sequentially.
- Next.js SSR remains out of scope.
