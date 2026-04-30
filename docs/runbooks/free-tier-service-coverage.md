# Free-Tier Service Coverage Runbook

Last reviewed: 2026-04-30

Purpose: define how `omg` should approach Google Cloud and Firebase free-tier-aware guidance without claiming a deployment is guaranteed free, while keeping the later broader-Google-services goal visible.

Official reference starting point:

- [Google Cloud free program documentation](https://docs.cloud.google.com/free/docs/free-cloud-features?hl=ko)

## Current Status

This is a product direction and planning runbook. There is no implemented `omg free-tier` command yet, and current deploy/link output does not calculate `freeTierRisk`.

Existing safety controls still apply:

- budget audit
- local cost lock
- Trust Profile and approval gates
- dry-run before live writes where available
- read-only Firestore, Cloud Storage, Cloud SQL, IAM, and security audits

Broader Google services such as Workspace, Drive, Sheets, Gmail, Calendar, Maps, Analytics, YouTube, Ads, Gemini/Vertex, and BigQuery are not covered by this runbook as implemented surfaces yet. They should later enter through the same service-surface model, with OAuth scope, user-data, quota, cost, approval, and audit boundaries.

## Policy Drift Rule

Google and Firebase free program terms, free-tier limits, regions, product names, and billing behavior can change. `omg` docs and code should not treat copied quota numbers as durable truth.

Rules:

- Link official documentation instead of hardcoding long-lived pricing or quota claims.
- If an implementation needs numeric thresholds, record the official source and review date near the code or generated output.
- Use `unknown` when official policy is ambiguous, stale, region-dependent, account-dependent, or not inspected in the current run.
- Never output "guaranteed free" or equivalent wording.

## Risk States

Future plan output should use stable risk states:

- `low`: the plan is free-tier-friendly based on current inspected evidence and conservative service heuristics.
- `caution`: the plan may fit common free-tier-friendly use, but usage, region, setup, or secondary services can change the cost posture.
- `unknown`: the plan lacks enough current evidence or official policy mapping.
- `high`: the plan includes an obviously cost-expanding, always-on, high-volume, privileged, or uncleared service surface.

`unknown` should not be upgraded to `low` without inspected project state, operation classification, and current official-doc-backed reasoning.

## Service Surface Matrix

Initial service surfaces to model separately:

| Surface | First useful `omg` behavior | Free-tier concern | Live write posture |
|---|---|---|---|
| Firebase Hosting | detect Hosting-only/static SPA plans | hosting quota, storage, bandwidth, custom domains, rewrites | dry-run first; live deploy stays budget-guarded |
| Firestore | read-only audit and future plan notes | document reads/writes/deletes, database mode, indexes, backups/PITR | writes/provisioning deferred |
| Cloud Storage for Firebase | read-only bucket/IAM posture and future plan notes | stored objects, downloads, public access, lifecycle, rules | object/bucket writes deferred |
| Cloud Run | minimal backend plan notes | instance time, min instances, requests, egress, logs | live deploy budget-guarded |
| Cloud Build | deploy plan warning | build minutes, image builds, logs | no standalone live workflow yet |
| Artifact Registry | deploy plan warning | image storage, cleanup policy | no standalone live workflow yet |
| Logging/Monitoring | deploy plan warning | log volume and retention | no standalone live workflow yet |
| Network egress | deploy plan warning | bandwidth and region-dependent egress | no standalone live workflow yet |
| Firebase Functions/Auth/Database | future service-surface entries | product-specific quotas and rules | not implemented |

Do not collapse these into one generic "Firebase" label. A static Hosting plan and a Hosting + Firestore + Storage plan have different cost and safety behavior.

## Agent Rules

Agents using `omg` should:

1. Prefer static/Firebase Hosting-only plans when the app shape does not require an API backend.
2. Add Cloud Run only when the repo actually needs a backend service.
3. Treat Firestore and Storage as separate resource surfaces, not incidental Firebase setup.
4. Run read-only audits before proposing writes for data/storage services.
5. Keep free-tier guidance advisory until implementation has tests and inspected evidence.
6. Stop or dry-run when risk is `unknown` for a new cost-bearing live workflow.
7. Verify cleanup state for disposable E2E projects; distinguish `DELETE_REQUESTED`, inaccessible, and fully removed.

## Suggested Implementation Path

1. Define a service-surface matrix in docs and tests.
2. Add plan-output-only `freeTierRisk` fields with conservative static heuristics.
3. Add per-surface notes for Firebase Hosting, Firestore, Storage, Cloud Run, Cloud Build, Artifact Registry, logging, and egress.
4. Add tests proving `unknown` is preserved when evidence is incomplete.
5. Add cleanup-state evidence for disposable E2E projects.
6. Consider a dedicated command only if `budget audit` and deploy plan output become too crowded.

## Non-Goals

- No zero-cost guarantee.
- No full pricing catalog.
- No scraping pricing pages during normal command execution.
- No new live resource creation solely to inspect free-tier behavior.
- No bypass of budget guard, local cost lock, Trust Profile, approvals, or post-verification rules.
- No generic broader Google API connector before service-specific OAuth/data/quota/cost classification.
