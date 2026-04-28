# Budget Notifications

Status: audit and dry-run planning only; live mutation is blocked

This runbook covers:

- `omg budget notifications audit --project <id> [--topic <topic>]`
- `omg budget notifications ensure --project <id> --topic <topic> --dry-run`
- `omg budget notifications lock-ingestion --project <id> --topic <topic> --dry-run`

The current implementation never creates Pub/Sub topics, mutates budget notification rules, creates subscriptions, grants IAM, starts handlers, or sends external notifications. It can read a target topic and topic IAM policy. Supplying `--yes` to notification ensure returns `BUDGET_NOTIFICATIONS_LIVE_NOT_IMPLEMENTED`; supplying `--yes` to lock-ingestion returns `BUDGET_LOCK_INGESTION_LIVE_NOT_IMPLEMENTED`.

## Official API Grounding

Cloud Billing budgets can publish programmatic notifications to a Pub/Sub topic through `notificationsRule.pubsubTopic`.

Relevant official behavior:

- `notificationsRule.pubsubTopic` uses `projects/{projectId}/topics/{topic_id}`.
- `notificationsRule.schemaVersion` is required when `pubsubTopic` is set, and only `1.0` is accepted.
- The Pub/Sub topic must already exist before connecting it to a budget.
- The API caller needs `pubsub.topics.setIamPolicy` on the target topic when connecting the topic.
- Budget Pub/Sub notifications are alerts and data feeds; they do not stop billing or cap spend by themselves.

Sources:

- https://docs.cloud.google.com/billing/docs/reference/budget/rest/v1/billingAccounts.budgets
- https://docs.cloud.google.com/billing/docs/how-to/budgets-programmatic-notifications

## Audit

Use audit to inspect whether visible budgets already have Pub/Sub notification routing:

```bash
omg --output json budget notifications audit --project <project-id>
```

Pass `--topic` to also inspect a target Pub/Sub topic and topic IAM policy:

```bash
omg --output json budget notifications audit --project <project-id> --topic budget-alerts
```

Possible `posture` values:

- `configured`: every visible budget has a Pub/Sub topic and schema version `1.0`.
- `partial`: at least one visible budget has incomplete notification routing, or only some visible budgets are configured.
- `none`: no visible budgets have Pub/Sub notification routing.
- `blocked`: budget visibility is incomplete, billing is disabled, or no billing account is visible.

The command is read-only and uses the existing budget audit path. When `--topic` is supplied, it also runs:

```bash
gcloud pubsub topics describe <topic-id> --project=<topic-project-id> --format=json
gcloud pubsub topics get-iam-policy <topic-id> --project=<topic-project-id> --format=json
```

Topic audit `risk` values:

- `low`: topic exists and a `roles/pubsub.publisher` binding is visible.
- `missing_topic`: the topic does not exist or is not visible.
- `missing_publisher`: topic IAM is visible, but no Pub/Sub Publisher binding is visible.
- `review`: topic or topic IAM cannot be fully inspected.

## Ensure Dry-Run

Use ensure dry-run to plan the expected notification route for the named budget:

```bash
omg --output json budget notifications ensure --project <project-id> --topic budget-alerts --dry-run
```

`--topic` can be either:

- a bare topic ID, resolved to `projects/<project-id>/topics/<topic-id>`
- a full topic resource, such as `projects/finops-admin/topics/budget-alerts`

The target budget defaults to:

```text
omg budget guard: <project-id>
```

Use `--display-name` to target a different visible budget.

Dry-run actions:

- `none`: the expected Pub/Sub topic and schema are already visible.
- `update`: the target budget exists but needs a `notificationsRule` update.
- `blocked`: budget audit failed, the target budget is not visible, the Pub/Sub topic is missing, or topic IAM/Publisher readiness is not visible.

The dry-run mutation contract is:

```json
{
  "action": "update",
  "name": "billingAccounts/ABC-123/budgets/budget-1",
  "updateMask": ["notificationsRule"],
  "budget": {
    "name": "billingAccounts/ABC-123/budgets/budget-1",
    "notificationsRule": {
      "pubsubTopic": "projects/demo-project/topics/budget-alerts",
      "schemaVersion": "1.0"
    }
  }
}
```

Existing email notification settings from `notificationsRule` are preserved in the planned rule when visible.

## Live Mutation Gate

Manual-first decision: `omg` does not create Pub/Sub topics or grant Pub/Sub Publisher IAM for budget notifications. Operators must apply those cloud writes deliberately, then re-run audit/ensure dry-run to verify readiness. The accepted boundary is documented in [manual-first-cloud-writes.md](./manual-first-cloud-writes.md).

Live notification updates remain deferred until all conditions are true:

1. Budget policy ensure has a live executor and post-verification path.
2. Pub/Sub topic existence and topic IAM readiness are visible.
3. Any change from manual Pub/Sub topic/IAM setup to a live workflow has owner approval, post-verification, and cleanup design.
4. Budget notification update is routed through Trust Profile L2 approval semantics.
5. Post-verification confirms the visible budget has the expected topic and schema.

Until then:

```bash
omg --output json budget notifications ensure --project <project-id> --topic budget-alerts --yes
```

returns:

```text
BUDGET_NOTIFICATIONS_LIVE_NOT_IMPLEMENTED
```

## Cost Lock Ingestion Dry-Run

Use this path to plan, but not create, a Budget Pub/Sub alert subscriber that would set local cost lock:

```bash
omg --output json budget notifications lock-ingestion --project <project-id> --topic budget-alerts --dry-run
```

The plan checks budget notification routing and Pub/Sub topic/IAM readiness, then returns:

- subscription command preview
- handler responsibilities
- the local `omg cost lock` command the handler would run
- manual steps for subscriber permission and runtime review

Live subscription creation, subscriber IAM grants, and handler setup are intentionally blocked. Detailed behavior is tracked in [budget-cost-lock-ingestion.md](./budget-cost-lock-ingestion.md).

## Still Deferred

- Creating Pub/Sub topics.
- Granting Pub/Sub IAM.
- Live automatic notification ingestion to `cost lock`.
- Live agent IAM bootstrap for notification or ingestion identities.
- Slack, Discord, webhook, email, or other external notification senders.

## MCP Tools

The safe audit and dry-run planning surfaces are also exposed through MCP:

- `omg.budget.notifications.audit`
- `omg.budget.notifications.ensure`
- `omg.budget.notifications.lock_ingestion`
