# Manual-First Cloud Write Boundaries

Status: accepted decision; live executors deferred

Decision date: 2026-04-28

This decision records which safety-adjacent cloud writes stay manual while `omg` continues to provide audit and dry-run planning.

## Decision

Keep these workflows manual-first and blocked in `omg` live execution:

- Pub/Sub topic creation for Cloud Billing budget alerts.
- Pub/Sub Publisher IAM grants for budget alert publishing.
- Budget notification rule live mutation.
- Pub/Sub subscription creation for budget alert ingestion.
- Pub/Sub Subscriber IAM grants for an ingestion handler.
- Budget alert ingestion handler deployment or runtime setup.
- Agent service account creation and project or billing IAM grants from `iam bootstrap`.

`omg` may inspect and plan these surfaces through:

```bash
omg --output json budget notifications audit --project <project-id> --topic budget-alerts
omg --output json budget notifications ensure --project <project-id> --topic budget-alerts --dry-run
omg --output json budget notifications lock-ingestion --project <project-id> --topic budget-alerts --dry-run
omg --output json iam plan --project <project-id>
omg --output json iam bootstrap --project <project-id> --dry-run
```

Supplying `--yes` to these blocked live setup paths must continue to return the current `*_LIVE_NOT_IMPLEMENTED` errors until a separate owner-approved executor exists.

## Rationale

These operations look like safety setup, but they are still cloud writes with permission, runtime, and cost implications.

- Pub/Sub topics and subscriptions create live cloud resources.
- Publisher and Subscriber bindings mutate IAM.
- Budget notification rule changes can affect billing alert routing.
- A budget alert handler needs durable runtime, message validation, acknowledgement, and local state write semantics.
- Agent service account creation and grants can widen blast radius if scope is too broad.

The safe current behavior is to let `omg` surface the exact missing pieces, then require an operator to apply them deliberately outside autonomous execution.

## Operator Path

Use this sequence when a real project needs budget alert routing:

1. Audit current posture:

   ```bash
   omg --output json budget notifications audit --project <project-id> --topic budget-alerts
   ```

2. If the topic is missing, create it manually in the intended project.
3. If Publisher readiness is missing, grant the minimum required Pub/Sub Publisher binding after checking the current Google Cloud budget notification guidance for the correct principal.
4. Re-run the audit until the topic state is `low`.
5. Plan the budget notification rule:

   ```bash
   omg --output json budget notifications ensure --project <project-id> --topic budget-alerts --dry-run
   ```

6. Apply the budget notification rule manually, or keep it deferred if the project is not ready.
7. Plan local cost lock ingestion:

   ```bash
   omg --output json budget notifications lock-ingestion --project <project-id> --topic budget-alerts --dry-run
   ```

8. Until a reviewed handler exists, operators should run local lock manually after a reviewed alert:

   ```bash
   omg --output json cost lock --project <project-id> --reason "budget alert reviewed"
   ```

Use this sequence when a project needs separated agent identities:

1. Inspect the plan:

   ```bash
   omg --output json iam plan --project <project-id>
   omg --output json iam bootstrap --project <project-id> --dry-run
   ```

2. Create service accounts manually only after owner review.
3. Apply the narrowest IAM grants manually. Prefer resource-level service account impersonation grants over broad project-level grants.
4. Re-run `omg iam audit --project <project-id>` and `omg iam plan --project <project-id>` to confirm the resulting state.

## Future Live Executor Criteria

Any future live executor for these workflows must be a new explicit decision, not an incremental change to the dry-run commands. Before opening live execution, require:

- Trust Profile intent classification and approval level.
- Dry-run and live request parity tests.
- Post-verification against the actual cloud state.
- Idempotency for existing resources and existing bindings.
- Rollback or cleanup guidance for partially applied resources.
- Explicit active account and project checks.
- Least-privilege IAM scope review.
- No secret values in logs, artifacts, or MCP responses.
- Contract tests that do not require live Google Cloud.

Until those criteria exist, manual-first is the supported production path.
