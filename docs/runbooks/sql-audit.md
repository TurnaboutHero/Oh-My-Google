# Cloud SQL Audit Runbook

This Phase 4 surface adds read-only Cloud SQL inspection. It does not create instances, delete instances, connect to databases, read database data, export/import data, change backups, or mutate authorized networks.

Commands:

- `omg sql audit --project <id>`
- MCP tool `omg.sql.audit`

## Audit

```bash
omg --output json sql audit --project my-project
```

MCP equivalent:

```json
{ "tool": "omg.sql.audit", "arguments": { "project": "my-project" } }
```

The audit gathers:

- visible Cloud SQL instances
- database version, region, state, availability type, backup/PITR, public IPv4, authorized networks, and deletion protection metadata when available
- visible backup runs per instance
- public authorized-network findings
- inaccessible backup sections

Risk states:

- `low`: no Cloud SQL instances were visible
- `review`: instances, review posture signals, or partial audit failures were found
- `high`: an authorized network is open to the public internet

## Safety Notes

- Cloud SQL instance, backup, network, export/import, and lifecycle write workflows are not implemented.
- Treat `risk: high` as a blocker before autonomous SQL-related live operations.
- Do not use raw downstream Cloud SQL MCP tools for instance, network, backup, or data mutation unless they are routed through `omg` safety checks.
- Any future SQL live workflow must be classified as an `OperationIntent`; if cost-bearing, it must require budget guard.

## Output Shape

```json
{
  "ok": true,
  "command": "sql:audit",
  "data": {
    "projectId": "my-project",
    "instances": [
      {
        "name": "orders-db",
        "databaseVersion": "POSTGRES_15",
        "region": "asia-northeast3",
        "state": "RUNNABLE",
        "availabilityType": "ZONAL",
        "backupEnabled": true,
        "pointInTimeRecoveryEnabled": false,
        "ipv4Enabled": true,
        "authorizedNetworks": ["0.0.0.0/0"],
        "deletionProtectionEnabled": false
      }
    ],
    "backups": [
      {
        "instance": "orders-db",
        "id": "backup-1",
        "status": "SUCCESSFUL",
        "type": "AUTOMATED",
        "windowStartTime": "2026-04-24T00:00:00Z"
      }
    ],
    "findings": [
      {
        "severity": "high",
        "reason": "Cloud SQL authorized network is open to the public internet.",
        "instance": "orders-db",
        "network": "0.0.0.0/0"
      }
    ],
    "inaccessible": [],
    "signals": [
      "1 Cloud SQL instance(s) visible.",
      "Point-in-time recovery is disabled for Cloud SQL instance orders-db.",
      "Deletion protection is disabled for Cloud SQL instance orders-db.",
      "Public IPv4 is enabled for Cloud SQL instance orders-db.",
      "Cloud SQL authorized network is open to the public internet. Instance: orders-db. Network: 0.0.0.0/0."
    ],
    "risk": "high",
    "recommendedAction": "Review public Cloud SQL network exposure before adding instance, backup, export, import, or lifecycle workflows."
  },
  "next": [
    "Review public Cloud SQL network exposure before adding instance, backup, export, import, or lifecycle workflows."
  ]
}
```
