# Budget / Billing Guard Runbook

This Phase 3 surface starts with a read-only audit and one explicit API-enablement helper.

Commands:

- `omg budget audit --project <id>`
- `omg budget enable-api --project <id> --dry-run`
- `omg budget enable-api --project <id> --yes`
- `omg budget ensure --project <id> --amount <n> --currency <code> --dry-run`
- `omg budget notifications audit --project <id> [--topic <topic>]`
- `omg budget notifications ensure --project <id> --topic <topic> --dry-run`
- `omg budget notifications lock-ingestion --project <id> --topic <topic> --dry-run`
- `omg cost status [--project <id>]`
- `omg cost lock --project <id> --reason <text>`
- `omg cost unlock --project <id> --yes`
- MCP tool `omg.budget.audit`
- MCP tool `omg.budget.ensure`
- MCP tools `omg.budget.notifications.audit`, `omg.budget.notifications.ensure`, and `omg.budget.notifications.lock_ingestion`
- MCP tools `omg.cost.status`, `omg.cost.lock`, and `omg.cost.unlock`

`budget audit` never creates budgets, enables APIs, links billing, disables billing, or changes project state.
`budget enable-api` is the only command in this surface that changes project state; it enables `billingbudgets.googleapis.com`, requires explicit `--yes`, and should be run after `--dry-run`.
`budget ensure --dry-run` plans the expected budget policy and compares it with visible budgets. It does not create or update budgets.
`budget notifications audit`, `budget notifications ensure --dry-run`, and `budget notifications lock-ingestion --dry-run` inspect and plan Pub/Sub notification routing only. They can read a target Pub/Sub topic and topic IAM policy, but they do not create Pub/Sub topics, create subscriptions, grant IAM, update budgets, start handlers, or send external notifications.
Live budget creation/update is still blocked in the production CLI runtime. `budget ensure --yes` returns `BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED` unless a reviewed Budget API executor is explicitly injected by code; tests cover that injected path with mocks only. The injected Budget API executor core, live gate contract, hash-bound approval consumption, decision logging, transport failure mapping, opt-in transport factory, and mock-only command-core wiring exist, but production live CLI wiring remains deferred.
Live budget notification mutation is also blocked. `budget notifications ensure --yes` returns `BUDGET_NOTIFICATIONS_LIVE_NOT_IMPLEMENTED` until live notification update, optional topic/IAM setup, and budget notification post-verification are implemented.
Live budget alert to cost lock ingestion setup is blocked. `budget notifications lock-ingestion --yes` returns `BUDGET_LOCK_INGESTION_LIVE_NOT_IMPLEMENTED` until subscription creation, subscriber IAM, handler runtime, local lock write, and acknowledgement semantics are reviewed.
Local cost lock is an additional operator-controlled safety brake. It writes only `.omg/cost-lock.json`; active locks block currently known cost-bearing live `omg` operations before budget audit or cloud execution.

## Audit

```bash
omg --output json budget audit --project <live-validation-project>
```

The audit gathers:

- project billing link state
- linked billing account ID
- visible billing budgets for the linked account

Risk classifications:

- `configured`: at least one budget is visible for the linked billing account
- `missing_budget`: billing is enabled but no budgets were found
- `billing_disabled`: billing is disabled for the project
- `review`: budgets could not be inspected, usually due to permissions or disabled Budget API

## Safety Notes

- Run this before cost-bearing live operations.
- Treat `missing_budget` and `review` as blockers for autonomous live writes.
- If budgets are inaccessible because `billingbudgets.googleapis.com` is disabled, do not auto-enable it from `budget audit`.
- Budget API enablement is explicit through `budget enable-api`.
- Budget ensure live mutation is not automated yet. Use `budget ensure --dry-run` to plan the expected policy, then create or adjust budgets manually in the Cloud Billing console until the live executor exists.
- Budget notification live mutation is not automated yet. Use `budget notifications audit --topic` and `budget notifications ensure --dry-run` to inspect routing/topic/IAM readiness, then configure Pub/Sub notifications manually in Cloud Billing until the live executor exists.
- Live `omg deploy`, `omg firebase deploy --execute`, `omg secret set`, and `omg init` billing/API/IAM setup first check local cost lock, then run this guard before cost-expanding writes. Dry-runs do not run the guard and do not write cloud resources.
- Operation intent and command-mapping tests assert that known cost-bearing operations require budget guard.

Bootstrap exception: `budget enable-api` remains explicit through dry-run/`--yes` so budget visibility can be enabled when the Budget API itself is missing.

## Manual Budget Creation

Use this path when `budget audit` returns `missing_budget` or `review` because no budget is visible for the linked billing account.

1. Open Google Cloud Console > Billing > Budgets & alerts.
2. Select the billing account linked to the target project.
3. Create a budget with thresholds that match the owner-approved policy. The validation project uses 50%, 90%, and 100% thresholds.
4. Configure notification recipients or channels outside `omg`.
5. Re-run:

```bash
omg --output json budget audit --project <project-id>
```

Proceed with live cost-bearing `omg` operations only when the audit returns `risk: configured`.

## Budget Ensure Dry-Run

Use this path to make the expected budget policy explicit before implementing live budget mutation:

```bash
omg --output json budget ensure --project <project-id> --amount 50000 --currency KRW --thresholds 0.5,0.9,1 --dry-run
```

The dry-run returns:

- expected display name, amount, currency, and thresholds
- visible linked billing account
- current budget audit risk
- one of `create`, `update`, `none`, or `blocked`
- exact policy changes that would be needed

Default display name:

```text
omg budget guard: <project-id>
```

Current safety boundary:

- `--dry-run` is implemented and read-only.
- `--yes` is intentionally blocked.
- The command does not call Budget API create/update yet.
- MCP coverage exposes the same dry-run planning contract; live executor semantics remain blocked.

Live executor design:

- [docs/runbooks/budget-ensure-live-executor.md](./budget-ensure-live-executor.md)

## Budget Notifications Dry-Run

Use this path to inspect and plan Pub/Sub notification routing before adding external notification senders:

```bash
omg --output json budget notifications audit --project <project-id> --topic budget-alerts
omg --output json budget notifications ensure --project <project-id> --topic budget-alerts --dry-run
```

Notification posture and live mutation gates are tracked in [budget-notifications.md](./budget-notifications.md).
Cost lock ingestion planning is tracked in [budget-cost-lock-ingestion.md](./budget-cost-lock-ingestion.md).

## Local Cost Lock

Use this path when an operator wants to freeze future cost-bearing live `omg` operations for a project without changing any Google Cloud state:

```bash
omg --output json cost lock --project <project-id> --reason "budget alert threshold exceeded"
omg --output json cost status --project <project-id>
```

While active, the lock returns `COST_LOCKED` for live deploys, Firebase helper deploys, Secret Manager writes, and cost-expanding init setup. To clear it:

```bash
omg --output json cost unlock --project <project-id> --yes
```

Detailed behavior is tracked in [cost-lock.md](./cost-lock.md).

## MCP Examples

```text
{ "tool": "omg.budget.audit", "arguments": { "project": "<live-validation-project>" } }
{ "tool": "omg.budget.ensure", "arguments": { "project": "<live-validation-project>", "amount": 50000, "currency": "KRW", "dryRun": true } }
{ "tool": "omg.budget.notifications.audit", "arguments": { "project": "<live-validation-project>", "topic": "budget-alerts" } }
{ "tool": "omg.budget.notifications.ensure", "arguments": { "project": "<live-validation-project>", "topic": "budget-alerts", "dryRun": true } }
{ "tool": "omg.budget.notifications.lock_ingestion", "arguments": { "project": "<live-validation-project>", "topic": "budget-alerts", "dryRun": true } }
{ "tool": "omg.cost.status", "arguments": { "project": "<live-validation-project>" } }
```

## Live Audit Record: 2026-04-20

The live validation project was audited with the active validation configuration:

| Field | Value |
|---|---|
| Project | `<live-validation-project>` |
| Billing enabled | `true` |
| Billing account | `011E98-D3C83D-7DFCB0` |
| Budget visibility | inaccessible |
| Risk | `review` |

Reason: `gcloud billing budgets list` reported that Cloud Billing Budget API was disabled or inaccessible for the active project/account context. No API was enabled and no billing state was changed.

Follow-up:

1. `omg budget enable-api --project <live-validation-project> --dry-run` returned an enable plan for `billingbudgets.googleapis.com`.
2. `omg budget enable-api --project <live-validation-project> --yes` enabled the API.
3. `omg budget audit --project <live-validation-project>` returned `risk: configured`.
4. `omg secret set` live path was wired to block unless the budget audit returns `risk: configured`. No live Secret Manager write was run during this guard integration.
5. A follow-up smoke created `OMG_BUDGET_GUARD_SMOKE` through `omg secret set --yes`, verified it with `omg secret list`, deleted it through `omg secret delete --yes`, and verified the secret list was empty.

Configured budget summary:

| Field | Value |
|---|---|
| Budget resource | `billingAccounts/011E98-D3C83D-7DFCB0/budgets/41af9ca6-dbd7-4777-8ff3-34edd3bb22e5` |
| Currency | `KRW` |
| Thresholds | `50%`, `90%`, `100%` |
