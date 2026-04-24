# Firestore Audit Runbook

This Phase 4 surface starts resource workflows with read-only Firestore inspection. It does not create databases, delete databases, export/import data, read documents, write documents, or mutate indexes.

Commands:

- `omg firestore audit --project <id>`
- MCP tool `omg.firestore.audit`

## Audit

```bash
omg --output json firestore audit --project my-project
```

MCP equivalent:

```json
{ "tool": "omg.firestore.audit", "arguments": { "project": "my-project" } }
```

The audit gathers:

- visible Firestore databases
- database location and mode metadata when available
- delete protection and point-in-time recovery flags when available
- visible composite indexes
- inaccessible index sections

Risk states:

- `low`: no Firestore databases were visible
- `review`: Firestore databases, indexes, disabled protection signals, or partial audit failures were found

## Safety Notes

- Firestore create/delete/export/import/data mutation workflows are not implemented.
- Treat `risk: review` as a blocker before adding Firestore write workflows.
- Do not use raw downstream Firestore MCP tools for data mutation unless they are routed through `omg` safety checks.
- Any future Firestore live write or provisioning workflow must be classified as an `OperationIntent`; if cost-bearing, it must require budget guard.

## Output Shape

```json
{
  "ok": true,
  "command": "firestore:audit",
  "data": {
    "projectId": "my-project",
    "databases": [
      {
        "name": "projects/my-project/databases/(default)",
        "databaseId": "(default)",
        "locationId": "nam5",
        "type": "FIRESTORE_NATIVE",
        "pointInTimeRecoveryEnablement": "POINT_IN_TIME_RECOVERY_DISABLED",
        "deleteProtectionState": "DELETE_PROTECTION_DISABLED"
      }
    ],
    "compositeIndexes": [],
    "inaccessible": [],
    "signals": [
      "1 Firestore database(s) visible.",
      "Delete protection is disabled for Firestore database (default).",
      "Point-in-time recovery is disabled for Firestore database (default)."
    ],
    "risk": "review",
    "recommendedAction": "Review Firestore databases before adding create, delete, export, import, or data mutation workflows."
  },
  "next": [
    "Review Firestore databases before adding create, delete, export, import, or data mutation workflows."
  ]
}
```
