# Project Cleanup Audit Runbook

This Phase 3 surface is intentionally read-only.

Commands:

- `omg project audit --project <id>`
- `omg project cleanup --project <id> --dry-run`
- MCP tools `omg.project.audit` and `omg.project.cleanup`

No command in this surface deletes projects, disables APIs, changes billing, or removes IAM bindings.

## Audit

```bash
omg --output json project audit --project citric-optics-380903
```

The audit gathers available metadata:

- project metadata
- billing link status
- caller IAM visibility and roles
- enabled services
- service accounts

The result includes a conservative risk classification:

- `low`: no obvious risk signals found
- `review`: ownership or prior-use signals require console review before cleanup
- `do_not_touch`: ownership, billing, folder, or permission boundaries are unclear

## Cleanup Dry-Run

```bash
omg --output json project cleanup --project citric-optics-380903 --dry-run
```

This returns a plan only. `allowedToExecute` is always `false`.

## MCP Examples

```json
{ "tool": "omg.project.audit", "arguments": { "project": "citric-optics-380903" } }
```

```json
{
  "tool": "omg.project.cleanup",
  "arguments": {
    "project": "citric-optics-380903",
    "dryRun": true
  }
}
```

## Safety Notes

- Do not use this surface on `review-program-system`.
- Do not clean up folder-backed projects or projects where IAM visibility is missing.
- Billing-enabled projects are treated conservatively unless ownership and billing responsibility are confirmed.
- Any future live delete workflow must be a separate L3 workflow with explicit user approval.

## Smoke Record: 2026-04-18

Read-only audit was run against the three ambiguous projects:

| Project | Risk | Key Signals |
|---|---|---|
| `gen-lang-client-0379078037` | `review` | billing disabled, caller has `roles/owner`, `generativelanguage.googleapis.com` enabled |
| `quadratic-signifier-fmd0t` | `do_not_touch` | folder parent, billing enabled, IAM policy visibility missing, `express-mode` service account present |
| `citric-optics-380903` | `review` | billing disabled, caller has `roles/owner`, BigQuery/Gmail/Storage/Generative Language APIs enabled |

Cleanup dry-run was also run for `quadratic-signifier-fmd0t` and `citric-optics-380903`.
Both returned `allowedToExecute: false`; no live cleanup action was available or executed.
