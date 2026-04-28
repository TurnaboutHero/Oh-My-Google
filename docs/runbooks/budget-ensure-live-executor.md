# Budget Ensure Live Executor Design

Status: injected executor core and contract tests exist; live CLI mutation is still blocked

This runbook defines the contract for the future live executor behind:

```bash
omg budget ensure --project <id> --amount <n> --currency <code> --yes
```

The CLI implementation only supports `--dry-run`. Supplying `--yes` still returns `BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED`.

## Official API Grounding

The live executor should use the Cloud Billing Budget API rather than ad hoc human-console steps.

Relevant official behavior:

- Budget API budgets are scoped under `billingAccounts/{billingAccountId}/budgets/{budgetId}`.
- Create uses `POST https://billingbudgets.googleapis.com/v1/billingAccounts/{billingAccountId}/budgets`.
- Update uses `PATCH https://billingbudgets.googleapis.com/v1/billingAccounts/{billingAccountId}/budgets/{budgetId}`.
- Budget resources include `displayName`, `budgetFilter`, `amount`, `thresholdRules`, optional `notificationsRule`, `etag`, and `ownershipScope`.
- `budgetFilter.projects[]` scopes a budget to one or more projects in the form `projects/{project}`.
- `amount.specifiedAmount.currencyCode` must match the billing account currency on create and the existing budget currency on update.
- `thresholdRules[].thresholdPercent` is 1.0-based; `0.5` means 50%.
- `thresholdRules[].spendBasis` defaults to current spend, but `omg` should send `CURRENT_SPEND` explicitly.
- Pub/Sub notifications require an existing topic and `pubsub.topics.setIamPolicy` permission. Audit/dry-run planning lives in [budget-notifications.md](./budget-notifications.md); live notification mutation remains deferred.

Sources:

- https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets
- https://docs.cloud.google.com/billing/docs/how-to/budget-api
- https://docs.cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications

## Live Mutation Preconditions

The executor must not run unless all conditions are true:

1. `budget ensure --dry-run` produces `action: create`, `action: update`, or `action: none`.
2. `action: blocked` is never executable.
3. Project ID, billing account ID, amount, currency, thresholds, and display name are valid and present.
4. The active Trust Profile allows `budget.ensure` as L2 billing governance.
5. JSON mode without explicit `--yes` stays blocked.
6. The current implementation has a Budget API executor that can be unit-tested without network access.
7. Live execution writes a decision log event.
8. Live execution post-verifies by re-running budget audit and matching the expected policy.

## API Payload Contract

The pure request contract is implemented in `src/connectors/budget-policy.ts` and tested without cloud calls.

Create plan:

```json
{
  "action": "create",
  "parent": "billingAccounts/ABC-123",
  "budget": {
    "displayName": "omg budget guard: demo-project",
    "budgetFilter": {
      "projects": ["projects/demo-project"],
      "calendarPeriod": "MONTH",
      "creditTypesTreatment": "INCLUDE_ALL_CREDITS"
    },
    "amount": {
      "specifiedAmount": {
        "currencyCode": "KRW",
        "units": "50000"
      }
    },
    "thresholdRules": [
      { "thresholdPercent": 0.5, "spendBasis": "CURRENT_SPEND" },
      { "thresholdPercent": 0.9, "spendBasis": "CURRENT_SPEND" },
      { "thresholdPercent": 1, "spendBasis": "CURRENT_SPEND" }
    ]
  }
}
```

Update plan:

```json
{
  "action": "update",
  "name": "billingAccounts/ABC-123/budgets/budget-1",
  "updateMask": ["displayName", "budgetFilter", "amount", "thresholdRules"],
  "budget": {
    "name": "billingAccounts/ABC-123/budgets/budget-1",
    "displayName": "omg budget guard: demo-project"
  }
}
```

## Implemented Foundation

The pure mutation plan lives in `src/connectors/budget-policy.ts`.

The injected request executor core lives in `src/connectors/budget-api.ts` and is covered without live Google Cloud calls:

- `buildCreateBudgetRequest`
- `buildUpdateBudgetRequest`
- `createBudget`
- `updateBudget`
- `executeBudgetApiMutation`
- `executeBudgetEnsureWithPostVerification`

The executor core requires an injected `BudgetApiRequestExecutor`; there is no default live transport wired into the CLI. This keeps `budget ensure --yes` blocked while preserving the request and post-verification contract for review.

## Future Live Transport Shape

Future implementation should add the live HTTP/auth transport behind the existing connector instead of placing HTTP logic in the CLI command:

```text
src/connectors/budget-api.ts
```

Expected live transport integration point:

```ts
createBudget(input: {
  apiUserProjectId: string;
  parent: string;
  budget: BudgetApiBudgetPayload;
}): Promise<BudgetApiBudgetPayload>

updateBudget(input: {
  apiUserProjectId: string;
  name: string;
  updateMask: string[];
  budget: BudgetApiBudgetPayload;
}): Promise<BudgetApiBudgetPayload>
```

The transport can use either:

- REST with `gcloud auth print-access-token`, `x-goog-user-project`, and `execFile`-safe argument handling; or
- an official Google client if it avoids broad dependency or auth-context ambiguity.

Do not add service account key support.

## Post-Verification Contract

After a live create/update:

1. Run `auditBillingGuard(projectId)`.
2. Locate the expected display name.
3. Compare currency, amount, and thresholds.
4. Return success only when `verifyBudgetEnsurePostState()` returns `verified: true`.
5. If create/update returns success but post-verification fails, return a structured failure. Do not claim the budget policy is configured.

Recommended error code:

```text
BUDGET_ENSURE_POST_VERIFY_FAILED
```

## Tests Required Before Opening Live CLI Mutation

- Create request payload has project scope, monthly period, specified amount, current-spend thresholds, and no notification rule. Implemented in contract tests.
- Update request payload includes the existing budget resource name and conservative update mask. Implemented in contract tests.
- `action: none` does not call the executor. Implemented in contract tests.
- `action: blocked` does not call the executor. Implemented in contract tests.
- Successful create/update runs post-verification through an injected audit provider. Implemented in contract tests.
- Post-verification failure returns `BUDGET_ENSURE_POST_VERIFY_FAILED` from the executor core. Implemented in contract tests.
- `--yes` without Trust Profile permission fails before executor invocation.
- Live transport/auth failure mapping is reviewed.
- CLI `--yes` wiring keeps approval and decision log behavior intact.
- No test uses live Google Cloud.

## Still Deferred

- Budget delete.
- Live Pub/Sub notification connection.
- Billing disable or billing unlink automation.
- MCP exposure for `budget ensure`.
