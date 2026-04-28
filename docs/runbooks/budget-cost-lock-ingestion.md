# Budget Alert To Cost Lock Ingestion

Status: dry-run planning only; live subscription, IAM, and handler setup are blocked

This runbook covers:

- `omg budget notifications lock-ingestion --project <id> --topic <topic> --dry-run`

The goal is to describe the safe path from a Cloud Billing Budget Pub/Sub alert to local `.omg/cost-lock.json`. The current implementation does not create Pub/Sub subscriptions, grant subscriber IAM, deploy handlers, or mutate local cost lock from a cloud event.

## Why This Is Not Automatic Yet

Cloud Billing budgets can publish alerts to Pub/Sub, but local cost lock is workspace-local state. Bridging those two requires an always-on subscriber or handler that can:

- receive Pub/Sub budget messages
- validate the project and budget
- write `.omg/cost-lock.json`
- acknowledge the message only after the lock write succeeds
- avoid automatic unlocks

That handler has its own trust, IAM, runtime, and operational risks, so `omg` only plans it for now.

## Dry-Run

```bash
omg --output json budget notifications lock-ingestion --project <project-id> --topic budget-alerts --dry-run
```

The command runs:

- budget guard audit
- budget notification routing plan
- Pub/Sub topic/IAM audit

It returns:

- `status`: `ready`, `review`, or `blocked`
- `subscriptionCommand`: preview command for a dedicated subscription
- `handlerResponsibilities`: requirements the handler must satisfy
- `costLockCommand`: local lock command the handler would run
- `manualSteps`: subscription, subscriber permission, handler, and local lock review items
- `blockers` and `warnings`

## Status Values

| Status | Meaning |
|---|---|
| `ready` | Budget notification routing and Pub/Sub Publisher readiness are visible. Handler implementation can be reviewed. |
| `review` | Budget notification routing still needs an update before ingestion can work. |
| `blocked` | Budget audit, target budget, topic existence, or topic IAM readiness blocks the plan. |

## Live Gate

Without `--dry-run`, the command returns `TRUST_REQUIRES_CONFIRM`.

With `--yes`, live setup is still blocked:

```text
BUDGET_LOCK_INGESTION_LIVE_NOT_IMPLEMENTED
```

Live setup remains deferred until all of these are designed and verified:

1. Dedicated Pub/Sub subscription creation.
2. Narrow `roles/pubsub.subscriber` grant for the selected handler identity.
3. Handler runtime choice: local daemon, CI runner, Cloud Run, or other reviewed environment.
4. Budget message validation against expected project and budget.
5. Local cost lock write semantics and concurrency behavior.
6. Pub/Sub acknowledgement only after the local lock write succeeds.
7. Operator-only unlock policy.

## Example Handler Action

The handler action should be equivalent to:

```bash
omg cost lock --project <project-id> --reason "budget Pub/Sub alert received from projects/<topic-project>/topics/<topic-id>"
```

It should never run `omg cost unlock`.

## Safety Boundary

This workflow is not:

- a Google Cloud hard spend cap
- a replacement for budget audit
- live Budget API mutation
- live Pub/Sub subscription creation
- live IAM grant automation
- a deployed handler

Until live setup exists, operators should run `omg cost lock` manually after reviewing budget alerts.
