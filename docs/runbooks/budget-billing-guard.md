# Budget / Billing Guard Runbook

This Phase 3 surface starts with a read-only audit and one explicit API-enablement helper.

Commands:

- `omg budget audit --project <id>`
- `omg budget enable-api --project <id> --dry-run`
- `omg budget enable-api --project <id> --yes`
- MCP tool `omg.budget.audit`

`budget audit` never creates budgets, enables APIs, links billing, disables billing, or changes project state.
`budget enable-api` is the only command in this surface that changes project state; it enables `billingbudgets.googleapis.com`, requires explicit `--yes`, and should be run after `--dry-run`.

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
- Budget creation is not implemented yet and should remain an explicit future workflow if added.
- Live `omg deploy`, `omg firebase deploy --execute`, and `omg secret set` run this guard before writing. Dry-runs do not run the guard and do not write cloud resources.

Current gap: first-run setup/API-enable paths still need explicit budget guard design so onboarding does not deadlock before budget visibility exists.

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
