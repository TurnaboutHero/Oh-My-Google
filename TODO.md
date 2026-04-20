# TODO

## Active

### Phase 3 budget / billing guard

- [x] Define `budget` command scope and trust levels.
- [x] Add read-only billing/budget audit command.
- [ ] Add cost/free-tier guardrails before all live Google Cloud operations.
- [x] Add budget guard before live Secret Manager writes.
- [x] Add Secret Manager delete command for cleanup-safe smoke tests.
- [x] Add CLI and MCP coverage for budget/billing guard.
- [x] Document live-operation approval rules for cost-bearing actions.

### Phase 3 remaining admin surfaces

- [ ] Decide whether `iam` is needed before Phase 4.
- [ ] Decide whether `notify` is needed before Phase 4.
- [ ] Decide whether `security` is needed before Phase 4.

## Completed

### Phase 3 secret admin surface

- [x] `omg secret list` metadata-only JSON/human command.
- [x] `omg secret set <name>` dry-run and write command.
- [x] Secret write trust mapping (`secret.set` as L2).
- [x] Secret value redaction in outputs and approval args.
- [x] Secret admin runbook with cost boundary.
- [x] MCP tool coverage for secret admin surface.
- [x] Live Secret Manager smoke on `<live-validation-project>`.

### Phase 3 project cleanup audit/delete surface

- [x] `omg project audit --project <id>` read-only risk classification.
- [x] `omg project cleanup --project <id> --dry-run` plan-only command.
- [x] MCP tool coverage for project audit/cleanup dry-run.
- [x] `omg project delete --project <id>` approval-gated L3 workflow.
- [x] `omg project undelete --project <id>` approval-gated L3 recovery workflow.
- [x] Protected/do-not-touch projects blocked before approval.
- [x] Read-only audit smoke against existing ambiguous projects.
- [x] Live delete approved stale projects.

### Phase 2.5 harness foundation

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

### Phase 1.1 hardening

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

### Link quality

- [x] Warning for detected Next.js SSR repositories.
- [x] More granular repo detection cases.
- [x] Expanded `link` tests.

### Tooling

- [x] Windows line-ending policy.
- [x] CI baseline for `typecheck`, `build`, and `vitest`.

### Phase 2 prep

- [x] MCP server work split before broad admin surfaces.
- [x] Shared core boundary between CLI and MCP.

### Phase 1.1 implementation

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
- [x] Kept `require_approval` as hard block before approval workflow.
- [x] Normalized `bin/omg` path.
- [x] Normalized `package.json` entry/start fields.
- [x] Wired commands in `src/cli/index.ts`.

### Test baseline

- [x] CLI hardening tests.
- [x] Connector unit tests.
- [x] Trust tests.
- [x] Planner/wiring tests.
