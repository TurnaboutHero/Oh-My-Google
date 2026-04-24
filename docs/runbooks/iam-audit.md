# IAM Audit Runbook

This Phase 3F surface adds read-only IAM inspection before any IAM write workflow exists.

Commands:

- `omg iam audit --project <id>`
- MCP tool `omg.iam.audit`

`iam audit` never grants roles, revokes roles, creates service accounts, deletes service accounts, or changes IAM policy. It only reads visible IAM policy bindings and service account metadata.

## Audit

```bash
omg --output json iam audit --project my-project
```

MCP equivalent:

```json
{ "tool": "omg.iam.audit", "arguments": { "project": "my-project" } }
```

The audit gathers:

- IAM policy bindings visible to the active gcloud account
- service account metadata visible in the project
- public principals such as `allUsers` and `allAuthenticatedUsers`
- primitive project roles such as `roles/owner` and `roles/editor`
- high-impact IAM administration roles
- inaccessible audit areas

Risk states:

- `low`: no broad IAM risk signals detected
- `review`: privileged bindings or service accounts should be reviewed
- `high`: public IAM bindings or missing IAM policy visibility require manual review

## Output Shape

```json
{
  "ok": true,
  "command": "iam:audit",
  "data": {
    "projectId": "my-project",
    "bindings": [
      {
        "role": "roles/owner",
        "members": ["user:owner@example.com"],
        "memberCount": 1,
        "public": false,
        "primitive": true
      }
    ],
    "serviceAccounts": [],
    "findings": [
      {
        "severity": "review",
        "reason": "Primitive project role should be reviewed before adding IAM automation.",
        "role": "roles/owner"
      }
    ],
    "inaccessible": [],
    "signals": [
      "Primitive project role should be reviewed before adding IAM automation. Role: roles/owner."
    ],
    "risk": "review",
    "recommendedAction": "Review privileged IAM bindings and service accounts before adding IAM writes."
  },
  "next": ["Review privileged IAM bindings before adding IAM write automation."]
}
```

## Safety Notes

- IAM writes remain deferred.
- Do not use raw downstream Google/Firebase MCP IAM tools for privileged changes unless they are routed through `omg` safety checks.
- Treat `risk: high` as a blocker for autonomous IAM write design.
- If `inaccessible` includes `iam policy`, review the project manually before trusting any partial audit result.
- Run `omg auth context` before interpreting audit results if multiple gcloud accounts or configurations are in use.
