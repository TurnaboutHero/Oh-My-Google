# Product Requirements Document: oh-my-google

Version: 0.7 free-tier-aware service coverage direction
Last updated: 2026-04-30

## Summary

`oh-my-google` (`omg`) is an agent-first safety harness for Google Cloud, Firebase, and eventually broader Google services.

The product exists because AI coding agents can write and deploy code, but Google operations still require project context, account context, billing awareness, OAuth scopes, API enablement, IAM boundaries, user-data boundaries, quotas, and service-to-service wiring. Those details are split across `gcloud`, Firebase CLI, ADC, Firebase login, Google Cloud Console, Google Workspace/consumer OAuth flows, and product-specific Google consoles.

`omg` gives agents one structured surface:

- CLI: `omg --output json <command>`
- MCP: `omg mcp start`
- Shared core: the same implementation path underneath both surfaces
- Safety layer: Trust Profile, approvals, account checks, budget guard, and local cost lock

The product should also help agents make cost-conscious choices before they create or deploy resources. Free trial credits and product-specific free tier limits are useful, but they are not a blanket zero-cost guarantee. `omg` should guide agents toward free-tier-friendly defaults, surface unknown cost risk, and stop or dry-run when it cannot classify the risk.

Current execution mostly uses official `gcloud` and Firebase CLI backends. Existing operations are now classified through an operation-intent model and shared safety decision path, so future Google/Firebase service MCPs can be added without bypassing the same guardrails.

The current downstream MCP gateway supports registered servers, tool discovery, and allowlisted read-only proxy calls. It intentionally does not proxy write or lifecycle tools until concrete verification semantics exist.

## Problem

Google Cloud, Firebase, and broader Google service APIs are powerful but easy for an autonomous agent to misuse.

Primary failure modes:

- Wrong account: active gcloud account and ADC can differ.
- Wrong project: a user may have multiple GCP projects visible.
- Wrong lifecycle target: stale, protected, production, and personal projects can look similar to an agent.
- Cost uncertainty: billing-enabled projects can incur cost even when the operation looks small.
- Free tier ambiguity: a resource may appear free to create, while deployment, build, storage, logging, or network usage can still consume credits or exceed free limits.
- Firebase subservice drift: Hosting, Firestore, Cloud Storage for Firebase, Functions, Auth, and related GCP resources each have different setup, quota, IAM, rules, and billing behavior even though users may think of them as one Firebase project.
- Broader Google service drift: Workspace, Drive, Sheets, Gmail, Calendar, Maps, Analytics, YouTube, Ads, and AI services have different OAuth scopes, user-data sensitivity, quotas, billing models, approval flows, and console surfaces.
- Console-only context: budget, IAM, Firebase project linkage, and enabled APIs are not obvious from repo files.
- Split tooling: Cloud Run and Firebase Hosting require different commands and wiring.
- Unstructured CLI output: plain text output is brittle for agents to parse.

The product requirement is not simply "wrap gcloud." The requirement is to make agent behavior auditable, bounded, and recoverable.

## Goals

1. Provide a single agent-friendly command surface for common GCP + Firebase workflows.
2. Make every response structured and machine-actionable.
3. Keep human approval in the loop for destructive, high-risk, production, or ambiguous actions.
4. Detect account/project mismatches before live operations.
5. Make cost-bearing operations increasingly dependent on explicit budget visibility and explicit local unlock state.
6. Keep CLI and MCP behavior equivalent by sharing core implementation.
7. Prepare a common operation classification layer for CLI, Firebase CLI, gcloud, REST/SDK, and downstream MCP adapters.
8. Prefer free-tier-friendly defaults and plans when they fit the user workflow.
9. Cover Firebase and GCP service surfaces as explicit, inspectable, and separately classified resources over time.
10. Extend the same safety model to broader Google services after cloud/Firebase guardrails are stable.
11. Prefer narrow, composable workflows over a broad unclassified automation layer.

## Non-Goals

- Replacing Google Cloud Console.
- Replacing `gcloud` or Firebase CLI for expert users.
- Supporting every GCP or Google service in the current phase.
- Silent account switching.
- Silent ADC switching.
- Creating or mutating budgets or budget notification rules without an explicit workflow.
- Automatically creating Pub/Sub topics, applying Pub/Sub IAM grants, deploying budget alert handlers, or creating agent service accounts in the current phase.
- Fully preventing spend through budgets; Google Cloud budgets are alerts, not hard caps.
- Guaranteeing that a deployment is free. `omg` may classify and reduce cost risk, but pricing and free-tier limits remain provider-controlled and may change.
- Supporting Next.js SSR deployment in the current phase.
- Exposing arbitrary downstream MCP tools directly to agents without operation classification, capability metadata, and safety review.

## Target Users

Primary users:

- AI coding agents such as Codex, Claude Code, Gemini CLI, Cursor-style agents, and similar tools.
- Developers who want those agents to deploy into Google Cloud, operate Firebase, and eventually use broader Google services with safer defaults.

Secondary users:

- Humans who want a JSON-first wrapper around common Google Cloud + Firebase workflows.
- Humans who want a consistent safety contract before delegating Google Workspace, Maps, Analytics, YouTube, Ads, or AI-service operations to agents.
- CI or local scripts that need predictable response contracts.

## Product Principles

### One Google Project Flow

Firebase and GCP should be treated as one project-level workflow where possible. The agent should not have to infer whether a deployment belongs to Firebase Hosting, Cloud Run, Secret Manager, or Billing APIs from scratch each time.

### Firebase Services Are First-Class Surfaces

Firebase is not a single operational surface. `omg` should model Firebase Hosting, Firestore, Cloud Storage for Firebase, and later Firebase Functions/Auth/Database-style workflows as separate service surfaces with their own audit state, rules/permission posture, free-tier risk, dry-run behavior, and cleanup requirements. The long-term target is broad GCP+Firebase free-tier-aware coverage, but each service must still enter through a narrow, tested, and reversible workflow.

### Google Services Are Future First-Class Surfaces

`omg` should eventually model broader Google services beyond Cloud/Firebase as explicit service surfaces too. Google Workspace APIs, Drive, Sheets, Gmail, Calendar, Maps Platform, Analytics, YouTube, Ads, Gemini/Vertex, and similar services should not be added as generic raw API calls. Each needs its own operation intent, OAuth scope posture, data-access sensitivity, quota/cost model, dry-run or read-only-first path, audit logging, and approval rules.

### Trust Profile Decides

The agent should not independently decide whether a risky operation is safe. It should ask the Trust Profile and follow the result:

- `auto`
- `require_confirm`
- `require_approval`
- `deny`

### JSON Is The Agent Contract

Every command must be readable by machines:

```json
{
  "ok": true,
  "command": "doctor",
  "data": {},
  "next": []
}
```

Failures must use stable `error.code` values so agents can branch safely.

### Dry-Run First

Where practical, live operations should have a dry-run path. Agents should be able to show the plan before touching Google Cloud.

### Free-Tier-Aware By Default

`omg` should treat cost awareness as a product feature, not only as a safety blocker. For supported workflows it should prefer smaller, simpler, and free-tier-friendly plans such as Firebase Hosting-only, static SPA, or minimal Cloud Run configurations when those plans satisfy the app shape. Free-tier guidance must cite or link official provider documentation, starting with the [Google Cloud free program documentation](https://docs.cloud.google.com/free/docs/free-cloud-features?hl=ko), avoid hardcoded stale pricing claims where possible, and use `unknown` rather than optimistic guesses when the evidence is incomplete.

### No Silent Context Mutation

Switching gcloud configurations and aligning ADC are side effects. They must be explicit through a command flag, interactive confirmation, or documented approval flow.

## Current Scope

Implemented core workflow:

- `omg setup`
- `omg auth context/list/create/switch/project`
- `omg init`
- `omg link`
- `omg deploy`
- `omg doctor`
- `omg approve/reject/approvals list`

Implemented admin and safety workflow:

- `omg budget audit`
- `omg budget enable-api`
- `omg budget ensure --dry-run`
- `omg budget notifications audit`
- `omg budget notifications ensure --dry-run`
- `omg budget notifications lock-ingestion --dry-run`
- `omg cost status/lock/unlock`
- `omg firestore audit`
- `omg iam audit`
- `omg iam plan`
- `omg iam bootstrap --dry-run`
- `omg security audit`
- `omg storage audit`
- `omg sql audit`
- `omg secret list/set/delete`
- `omg project audit/cleanup/delete/undelete`
- `omg mcp gateway audit`
- `omg mcp gateway call`

Implemented MCP tools:

- `omg.auth.context`
- `omg.init`
- `omg.link`
- `omg.deploy`
- `omg.doctor`
- `omg.approve`
- `omg.reject`
- `omg.approvals.list`
- `omg.budget.audit`
- `omg.budget.ensure`
- `omg.budget.notifications.audit`
- `omg.budget.notifications.ensure`
- `omg.budget.notifications.lock_ingestion`
- `omg.cost.status`
- `omg.cost.lock`
- `omg.cost.unlock`
- `omg.firestore.audit`
- `omg.iam.audit`
- `omg.iam.plan`
- `omg.iam.bootstrap`
- `omg.security.audit`
- `omg.storage.audit`
- `omg.sql.audit`
- `omg.secret.list`
- `omg.secret.set`
- `omg.secret.delete`
- `omg.project.audit`
- `omg.project.cleanup`
- `omg.project.delete`
- `omg.project.undelete`
- `omg.mcp.gateway.audit`
- `omg.mcp.gateway.call`

Current execution boundary:

- CLI and MCP surfaces call shared TypeScript command functions.
- Service execution currently uses narrow connectors over `gcloud`, Firebase CLI, and selected Google client libraries.
- Local safety state uses a `local-state` adapter and `.omg/` artifacts rather than cloud APIs.
- `omg` has a downstream MCP gateway for registered, allowlisted read-only tools. Future service MCPs must be routed through the same safety kernel rather than exposed as raw privileged tools.
- Downstream MCP write/lifecycle proxying is not implemented.

## Safety Requirements

### Account Safety

- `doctor` and `auth context` must expose active gcloud account, active project, ADC account, and mismatch state when available.
- `auth switch` must not align ADC unless `--align-adc` is present.
- `setup` may prompt for ADC alignment in interactive mode, but JSON mode requires explicit flags.
- Project delete/undelete approvals must record the active gcloud account.
- Consuming those approvals with a different active account must fail with `ACCOUNT_MISMATCH`.
- `--expect-account <email>` must fail early when the active account differs from the expected account.

### Project Lifecycle Safety

- `project audit` and `project cleanup --dry-run` must be read-only.
- `project delete` must be L3 and approval-gated.
- `project undelete` must be L3 and approval-gated.
- Protected projects must be blocked before approval.
- Billing-enabled projects must be blocked before deletion approval.
- Non-owner callers must be blocked before deletion approval.
- Undelete must only run for `DELETE_REQUESTED` projects.

### Cost Safety

- Budget audit must be read-only.
- Budget API enablement must require explicit `--yes` after a dry-run option.
- Free tier guidance must be advisory unless it is backed by inspected project state and an explicit operation classification.
- Free tier guidance must not claim "free" as a guarantee. The strongest positive claim should be that a plan is free-tier-friendly or likely within known free limits, subject to actual usage and current provider terms.
- Free tier guidance should classify plans with stable risk states such as `low`, `caution`, `unknown`, and `high`.
- `unknown` free-tier risk must block autonomous live execution for newly introduced cost-bearing workflows unless an explicit owner-approved exception exists.
- Free tier guidance must classify secondary service surfaces separately. Firebase Hosting, Firestore, Cloud Storage for Firebase, Cloud Run, Cloud Build, Artifact Registry, logging, and network egress can each change the risk of an otherwise simple deployment plan.
- Disposable E2E projects must be labeled or recorded with enough TTL/cleanup metadata for follow-up audit, and deletion must be verified through lifecycle state rather than assumed from a cleanup command.
- Budget policy ensure must remain CLI dry-run only until live create/update has approval, approval consumption, and decision logging integration review. Internal injected executor core, live gate contract, transport failure mapping, and opt-in transport factory may exist before the live gate opens.
- Budget notification ensure must remain dry-run only; Pub/Sub topic creation, Publisher IAM grants, and notification rule live mutation are manual-first until a separate owner-approved executor and verifier exist.
- Budget notification to cost lock ingestion must remain dry-run only; subscription creation, Subscriber IAM, handler runtime, local state write, and acknowledgement semantics are operator-driven until a reviewed live handler exists.
- `omg cost lock` must write only local `.omg/cost-lock.json` state and require a project ID plus reason.
- `omg cost unlock` must require explicit `--yes`.
- An active cost lock must block currently known cost-bearing live `omg` operations before budget audit or cloud execution.
- Live deploys, Firebase helper deploys, `secret set`, and `init` billing/API/IAM setup must be blocked unless budget audit returns `risk: configured`.
- `budget enable-api` is the explicit onboarding exception for budget visibility bootstrap.
- Local cost lock is an operator-controlled safety brake, not a Google Cloud hard spend cap. Budget alert ingestion planning may describe automatic paths, but live setup must stay blocked until a reviewed executor exists.
- Budget guard coverage must expand before additional broad live operations are added.

### Secret Safety

- Secret payloads must never be printed.
- Secret payloads must not be stored in approval args.
- `--value-file` should be preferred over `--value`.
- Secret delete must require dry-run or explicit `--yes`.

### IAM Safety

- `iam audit` must be read-only.
- IAM audit must not grant, revoke, create, delete, or mutate IAM resources.
- `iam plan` must use read-only audit state to propose separated agent identities without applying grants.
- `iam bootstrap --dry-run` must return proposed service account creation and IAM binding steps without applying them.
- Live IAM service account creation and IAM grants must stay manual-first until there is a concrete owner-approved workflow, verifier, and least-privilege grant design.
- Public principals, primitive roles, high-impact IAM administration roles, and missing IAM policy visibility must be surfaced as structured audit signals.

### Security Audit Safety

- `security audit` must be read-only.
- Security audit must use existing project, IAM, and budget audit surfaces rather than enabling new Google APIs.
- Section errors must be surfaced as partial audit results.
- `risk: high` must tell agents to stop before autonomous live operations.

### Firestore Safety

- `firestore audit` must be read-only.
- Firestore audit must not read documents, write documents, create databases, delete databases, export, import, or mutate indexes.
- Firestore write/provisioning/data workflows must stay deferred until there is a concrete owner-approved workflow.
- Future Firestore live workflows must preserve the cost-bearing invariant.

### Cloud Storage Safety

- `storage audit` must be read-only.
- Storage audit must not list objects, read objects, write objects, create buckets, delete buckets, mutate IAM policy, or change lifecycle settings.
- Storage bucket/object/IAM/lifecycle workflows must stay deferred until there is a concrete owner-approved workflow.
- Future Storage live workflows must preserve the cost-bearing invariant.

### Cloud SQL Safety

- `sql audit` must be read-only.
- SQL audit must not connect to databases, read database data, create instances, delete instances, export/import data, mutate backups, or change authorized networks.
- SQL instance/backup/export/import/lifecycle workflows must stay deferred until there is a concrete owner-approved workflow.
- Future SQL live workflows must preserve the cost-bearing invariant.

### Downstream MCP Gateway Safety

- `.omg/mcp.yaml` must be the registry for downstream MCP servers.
- Registry entries must use `envAllowlist`; secret environment values must not be stored in the registry.
- Tool discovery may call `tools/list` but must not call arbitrary tools.
- `omg.mcp.gateway.call` must allow only explicitly allowlisted read-only tools.
- Unknown, unallowlisted, disabled, destructive, or non-read downstream tools must be denied.
- Every downstream tool call attempt must write a decision log event.
- Downstream write/lifecycle proxying must stay deferred until post-verification semantics are implemented.

## Validation State

Completed validation:

- Local typecheck/build/test baseline.
- MCP client smoke.
- Disposable GCP E2E for `init -> link -> deploy -> doctor`.
- Disposable E2E project delete-request lifecycle readback after validation.
- Real stale project delete/undelete/delete-again smoke.
- Budget API enablement on the live validation project.
- Budget audit returning configured budget state.
- Secret Manager smoke secret creation and deletion under budget guard.
- History cleanup for local machine paths.
- Regression tests for first-run `init` budget guard decisions.
- OperationIntent and shared safety decision regression tests.
- CLI/MCP implementation equivalence tests for adopted command paths.
- Cost-bearing operation invariant tests for operation intents and command mappings.
- Local cost lock state, command, safety-decision, deploy, Firebase deploy, secret set, and init blocker tests.
- Agent IAM plan generation, dry-run-only bootstrap, and safety intent mapping tests.
- Budget Pub/Sub alert to cost lock ingestion plan, CLI, and safety intent mapping tests.
- Read-only Firestore audit tests and CLI/MCP equivalence tests.
- Read-only Cloud Storage audit tests and CLI/MCP equivalence tests.
- Read-only Cloud SQL audit tests and CLI/MCP equivalence tests.
- Downstream MCP registry, discovery, read-only proxy, denial, and decision log tests.
- Real MCP SDK stdio fixture tests for downstream MCP discovery, allowlisted read calls, and denied destructive tools.
- Exact 32-tool MCP server registry and `mcp start` stdio discovery smoke coverage.

Current open validation need:

- Free-tier guidance design and tests for plan classification, official-doc reference handling, and `unknown` risk blocking.
- E2E cleanup follow-up that distinguishes `DELETE_REQUESTED` from fully inaccessible or fully removed projects.
- Optional live Firestore, Cloud Storage, and Cloud SQL audit smoke on a known validation project.
- Optional external downstream MCP gateway smoke against a known benign MCP server.

## Success Criteria

Short-term:

- Agents can inspect, initialize, link, dry-run, and deploy supported apps without parsing human text.
- Agents can switch and inspect account context without silently mutating ADC.
- Project cleanup/recovery operations are auditable and approval-gated.
- Live deploys, Secret Manager writes, Firebase helper deploys, and `init` billing/API/IAM setup are guarded by budget visibility and local cost lock state.
- Agents can inspect a separated IAM plan before any IAM grants are implemented.
- Agents can see whether a supported deployment plan is free-tier-friendly, cautionary, unknown, or high risk before live execution.
- Agents can inspect Firebase Hosting, Firestore, and Storage posture as separate service surfaces rather than treating "Firebase" as one undifferentiated target.

Medium-term:

- All cost-bearing live Google Cloud operations have a budget guard, local cost-lock check, or explicit onboarding exception.
- Cost-sensitive workflows prefer free-tier-friendly defaults when they satisfy the app shape.
- Firebase and GCP service coverage expands by service surface, starting from read-only audit and dry-run plans before live writes.
- Remaining admin surfaces and downstream MCP adapters are added only when justified by actual workflows.
- MCP and CLI remain equivalent surfaces over the same core.

Long-term:

- `omg` becomes the default safety gateway between AI coding agents and Google platform services, starting with Google Cloud/Firebase projects and expanding to selected broader Google services where the service surface is classified, auditable, and safer than raw API or MCP execution.
