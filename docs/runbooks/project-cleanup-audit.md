# Project Cleanup Audit Runbook

This Phase 3 surface is intentionally read-only.

Commands:

- `omg project audit --project <id>`
- `omg project cleanup --project <id> --dry-run`
- `omg project delete --project <id>`
- MCP tools `omg.project.audit`, `omg.project.cleanup`, and `omg.project.delete`

`project audit` and `project cleanup --dry-run` never delete projects, disable APIs, change billing, or remove IAM bindings.
`project delete` is a separate L3 workflow and cannot execute without manual approval.

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

## Delete Workflow

```bash
omg --output json project delete --project citric-optics-380903
omg approve <approval-id>
omg --output json project delete --project citric-optics-380903 --approval <approval-id>
```

Deletion is blocked before approval when:

- the project is protected: `review-program-system`, `<live-validation-project>`, or `quadratic-signifier-fmd0t`
- audit risk is `do_not_touch`
- the caller does not have `roles/owner`
- billing is enabled

When deletion is allowed, `omg project delete` first creates an approval request. Only an approved matching request can trigger `gcloud projects delete <id> --quiet`.

## MCP Examples

```json
{ "tool": "omg.project.audit", "arguments": { "project": "citric-optics-380903" } }
```

```json
{
  "tool": "omg.project.delete",
  "arguments": {
    "project": "citric-optics-380903"
  }
}
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
- Live delete requires the L3 approval workflow and explicit user approval.

## Smoke Record: 2026-04-18

Read-only audit was run against the three ambiguous projects:

| Project | Risk | Key Signals |
|---|---|---|
| `gen-lang-client-0379078037` | `review` | billing disabled, caller has `roles/owner`, `generativelanguage.googleapis.com` enabled |
| `quadratic-signifier-fmd0t` | `do_not_touch` | folder parent, billing enabled, IAM policy visibility missing, `express-mode` service account present |
| `citric-optics-380903` | `review` | billing disabled, caller has `roles/owner`, BigQuery/Gmail/Storage/Generative Language APIs enabled |

Cleanup dry-run was also run for `quadratic-signifier-fmd0t` and `citric-optics-380903`.
Both returned `allowedToExecute: false`; no live cleanup action was available or executed.
