# Agent IAM Planning

Status: plan and dry-run only; live service account creation and IAM grants are blocked

This runbook covers:

- `omg iam plan --project <id> [--prefix <name>]`
- `omg iam bootstrap --project <id> [--prefix <name>] --dry-run`

The goal is permission separation for agent operation. The current implementation proposes identities and grants, but never creates service accounts or mutates IAM policy.

## Identity Split

The default prefix is `omg-agent`, producing:

| Identity | Purpose |
|---|---|
| `omg-agent-auditor@<project>.iam.gserviceaccount.com` | Read-only posture checks and resource metadata inspection |
| `omg-agent-deployer@<project>.iam.gserviceaccount.com` | Live deploy execution after trust, cost-lock, and budget guard checks pass |
| `omg-agent-secret-admin@<project>.iam.gserviceaccount.com` | Secret Manager workflows separated from deploy identity |

The plan intentionally keeps high-impact bootstrap permissions out of always-on agent identities.

## Plan

```bash
omg --output json iam plan --project <project-id>
```

The command:

- runs read-only IAM audit
- checks whether the proposed service accounts are already visible
- checks whether proposed project-level grants are already present
- returns create/grant command previews
- returns manual review actions for scoped service-account impersonation and billing visibility

Status values:

- `ready`: no blockers and no missing visible project-level grants
- `review`: the plan has missing grants, missing service accounts, manual review actions, or review-level IAM findings
- `blocked`: IAM policy or service account visibility is unsafe, or audit risk is high

## Bootstrap Dry-Run

```bash
omg --output json iam bootstrap --project <project-id> --dry-run
```

The dry-run returns the same plan plus:

```json
{
  "dryRun": true,
  "liveMutation": false
}
```

Without `--dry-run`, the command returns `TRUST_REQUIRES_CONFIRM`.

With `--yes`, live execution is still blocked:

```text
IAM_BOOTSTRAP_LIVE_NOT_IMPLEMENTED
```

## Manual-First Decision

Live agent IAM bootstrap remains manual-first. `omg` may propose separated auditor, deployer, and secret-admin identities, but it must not create service accounts or apply project, resource, or billing IAM grants. The accepted boundary is documented in [manual-first-cloud-writes.md](./manual-first-cloud-writes.md).

## Manual Review Items

The plan keeps these out of automatic execution:

- `roles/iam.serviceAccountUser` should be granted on the selected Cloud Run runtime service account, not broadly at project scope, unless the owner explicitly approves broad scope.
- `roles/billing.viewer` may be needed on the linked billing account for budget visibility, which cannot be fully inferred from project IAM policy alone.
- `roles/serviceusage.serviceUsageAdmin`, `roles/resourcemanager.projectIamAdmin`, and billing-link permissions should stay human-run until a separate owner-approved bootstrap workflow exists.

## Safety Boundary

Agent IAM planning is not:

- service account creation
- IAM policy mutation
- billing account IAM mutation
- runtime service account impersonation grant
- MCP exposure for IAM bootstrap

MCP exposes `omg.iam.audit`, `omg.iam.plan`, and `omg.iam.bootstrap`. Agent IAM planning and bootstrap are still read-only/dry-run through MCP; live service account creation and IAM grants remain blocked until a dedicated executor and post-verification path are reviewed.

## Verification

Automated coverage includes:

- separated identity plan generation
- blocker behavior when IAM visibility is unsafe
- prefix validation
- `iam plan` command behavior
- `iam bootstrap --dry-run` behavior
- blocked live bootstrap behavior
- safety intent and command mapping for `iam.plan` and `iam.bootstrap`
