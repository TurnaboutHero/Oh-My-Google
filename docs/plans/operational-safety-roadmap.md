# Operational Safety Roadmap

Date: 2026-04-27
Status: accepted direction plan; Phase 5A safe foundation started

## Review Scope

This plan is based on the current project documentation set:

- Root docs: `README.md`, `README.en.md`, `PRD.md`, `PLAN.md`, `TODO.md`, `ARCHITECTURE.md`, `CLAUDE.md`, `AGENTS.md`
- Runbooks: `docs/runbooks/budget-billing-guard.md`, `docs/runbooks/iam-audit.md`, `docs/runbooks/security-audit.md`, `docs/runbooks/firestore-audit.md`, `docs/runbooks/storage-audit.md`, `docs/runbooks/sql-audit.md`, `docs/runbooks/downstream-mcp-gateway.md`, `docs/runbooks/phase-4-4b-release-notes.md`, `docs/runbooks/secret-admin.md`, `docs/runbooks/project-cleanup-audit.md`, `docs/runbooks/gcp-e2e.md`, `docs/runbooks/mcp-client-smoke.md`, `docs/runbooks/phase-2.5-validation.md`, `docs/runbooks/history-rewrite-and-conflict-safety.md`

External references checked:

- Google Cloud Budgets and alerts: budgets track planned spend and trigger notifications, but do not automatically cap usage or billing.
- Cloud Billing Budget API: budgets can be created and managed programmatically, and can use Pub/Sub for programmatic notifications.
- Google IAM service account roles: `roles/iam.serviceAccountUser` attaches service accounts to resources, while `roles/iam.serviceAccountTokenCreator` is needed for short-lived credential impersonation through gcloud.

## Current Judgment

The project should not move next into AI, analytics, broad resource writes, or downstream MCP write proxying.

The next product direction should be **Operational Safety Closure**: finish the basic controls that make `omg` credible as an agent-first cloud safety harness.

The reason is simple: the docs already define the product as a structured safety gateway for agents, and the implementation already has the right core primitives: Trust Profile, OperationIntent, budget guard, approval queue, decision log, read-only audits, and CLI/MCP parity. The remaining gap is not another cloud surface. The gap is that the project still cannot fully answer these operator questions:

- Is a concrete budget policy actually present and correct?
- Are budget notifications wired to something actionable?
- Can `omg` stop its own cost-bearing actions after a budget alert?
- Is the agent operating through a separated least-privilege identity instead of the human account?

## Evidence From Existing Docs

- The README says budget creation/mutation is not implemented, and `notify` plus IAM write/provisioning are not designed yet (`README.md:67-68`).
- The README and PRD state that Google Cloud budgets are alerts, not hard spend caps (`README.md:74`, `PRD.md:58`).
- The PRD requires live deploys, Firebase helper deploys, `secret set`, and `init` billing/API/IAM setup to block unless budget audit returns `risk: configured` (`PRD.md:196`).
- The PLAN says `omg budget create` is deferred and current automation verifies visibility through `budget audit` (`PLAN.md:135`).
- The TODO keeps IAM write/grant and notify deferred until concrete workflows exist (`TODO.md:84-85`, `TODO.md:106`).
- The architecture marks budget creation/mutation, IAM write/grant, notify, downstream MCP writes, and resource mutation workflows as not implemented (`ARCHITECTURE.md:716-724`).
- The current code has the safety kernel needed for this work: OperationIntent classification (`src/safety/intent.ts`), safety decisions with budget blocking (`src/safety/decision.ts:45-84`), command intent mapping (`src/safety/commands.ts`), and budget/IAM audit commands (`src/cli/commands/budget.ts`, `src/cli/commands/iam.ts`).

## Principles

1. **Budget policy before cost expansion.** `risk: configured` should mean more than "some budget exists"; it should mean the expected budget policy is visible.
2. **Cost lock before hard cloud shutdown.** Because budgets do not cap spend, the first automatic response should block `omg` live cost-bearing operations, not disable billing.
3. **Agent identity before broader writes.** New write workflows should run through an agent service account or explicit impersonation plan, not an unconstrained human account.
4. **Read-only first, dry-run second, live third.** Every new operational surface starts with audit/plan, then dry-run, then explicit `--yes` or approval.
5. **No raw privileged backend escape.** REST/SDK/downstream MCP backends must stay behind OperationIntent, Trust Profile, decision logging, and post-verification.

## Decision Drivers

1. The product promise is safety for AI agents across Google Cloud and Firebase, not broad service coverage.
2. Budget and IAM gaps are foundational: they affect every future live operation.
3. Current docs repeatedly defer resource writes and AI/analytics until the safety model is stable.

## Options Considered

### Option A: Move To AI And Analytics Integrations

This follows the current candidate Phase 5 list, but it is the wrong next move. Gemini, Vertex AI, embeddings, Analytics, and BigQuery add cost, IAM, data, and quota complexity before the project has budget policy management, notification handling, or agent identity separation.

Decision: reject for now.

### Option B: Add Firestore, Storage, SQL, Or IAM Write Workflows

This would turn deferred surfaces into live mutation paths. It would be useful later, but it violates the documented rule that write/provisioning workflows need concrete owner-approved workflows and must preserve the cost-bearing invariant.

Decision: reject for now, except for the narrowly scoped IAM work needed to create and validate an agent execution identity.

### Option C: Complete Operational Safety Closure

This extends the existing safety model instead of broadening service scope. It turns previously deferred budget and notify work into concrete product workflows, then adds IAM separation as the prerequisite for future writes.

Decision: choose this option.

## Roadmap

### Phase 5A: Budget Policy Ensure

Goal: make `omg` able to verify and create the expected budget policy for a project.

Safe foundation status:

- `budget ensure --dry-run` is implemented as a read-only policy planner.
- `budget ensure --yes` remains blocked in the production CLI runtime with `BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED`; the injected Budget API executor core, live gate contract, transport failure mapping, opt-in transport factory, and mock-only command-core wiring can exist before live CLI wiring is opened.
- `budget notifications audit` and `budget notifications ensure --dry-run` are implemented as read-only/dry-run Pub/Sub routing planning.
- Pub/Sub topic existence and topic IAM policy are now audited read-only for notification planning.
- `budget notifications ensure --yes` remains blocked with `BUDGET_NOTIFICATIONS_LIVE_NOT_IMPLEMENTED` until live notification update, optional topic/IAM setup, and post-verification are implemented.

Commands:

```bash
omg budget ensure --project <id> --amount <number> --currency KRW --thresholds 0.5,0.9,1 --dry-run
omg budget ensure --project <id> --amount <number> --currency KRW --thresholds 0.5,0.9,1 --yes
```

Expected behavior:

- Use the existing budget audit path to resolve linked billing account and visible budgets.
- Match budgets by project scope, display name/prefix, currency, amount, threshold rules, and notification rule presence when provided.
- If no matching budget exists, return a dry-run creation plan.
- If a budget exists but differs, return a dry-run update plan.
- Live creation/update requires explicit `--yes`; in staging/prod it should require approval through Trust Profile policy.
- After live execution, re-run `budget audit` and report whether the expected policy is now visible.
- Do not implement budget delete in the first pass.

Safety classification:

- Add OperationIntent IDs such as `budget.ensure`, `budget.update`, and optionally `budget.notification.update`.
- Treat budget mutation as L2 billing governance work.
- Mark it `costBearing: false`, `requiresBudget: false`, `supportsDryRun: true`, `postVerify: true`.
- Require billing budget visibility before update; if the active account can only see project-level budgets, keep the action scoped to that project and report the limitation.

Implementation areas:

- `src/cli/commands/budget.ts`
- `src/connectors/billing-audit.ts`
- new budget policy connector/helper if the current gcloud path cannot safely express create/update
- `src/safety/intent.ts`
- `src/safety/commands.ts`
- `src/trust/levels.ts`
- MCP tool registration now exposes the dry-run planning contract while live mutation remains blocked
- `docs/runbooks/budget-billing-guard.md`

Acceptance criteria:

- `budget ensure --dry-run` never mutates cloud state.
- `budget ensure --yes` refuses to run without a prior valid project and billing account target.
- A visible matching budget returns `ok: true` with `changed: false`.
- A missing budget returns a structured create plan in dry-run.
- A changed budget returns a structured update plan in dry-run.
- Live ensure re-runs audit and returns `risk: configured` plus expected policy evidence.
- Tests cover missing budget, matching budget, changed budget, inaccessible budgets, invalid currency/amount/thresholds, and JSON error contracts.

### Phase 5B: Budget Notification Audit And Ensure

Goal: make budget alerts actionable through Pub/Sub without immediately building an external notification system.

Commands:

```bash
omg budget notifications audit --project <id> --topic <topic>
omg budget notifications ensure --project <id> --topic <topic> --dry-run
omg budget notifications ensure --project <id> --topic <topic> --yes
```

Expected behavior:

- Audit whether visible budgets have Pub/Sub notification rules. Implemented.
- Dry-run a budget `notificationsRule.pubsubTopic` and schema version update. Implemented.
- Audit whether the target Pub/Sub topic exists. Implemented.
- Audit whether the target Pub/Sub topic IAM policy has a visible Pub/Sub Publisher binding. Implemented.
- Optionally create/connect the topic only through dry-run/`--yes` and only after budget policy is visible. Still deferred.
- Do not send Slack, Discord, email, or webhook messages in this phase.

Safety classification:

- Notification audit is L0 read-only.
- Notification ensure is L2 because the future live form changes billing notification routing. Current implementation is dry-run only and does not create Pub/Sub resources.
- Pub/Sub resource creation should be treated as cost-bearing unless the implementation proves it is a no-cost configuration-only path; default to budget guard for live Pub/Sub creation.

Implementation areas:

- `src/cli/commands/budget.ts` or a nested command module
- new connector for Pub/Sub topic metadata and IAM
- budget policy connector from Phase 5A
- `src/safety/intent.ts`
- `src/safety/commands.ts`
- MCP tools now expose audit and dry-run planning after CLI semantics stabilized
- new runbook: `docs/runbooks/budget-notifications.md`

Acceptance criteria:

- Audit reports `none`, `partial`, `configured`, or `blocked` notification posture.
- Ensure dry-run reports exact budget/topic changes without mutation. Implemented.
- Ensure dry-run blocks when topic existence or topic IAM readiness is not visible. Implemented.
- Ensure live verifies topic existence, budget notification rule, and publisher permission after execution.
- Missing permissions return structured errors and `next` steps.
- No external secret or webhook value is stored in committed config.

### Phase 5C: Local Cost Lock

Goal: give `omg` a real "stop doing costly things" mechanism before attempting any strong cloud-level shutdown.

Commands:

```bash
omg cost status
omg cost lock --project <id> --reason "budget alert threshold exceeded"
omg cost unlock --project <id> --yes
```

Expected behavior:

- Store a local lock artifact such as `.omg/cost-lock.json`.
- The shared safety decision path checks the lock before running any live `requiresBudget` operation.
- Locked cost-bearing actions fail with a stable code such as `COST_LOCKED`.
- Dry-runs and read-only audits remain allowed.
- Unlock requires approval or stricter Trust Profile handling.
- Budget notification ingestion can be added later to call `cost lock`.

Safety classification:

- `cost.status` is L0.
- `cost.lock` is L1 or L2 depending on whether it only changes local state.
- `cost.unlock` should be L2 or approval-gated because it restores cost-bearing execution.

Implementation areas:

- new `src/cost-lock/` module
- `src/safety/decision.ts`
- `src/cli/commands/cost.ts`
- MCP tools now expose local status/lock/unlock after CLI behavior stabilized
- decision log entries for lock/unlock
- new runbook: `docs/runbooks/cost-lock.md`

Acceptance criteria:

- A cost lock blocks live deploy, Firebase deploy execute, secret set, and init cost-expanding setup.
- Cost lock does not block `doctor`, `auth context`, budget audit, security audit, or dry-runs.
- Lock/unlock writes decision log entries.
- Unlock cannot silently proceed in JSON mode without approval/confirmation.

### Phase 5D: Agent IAM Planning And Bootstrap

Goal: separate the human operator account from the identity used by agent-run cloud operations.

Commands:

```bash
omg iam plan --project <id>
omg iam bootstrap --project <id> --dry-run
omg iam bootstrap --project <id> --yes
omg auth context
```

Expected behavior:

- `iam plan` is read-only and reports proposed agent service accounts, roles, impersonation grants, and gaps. Implemented.
- `iam bootstrap --dry-run` shows service account creation and IAM binding plan. Implemented.
- `iam bootstrap --yes` remains blocked until a reviewed live executor and post-verifier exist.
- Prefer service account impersonation over service account keys.
- Update `omg` execution config so gcloud calls can use `--impersonate-service-account` without changing the global active account.
- Preserve the distinction between `roles/iam.serviceAccountUser` for attaching service accounts to resources and `roles/iam.serviceAccountTokenCreator` for impersonation.

Initial role target:

- Minimum deploy roles for supported workflows only.
- Do not grant Owner or Editor.
- Do not grant broad IAM admin roles by default.
- Keep role plan explicit and diffable before applying.

Safety classification:

- `iam.plan` is L0 read-only.
- `iam.bootstrap` is L2 IAM write in its future live form; the current implementation is dry-run only.
- In prod, require approval.
- Any role grant must be post-verified through `iam audit`.

Implementation areas:

- `src/connectors/iam-audit.ts`
- `src/setup/iam.ts`
- `src/auth/gcloud-context.ts`
- `src/system/cli-runner.ts` or connector-level command construction for impersonation
- `src/safety/intent.ts`
- `src/safety/commands.ts`
- `src/trust/levels.ts`
- runbook: `docs/runbooks/agent-iam-planning.md`

Acceptance criteria:

- `iam plan` reports current human account, proposed service accounts, missing roles, risky existing roles, and exact commands/changes.
- `iam bootstrap --dry-run` has zero cloud mutation.
- Live bootstrap refuses Owner/Editor and broad IAM admin grants by default.
- Live bootstrap verifies service account existence, role bindings, and Token Creator grant after applying.
- Commands executed with impersonation still report the human active account and impersonated service account separately.
- No service account key file is created.

### Phase 5E: Documentation And Validation Refresh

Goal: make the new direction visible in the project docs before broader features continue.

Required updates after implementation:

- `README.md` and `README.en.md`: update current status and CLI/MCP surface.
- `PRD.md`: move budget ensure, notifications, cost lock, and agent IAM separation into current scope.
- `PLAN.md`: replace the old Phase 5 AI/analytics next step with Operational Safety Closure.
- `TODO.md`: track exact command-level tasks.
- `ARCHITECTURE.md`: add budget policy, notification, cost lock, and impersonation boundaries.
- `CLAUDE.md` and `AGENTS.md`: update agent usage contract.
- New runbooks listed above.

Verification:

```bash
npm run typecheck
npm run build
npx vitest run
git diff --check
```

Live verification should use a disposable or explicitly approved validation project only. Any live resource created for smoke testing must be verified and cleaned up unless it is intentionally retained as the validation baseline.

## Non-Goals For This Roadmap

- No billing disable automation in the first pass.
- No automatic budget deletion.
- No Slack/Discord/webhook integration before Pub/Sub notification posture exists.
- No Firestore document writes, Storage object writes, SQL mutations, or downstream MCP write proxying.
- No Next.js SSR support.
- No service account key generation.
- No AI/analytics integrations until the safety closure phases pass.

## Risks And Mitigations

| Risk | Mitigation |
|---|---|
| Budget API permissions differ between billing-account and project-level users | Support audit-first behavior and return explicit `next` steps when the active account lacks `billing.budgets.*` visibility. |
| Budget notifications are mistaken for hard caps | Keep docs and output explicit: notifications trigger `omg` cost lock; they do not stop Google billing by themselves. |
| Cost lock can be bypassed through raw `gcloud` | Scope the guarantee honestly: `omg` blocks its own cost-bearing operations. Raw Google tools remain outside the product boundary. |
| Agent service account gets over-privileged | Start with a read-only plan, deny Owner/Editor by default, post-verify with IAM audit, and keep role sets explicit. |
| Impersonation changes confuse account diagnostics | Extend `auth context` output to show active gcloud account, ADC account, configured impersonation target, and mismatch state separately. |
| New commands drift away from CLI/MCP equivalence | Add command intent mapping and CLI/MCP equivalence tests before exposing MCP tools. |

## Verification Matrix

| Area | Unit tests | Integration tests | Live smoke |
|---|---|---|---|
| Budget ensure | budget policy matching, validation, safety intents | CLI JSON dry-run/update paths | create/update budget on approved validation project |
| Notifications | topic/rule parsing, permission failures | dry-run/ensure command output | connect budget to Pub/Sub topic |
| Cost lock | safety decision block/unblock | deploy/secret/init blocked while locked | optional local-only smoke, no cloud mutation required |
| Agent IAM | role plan diff, deny broad roles | bootstrap dry-run and post-verify flow | create service account and impersonated `auth context` on disposable project |
| Docs | link/status consistency | `git diff --check` | n/a |

## ADR

Decision: make the next roadmap **Operational Safety Closure**.

Drivers:

- `omg` is positioned as an agent-first safety gateway.
- Budget, notification, and IAM identity gaps affect all future live operations.
- Existing docs defer broad writes and AI/analytics until the safety model is stable.

Alternatives considered:

- AI/analytics phase next: rejected because it adds cost and IAM complexity too early.
- Resource write workflows next: rejected because the docs require concrete owner-approved workflows and stronger safety prerequisites.
- Downstream MCP write proxy next: rejected because verifier semantics are still intentionally missing.

Why chosen:

Operational Safety Closure strengthens the existing product promise instead of broadening scope. It turns the largest documented safety gaps into concrete, testable workflows while preserving the current narrow-surface architecture.

Consequences:

- The old "Phase 5 AI And Analytics Integrations" should be demoted to a later candidate phase.
- `budget create` should no longer remain a purely manual policy if this roadmap is accepted; it becomes `budget ensure` with strict dry-run, trust, and post-verification.
- IAM writes remain broadly deferred, but the agent identity bootstrap becomes a justified narrow exception.

Follow-ups:

- Implement Phase 5A first.
- Update `PLAN.md` and `TODO.md` after Phase 5A command contracts are finalized.
- Do not add MCP tools for new commands until CLI behavior and tests are stable.
