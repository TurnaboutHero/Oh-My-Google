# TODO

Status snapshot: 2026-04-28

This file tracks current implementation state. Product rationale lives in [PRD.md](./PRD.md). Sequencing and phase intent live in [PLAN.md](./PLAN.md).

## Now

### Phase 5A: Operational Safety Closure - Budget Policy Ensure

- [x] Add `omg budget ensure --project <id> --amount <n> --currency <code> --dry-run` as a safe policy-planning command.
- [x] Add budget policy normalization for amount, currency, thresholds, and expected display name.
- [x] Compare the expected budget policy against visible billing budgets and return `create`, `update`, `none`, or `blocked`.
- [x] Keep live budget creation/update blocked in this safe foundation pass, even when `--yes` is supplied.
- [x] Classify `budget.ensure` as L2 billing governance with dry-run and post-verification semantics.
- [x] Add tests for budget policy planning, CLI behavior, and safety intent mapping.
- [x] Add live executor design/runbook and pure Budget API mutation contract tests without cloud calls.
- [x] Add injected Budget API request executor core and post-verification contract tests without cloud calls.
- [x] Add live gate contract for Budget API transport/auth, approval, decision log, and post-verification failure envelope without opening live mutation.
- [ ] Wire the Budget API executor into `budget ensure --yes` only after owner approval and live transport failure handling are reviewed.
- [ ] Add MCP coverage for `budget ensure` only after the CLI contract and live executor are stable.
- [x] Add Pub/Sub budget notification audit/ensure dry-run planning after budget policy ensure is live-safe.
- [x] Parse visible budget `notificationsRule` metadata from budget audit output.
- [x] Report notification posture as `configured`, `partial`, `none`, or `blocked`.
- [x] Keep live budget notification mutation blocked in this safe foundation pass, even when `--yes` is supplied.
- [x] Add tests for notification posture, dry-run routing plans, mutation contract, CLI behavior, and safety intent mapping.
- [x] Add budget notification runbook.
- [x] Add Pub/Sub topic existence audit before opening live notification mutation.
- [x] Add read-only Pub/Sub topic IAM audit and Publisher binding readiness reporting before opening live notification mutation.
- [x] Decide Pub/Sub topic creation and IAM grants stay manual-first until a separate owner-approved live executor and verifier exist.
- [x] Add local cost lock after notification posture is defined.
- [x] Add `omg cost status`, `omg cost lock`, and `omg cost unlock --yes` over local `.omg/cost-lock.json` state.
- [x] Block live `omg deploy`, `omg firebase deploy --execute`, `omg secret set`, and `omg init` cost-expanding setup when a project cost lock is active.
- [x] Add tests proving active cost lock blocks before budget audit or cloud execution.
- [x] Add budget Pub/Sub notification to local cost lock ingestion dry-run planning.
- [x] Add `omg budget notifications lock-ingestion --project <id> --topic <topic> --dry-run`.
- [x] Keep live subscription/handler setup blocked with `BUDGET_LOCK_INGESTION_LIVE_NOT_IMPLEMENTED`.
- [x] Decide budget Pub/Sub notification ingestion remains operator-driven until a reviewed subscriber, handler, and verifier exist.
- [x] Add agent IAM planning/bootstrap dry-run after budget controls are stable.
- [x] Add `omg iam plan --project <id>` to propose separated auditor/deployer/secret-admin identities from IAM audit state.
- [x] Add `omg iam bootstrap --project <id> --dry-run` and keep live service account creation/IAM grants blocked.
- [x] Add tests for agent IAM plan generation, dry-run-only bootstrap, and safety intent mapping.
- [x] Decide live agent IAM bootstrap remains manual-first until owner-approved verifier and least-privilege grant design exist.

### Phase 4: Resource Add Workflows

- [x] Start Phase 4 with read-only Firestore inspection.
- [x] Implement `omg firestore audit --project <id>`.
- [x] Add MCP coverage for `omg.firestore.audit`.
- [x] Add Firestore audit connector, command, safety-intent, and CLI/MCP equivalence tests.
- [x] Add Firestore audit runbook.
- [x] Implement `omg storage audit --project <id>`.
- [x] Add MCP coverage for `omg.storage.audit`.
- [x] Add Cloud Storage audit connector, command, safety-intent, and CLI/MCP equivalence tests.
- [x] Add Cloud Storage audit runbook.
- [x] Implement `omg sql audit --project <id>`.
- [x] Add MCP coverage for `omg.sql.audit`.
- [x] Add Cloud SQL audit connector, command, safety-intent, and CLI/MCP equivalence tests.
- [x] Add Cloud SQL audit runbook.
- [x] Keep Firestore create/delete/export/import/data mutation workflows deferred until a concrete owner-approved workflow exists.
- [x] Keep Cloud Storage bucket/object/IAM/lifecycle write workflows deferred until a concrete owner-approved workflow exists.
- [x] Keep Cloud SQL instance/backup/export/import/lifecycle write workflows deferred until a concrete owner-approved workflow exists.
- [x] Decide stronger Secret Manager integration is already covered by existing list/set/delete plus budget guard; version/access-policy audit remains deferred until a concrete workflow exists.
- [x] Preserve the cost-bearing invariant across all Phase 4 read-only resource surfaces.

### Phase 4B: Downstream MCP Gateway

- [x] Add `.omg/mcp.yaml` downstream MCP registry parsing.
- [x] Reject stored env value maps; use `envAllowlist` only.
- [x] Add registry audit without downstream execution.
- [x] Add optional downstream MCP tool discovery through `tools/list`.
- [x] Add read-only allowlisted downstream MCP proxy calls.
- [x] Deny unknown, unallowlisted, disabled, destructive, and non-read downstream tools.
- [x] Keep raw `downstream-mcp` adapter deny-by-default while enabling only `downstream-mcp-readonly`.
- [x] Add `downstream.mcp.discover` and `downstream.mcp.read` operation intents as L0.
- [x] Log every downstream tool call attempt to `.omg/decisions.log.jsonl`.
- [x] Add CLI coverage through `omg mcp gateway audit` and `omg mcp gateway call`.
- [x] Add MCP coverage through `omg.mcp.gateway.audit` and `omg.mcp.gateway.call`.
- [x] Add downstream MCP gateway tests and runbook.
- [x] Add real stdio downstream MCP fixture coverage for discovery, allowlisted read calls, and denied destructive tools.
- [x] Add exact 23-tool MCP server registry and `mcp start` stdio discovery smoke coverage.
- [x] Add Phase 4/4B release notes.

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
- [x] Apply cost/free-tier guardrails before all known cost-bearing live Google Cloud operations.
- [x] Add invariant tests so new cost-bearing operation intents and command mappings must require budget guard.

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

1. Keep Pub/Sub topic/IAM setup, budget alert ingestion setup, and agent IAM bootstrap manual-first unless a new owner-approved live executor/verifier is designed.
2. Wire live `budget ensure --yes` only after Budget API transport/auth failure handling and owner approval are reviewed.
3. Add MCP coverage for `budget ensure` only after the CLI contract and live executor are stable.
4. Keep `budget ensure --yes`, `budget notifications ensure --yes`, `budget notifications lock-ingestion --yes`, and `iam bootstrap --yes` blocked until their live executors exist.
5. Keep Firestore, Cloud Storage, Cloud SQL, and broad IAM write/provisioning workflows deferred unless a concrete owner-approved workflow requires them.
6. Preserve the cost-bearing invariant before any new live Google Cloud operation.
7. Run optional live read-only audits only with explicit project/account approval.
8. Run optional external downstream MCP gateway smoke only against a known benign MCP server.
9. Re-run the local verification suite before each push.

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
- [x] `omg.firestore.audit`.
- [x] `omg.storage.audit`.
- [x] `omg.sql.audit`.
- [x] `omg.mcp.gateway.audit`.
- [x] `omg.mcp.gateway.call`.

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
- `budget ensure` currently plans expected budget policy in dry-run only; live CLI create/update is intentionally blocked until transport/auth, approval, and post-verification failure handling are reviewed.
- Budget API request execution and post-verification are available as injected core functions, but CLI live mutation remains blocked.
- Budget ensure live gate contract now fixes transport/auth, approval, decision-log, and post-verification failure envelope expectations before live CLI wiring.
- `budget notifications ensure` currently plans Pub/Sub routing in dry-run only and performs read-only topic/IAM audit; live notification mutation, Pub/Sub topic creation, and IAM grants are intentionally blocked.
- Pub/Sub topic creation, Publisher grants, subscription setup, Subscriber grants, handler setup, and live agent IAM bootstrap are accepted manual-first boundaries, not autonomous setup paths.
- Budget guard covers all currently known cost-bearing live operations; invariant tests should fail if a new cost-bearing intent omits budget guard.
- Local cost lock is an operator-controlled local blocker, not a cloud billing hard cap; Budget Pub/Sub ingestion is dry-run planning only until a reviewed live handler exists.
- Budget Pub/Sub to cost lock ingestion is dry-run planning only; live subscription creation, subscriber permission grants, and handler setup are intentionally not implemented.
- An active local cost lock blocks currently known cost-bearing live `omg` operations before budget audit or cloud execution, but raw `gcloud`/Firebase CLI commands outside `omg` are out of scope.
- `omg` now has a narrow downstream MCP gateway for registry audit, tool discovery, and allowlisted read-only tool calls.
- Local stdio fixture coverage exists for the downstream MCP gateway, but external downstream MCP smoke still requires a known benign target.
- Existing service execution is mostly through `gcloud` and Firebase CLI connectors; raw downstream Google/Firebase MCP tools remain denied unless routed through the gateway allowlist.
- Downstream MCP write/lifecycle proxying is intentionally not implemented until concrete verifiers exist.
- IAM audit and agent IAM planning are read-only; `iam bootstrap --dry-run` plans separated identities, but live service account creation and IAM grants are intentionally not implemented.
- Security audit is a read-only rollup, not Security Command Center integration.
- External notify senders are intentionally deferred until budget Pub/Sub notification posture and recipients/channels are specified.
- Firestore audit is read-only; Firestore write/provisioning/data workflows are intentionally not implemented.
- Cloud Storage audit is read-only; bucket/object/IAM/lifecycle write workflows are intentionally not implemented.
- Cloud SQL audit is read-only; instance/backup/export/import/lifecycle write workflows are intentionally not implemented.
- Phase 4 Storage/SQL live smoke was not run in this update; read-only live calls still require explicit project/account approval.
- Live project lifecycle testing is intentionally narrow and should stay approval-gated.
- gcloud configuration reads can be flaky if multiple gcloud commands are run concurrently; live auth/budget/doctor checks should run sequentially.
- Next.js SSR remains out of scope.
