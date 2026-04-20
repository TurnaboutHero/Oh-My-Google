# Project Cleanup Audit Runbook

This Phase 3 surface separates read-only inspection from approval-gated lifecycle actions.

Commands:

- `omg project audit --project <id>`
- `omg project cleanup --project <id> --dry-run`
- `omg project delete --project <id>`
- `omg project undelete --project <id>`
- MCP tools `omg.project.audit`, `omg.project.cleanup`, `omg.project.delete`, and `omg.project.undelete`

`project audit` and `project cleanup --dry-run` never delete projects, disable APIs, change billing, or remove IAM bindings.
`project delete` is a separate L3 workflow and cannot execute without manual approval.
`project undelete` is also an L3 workflow. It only runs for projects whose lifecycle state is `DELETE_REQUESTED`.
Both delete and undelete approvals record the active gcloud account and fail with `ACCOUNT_MISMATCH` if another account tries to consume the approval.

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
omg --output json project delete --project citric-optics-380903 --expect-account owner@example.com
omg approve <approval-id>
omg --output json project delete --project citric-optics-380903 --approval <approval-id>
```

Deletion is blocked before approval when:

- the project is protected by built-in rules or by `OMG_PROTECTED_PROJECTS`
- audit risk is `do_not_touch`
- the caller does not have `roles/owner`
- billing is enabled

When deletion is allowed, `omg project delete` first creates an approval request. Only an approved matching request can trigger `gcloud projects delete <id> --quiet`.
The approval records the active gcloud account and cannot be consumed from a different active account.

## Undelete Workflow

```bash
omg --output json project undelete --project citric-optics-380903
omg --output json project undelete --project citric-optics-380903 --expect-account owner@example.com
omg approve <approval-id>
omg --output json project undelete --project citric-optics-380903 --approval <approval-id>
```

Undeletion is blocked before approval unless `gcloud projects describe <id>` reports `DELETE_REQUESTED`.
When undeletion is allowed, `omg project undelete` first creates an approval request. Only an approved matching request can trigger `gcloud projects undelete <id> --quiet`.
The approval records the active gcloud account and cannot be consumed from a different active account.
After a successful undelete, run `omg project audit --project <id>` to inspect the restored project before any follow-up deletion or cleanup.

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

```json
{
  "tool": "omg.project.undelete",
  "arguments": {
    "project": "citric-optics-380903"
  }
}
```

## Safety Notes

- Do not use this surface on `review-program-system`.
- Do not clean up folder-backed projects or projects where IAM visibility is missing.
- Billing-enabled projects are treated conservatively unless ownership and billing responsibility are confirmed.
- Run `omg doctor` before live project lifecycle operations to inspect both active gcloud and ADC account context.
- Live delete requires the L3 approval workflow and explicit user approval.
- Live undelete requires the L3 approval workflow and explicit user approval.
- If the active gcloud account changes between approval creation and execution, rerun the request with the intended account instead of reusing the stale approval.
- Use `--expect-account <email>` or MCP `expectAccount` when the intended account is known. This verifies the active account and does not modify global gcloud config.
- `PROJECT_ACCESS_DENIED` means the active gcloud account cannot access the target project; switch accounts or grant permissions before retrying.

## Smoke Record: 2026-04-18

Read-only audit was run against the three ambiguous projects:

| Project | Risk | Key Signals |
|---|---|---|
| `gen-lang-client-0379078037` | `review` | billing disabled, caller has `roles/owner`, `generativelanguage.googleapis.com` enabled |
| `quadratic-signifier-fmd0t` | `do_not_touch` | folder parent, billing enabled, IAM policy visibility missing, `express-mode` service account present |
| `citric-optics-380903` | `review` | billing disabled, caller has `roles/owner`, BigQuery/Gmail/Storage/Generative Language APIs enabled |

Cleanup dry-run was also run for `quadratic-signifier-fmd0t` and `citric-optics-380903`.
Both returned `allowedToExecute: false`; no live cleanup action was available or executed.

## Live Deletion Record: 2026-04-18

The user explicitly approved deletion of only these two stale projects:

- `gen-lang-client-0379078037`
- `citric-optics-380903`

Excluded projects:

- `quadratic-signifier-fmd0t`
- `<live-validation-project>`
- `review-program-system`

Execution path:

1. `omg --output json project delete --project <id>` created an approval request.
2. `omg --output json approve <approval-id>` approved the request with an explicit reason.
3. `omg --output json project delete --project <id> --approval <approval-id>` executed `gcloud projects delete <id> --quiet`.
4. `gcloud projects describe <id> --format=value(lifecycleState)` verified `DELETE_REQUESTED`.

Results:

| Project | Approval ID | Verified Lifecycle State |
|---|---|---|
| `gen-lang-client-0379078037` | `apr_20260418_125505_b40e0f` | `DELETE_REQUESTED` |
| `citric-optics-380903` | `apr_20260418_125543_925c3f` | `DELETE_REQUESTED` |

Protected project verification after deletion:

| Project | Lifecycle State |
|---|---|
| `quadratic-signifier-fmd0t` | `ACTIVE` |
| `<live-validation-project>` | `ACTIVE` |
| `review-program-system` | `ACTIVE` |

## Live Undelete Record: 2026-04-20

The previously deleted stale projects `gen-lang-client-0379078037` and `citric-optics-380903` were not recoverable by the active gcloud account during this run; both `describe` and direct `projects undelete` returned permission errors.

An isolated disposable project was created to verify the real lifecycle workflow:

| Project | Step | Approval ID | Verified Lifecycle State |
|---|---|---|---|
| `omg-restore-260420-1107` | create | n/a | `ACTIVE` |
| `omg-restore-260420-1107` | `omg project delete` | `apr_20260420_020752_5f9779` | `DELETE_REQUESTED` |
| `omg-restore-260420-1107` | `omg project undelete` | `apr_20260420_020906_40fc18` | `ACTIVE` |
| `omg-restore-260420-1107` | final `omg project delete` | `apr_20260420_021147_1c9ee9` | `DELETE_REQUESTED` |

This run also exposed that delete approval hashes must not include volatile enabled-service metadata. The approval hash was narrowed to stable delete arguments so post-restore service activation does not invalidate an otherwise matching project delete approval.
