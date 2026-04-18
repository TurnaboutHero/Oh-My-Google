# Secret Admin Runbook

Phase 3 starts with the narrow Secret Manager admin surface:

- `omg secret list`
- `omg secret set <name>`
- MCP tools `omg.secret.list` and `omg.secret.set`

This surface does not read or print secret payloads. Secret values are accepted only as write inputs and are redacted from command output, approval args, and test assertions.

Both commands require `.omg/trust.yaml`; `--project` may only target the project recorded in that trust profile.

## Cost Boundary

Do not run live secret commands without checking cost and getting explicit approval.

As of the Google Cloud Secret Manager pricing page checked on 2026-04-18:

- Management operations, including creating secrets, are listed as free.
- Active secret versions and access operations have monthly free usage limits.
- Usage is aggregated across projects by billing account.

For this project, keep live tests within the free tier and prefer dry-runs unless the user approves the exact live action.

## List Secrets

```bash
omg --output json secret list --limit 20
```

MCP equivalent:

```json
{ "tool": "omg.secret.list", "arguments": { "limit": 20 } }
```

The command returns metadata only:

```json
{
  "ok": true,
  "command": "secret:list",
  "data": {
    "projectId": "demo-project",
    "secrets": [
      {
        "name": "API_KEY",
        "resourceName": "projects/demo-project/secrets/API_KEY",
        "replication": "automatic"
      }
    ]
  }
}
```

## Dry-Run A Write

```bash
omg --output json secret set API_KEY --value-file .secrets/api-key.txt --dry-run
```

MCP equivalent:

```json
{
  "tool": "omg.secret.set",
  "arguments": {
    "name": "API_KEY",
    "valueFile": ".secrets/api-key.txt",
    "dryRun": true
  }
}
```

Dry-run does not call `gcloud` and does not require trust confirmation.

## Write A Secret

```bash
omg --output json secret set API_KEY --value-file .secrets/api-key.txt --yes
```

Behavior:

- If the secret exists, omg runs `gcloud secrets versions add API_KEY --data-file=<temp-or-input-file>`.
- If the secret is missing, omg runs `gcloud secrets create API_KEY --replication-policy=automatic --data-file=<temp-or-input-file>`.
- The output reports `created` and `versionAdded`, not the secret value.

Prefer `--value-file` over `--value` so the secret value is not stored in shell history.

## Trust Rules

`secret.list` is L0.

`secret.set` is L2:

- `dev`: requires `--yes` in JSON mode.
- `staging`: requires manual approval by default.
- `prod`: requires manual approval by default.

If approval is required, rerun with the approval ID after approval:

```bash
omg approve <approval-id>
omg --output json secret set API_KEY --value-file .secrets/api-key.txt --approval <approval-id>
```
