# Budget Ensure Live Executor Design

Status: injected executor core and live gate contract tests exist; live CLI mutation is still blocked

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
- https://docs.cloud.google.com/billing/docs/authentication
- https://docs.cloud.google.com/sdk/gcloud/reference/auth/print-access-token
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

The live gate contract lives in `src/connectors/budget-live-gate.ts` and fixes the non-negotiable behavior before live CLI wiring:

- live CLI status remains `blocked` with `BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED`
- transport uses the Cloud Billing Budget API base URL, an access token from `gcloud auth print-access-token`, and `x-goog-user-project`
- Trust Profile handling uses `budget.ensure` as L2
- approval args are hash-bound to project ID, amount, currency, thresholds, and display name
- decision logging must cover `live-gate`, `api-mutation`, and `post-verify` phases
- post-verification failure maps to `BUDGET_ENSURE_POST_VERIFY_FAILED` with audit and dry-run next steps
- retryable transport failures are limited to `BUDGET_API_RATE_LIMITED` and `BUDGET_API_UNAVAILABLE`
- auth, account mismatch, permission, not found, validation, conflict, and unknown request failures are non-retryable until the operator rechecks context/audit/dry-run output

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

## Transport Failure Mapping

The live transport failure mapper is implemented without making live calls:

- Token command failures:
  - `NO_AUTH`: gcloud has no usable active auth context.
  - `ACCOUNT_MISMATCH`: active account differs from the expected account.
  - `BUDGET_API_TOKEN_COMMAND_FAILED`: token command failed for another reason.
- HTTP failures:
  - `400` -> `BUDGET_API_INVALID_REQUEST`, non-retryable.
  - `401` -> `BUDGET_API_UNAUTHENTICATED`, non-retryable until auth is inspected.
  - `403` -> `BUDGET_API_PERMISSION_DENIED`, non-retryable until permissions are fixed.
  - `404` -> `BUDGET_API_NOT_FOUND`, non-retryable until budget audit/dry-run is refreshed.
  - `409` -> `BUDGET_API_CONFLICT`, non-retryable until audit/dry-run is refreshed.
  - `429` -> `BUDGET_API_RATE_LIMITED`, retryable after backoff.
  - `5xx` -> `BUDGET_API_UNAVAILABLE`, retryable after backoff.

The mapper can return `retryable: true`, but live CLI wiring must still avoid blind repeat execution after a write. Retry policy must be explicit in the caller.

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
- CLI/MCP-shaped error envelope for `BUDGET_ENSURE_POST_VERIFY_FAILED` includes `liveMutationAttempted`, mutation action, post-verification details, and audit/dry-run next steps. Implemented in live gate contract tests.
- `--yes` without Trust Profile permission fails before executor invocation.
- Live transport/auth failure mapping is implemented as a pure contract without cloud calls.
- Live transport implementation is reviewed.
- CLI `--yes` wiring keeps approval and decision log behavior intact.
- No test uses live Google Cloud.

## Still Deferred

- Budget delete.
- Live Pub/Sub notification connection.
- Billing disable or billing unlink automation.
- MCP exposure for `budget ensure`.
