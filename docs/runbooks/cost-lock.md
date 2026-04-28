# Local Cost Lock

Status: local operator-controlled blocker; no Google Cloud state is changed

This runbook covers:

- `omg cost status [--project <id>]`
- `omg cost lock --project <id> --reason <text> [--locked-by <actor>]`
- `omg cost unlock --project <id> --yes`

Cost lock is a local safety brake for agents. It stores project-scoped lock records in `.omg/cost-lock.json` and blocks currently known cost-bearing live `omg` operations before budget audit or cloud execution.

## What It Blocks

An active lock blocks:

- live `omg deploy`
- live `omg firebase deploy --execute`
- live `omg secret set`
- `omg init` before billing link, default API enablement, and IAM setup

Dry-runs and read-only commands remain available.

The failure code is:

```text
COST_LOCKED
```

The structured response includes a `next` hint for:

```bash
omg cost status --project <project-id>
```

## Lock

Create or refresh a project lock:

```bash
omg --output json cost lock --project <project-id> --reason "budget alert threshold exceeded"
```

Optional actor override:

```bash
omg --output json cost lock --project <project-id> --reason "manual freeze" --locked-by ops@example.com
```

Rules:

- The command writes only `.omg/cost-lock.json`.
- A valid project ID and non-empty reason are required.
- The reason is capped at 240 characters.
- The command writes a decision-log event.

## Status

Read all local locks:

```bash
omg --output json cost status
```

Read a single project:

```bash
omg --output json cost status --project <project-id>
```

Status reports:

- `locked`
- `lock` for the requested project when present
- `locks` for all known local locks
- `path`, currently `.omg/cost-lock.json`

## Unlock

Unlock requires explicit confirmation:

```bash
omg --output json cost unlock --project <project-id> --yes
```

Without `--yes`, the command returns `TRUST_REQUIRES_CONFIRM`.

Unlock only changes local state. It does not verify budget posture, change billing settings, or mutate cloud resources.

## Safety Boundary

Cost lock is not:

- a Google Cloud hard spend cap
- a Budget API mutation
- an automatic budget alert response
- protection against raw `gcloud`, raw Firebase CLI, or console actions outside `omg`

Budget Pub/Sub notification ingestion is still deferred. Until that exists, an operator or agent must explicitly run `omg cost lock` after reviewing a budget alert.

## Verification

Local automated coverage includes:

- cost-lock state read/write/unlock behavior
- cost command JSON outcomes
- safety-decision blocking before budget audit
- live deploy, Firebase helper deploy, Secret Manager write, and init blocker tests
- operation intent and command mapping for `cost.status`, `cost.lock`, and `cost.unlock`
