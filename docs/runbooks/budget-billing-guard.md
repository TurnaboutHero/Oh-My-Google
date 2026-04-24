# Budget / Billing Guard Runbook

This Phase 3 surface starts with a read-only audit and one explicit API-enablement helper.

Commands:

- `omg budget audit --project <id>`
- `omg budget enable-api --project <id> --dry-run`
- `omg budget enable-api --project <id> --yes`
- MCP tool `omg.budget.audit`

`budget audit` never creates budgets, enables APIs, links billing, disables billing, or changes project state.
`budget enable-api` is the only command in this surface that changes project state; it enables `billingbudgets.googleapis.com`, requires explicit `--yes`, and should be run after `--dry-run`.
`omg budget create` is intentionally deferred. Budget creation stays a console/manual owner action because budget policy depends on billing-account ownership, currency, notification routing, and organization spending rules.

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
- Budget creation is not automated. Create or adjust budgets manually in the Cloud Billing console, then verify visibility with `omg budget audit --project <id>`.
- Live `omg deploy`, `omg firebase deploy --execute`, `omg secret set`, and `omg init` billing/API/IAM setup run this guard before cost-expanding writes. Dry-runs do not run the guard and do not write cloud resources.

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

## MCP Example

```json
{
  "tool": "omg.budget.audit",
  "arguments": {
    "project": "<live-validation-project>"
  }
}
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
