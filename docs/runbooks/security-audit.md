# Security Audit Runbook

This Phase 3F surface adds a read-only security posture rollup. It does not call Security Command Center or enable new Google APIs. It combines the existing project, IAM, and budget guard audits into one structured summary.

Commands:

- `omg security audit --project <id>`
- MCP tool `omg.security.audit`

`security audit` never creates, updates, deletes, grants, revokes, enables, disables, links billing, or mutates IAM policy. It only reads through existing audit connectors.

## Audit

```bash
omg --output json security audit --project my-project
```

MCP equivalent:

```json
{ "tool": "omg.security.audit", "arguments": { "project": "my-project" } }
```

The audit combines:

- project lifecycle and cleanup risk
- visible IAM policy and service account posture
- billing budget guard state

Risk states:

- `low`: no broad posture risk signals detected
- `review`: non-blocking findings or partial audit failures require review
- `high`: project `do_not_touch` or high-risk IAM findings require manual review

## Output Shape

```json
{
  "ok": true,
  "command": "security:audit",
  "data": {
    "projectId": "my-project",
    "sections": {
      "project": {
        "ok": true,
        "risk": "low",
        "signals": [],
        "summary": {
          "lifecycleState": "ACTIVE",
          "billingEnabled": false,
          "callerRoles": ["roles/owner"],
          "enabledServiceCount": 0,
          "serviceAccountCount": 0,
          "inaccessible": []
        }
      },
      "iam": {
        "ok": true,
        "risk": "review",
        "signals": ["Primitive project role should be reviewed before adding IAM automation. Role: roles/owner."],
        "summary": {
          "bindingCount": 1,
          "serviceAccountCount": 0,
          "findingCount": 1,
          "highFindingCount": 0,
          "inaccessible": []
        }
      },
      "budget": {
        "ok": true,
        "risk": "configured",
        "signals": ["Budget configured: Monthly cap."],
        "summary": {
          "billingEnabled": true,
          "billingAccountId": "ABC-123",
          "budgetCount": 1,
          "inaccessible": []
        }
      }
    },
    "signals": [
      "IAM: Primitive project role should be reviewed before adding IAM automation. Role: roles/owner.",
      "Budget: Budget configured: Monthly cap."
    ],
    "risk": "review",
    "recommendedAction": "Review security audit findings before adding new live operations."
  },
  "next": ["Review security audit findings before adding new live operations."]
}
```

## Safety Notes

- Treat `risk: high` as a blocker for autonomous live operations until a human reviews the findings.
- Treat section errors as partial audit results, not proof that the project is safe.
- `security audit` is not a replacement for organization-level Security Command Center.
- `notify` remains deferred; no external notification channels are configured by this surface.
