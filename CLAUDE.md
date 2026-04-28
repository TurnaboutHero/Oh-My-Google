# oh-my-google (omg) — Project Instructions

Last updated: 2026-04-28

## Identity

`omg` is an agent-first harness for safely operating Google Cloud and Firebase as one project workflow.

The reason this project exists: Firebase and GCP can refer to the same underlying project, but the real operational surface is split across separate CLIs, auth contexts, APIs, consoles, and billing boundaries. AI agents often fail at those boundaries. `omg` provides one structured entry point.

Primary users are AI coding agents such as Claude Code, Codex, Gemini CLI, Cursor-style agents, and similar tools. Human CLI usage is supported, but agent consumption is the main design target.

## Current Product Surface

Core workflow:

- `omg setup`
- `omg auth context/list/create/switch/project`
- `omg init`
- `omg link`
- `omg deploy`
- `omg doctor`
- `omg approve/reject/approvals list`

Safety/admin workflow:

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

MCP surface:

- `omg mcp start`
- 23 MCP tools over the same core implementation

Backend surface:

- Current execution uses narrow `gcloud` and Firebase CLI connectors plus selected Google client libraries.
- Local cost-lock state uses `.omg/cost-lock.json` and the `local-state` adapter, not a cloud API.
- `omg` has a narrow downstream MCP gateway for registered, allowlisted read-only tools.
- Downstream MCP write/lifecycle proxying must be routed through the same safety model and is not implemented until concrete verifiers exist.

## Coding Principles

1. **GCP + Firebase integration is the core value.** A feature that only wraps one CLI without planner, trust, or wiring value is usually not enough.
2. **Agent-first output.** Every command used by agents must support `--output json` and the `{ ok, command, data?, error?, next? }` envelope.
3. **Trust Profile decides.** Agents should not invent safety judgments. Run the trust check and follow the result.
4. **CLI + MCP share core.** Do not implement separate business logic for MCP.
5. **Planner before executor.** Decide what should happen before running cloud commands.
6. **Dry-run first where possible.** Live writes/deletes need explicit flags, trust checks, or approvals.
7. **No silent account mutation.** gcloud configuration switching and ADC alignment must be explicit.
8. **Budget guard before cost expansion.** Preserve the cost-bearing invariant before adding broad live cloud operations.
9. **Secrets stay secret.** Never print or store secret payloads in outputs, logs, approval args, or tests.
10. **Classify before adapting.** New backends, including downstream MCPs, need operation intent and capability metadata before privileged execution.
11. **Prefer narrow surfaces.** Add admin commands only when the user workflow needs them.

## Current Safety Model

Trust levels:

- L0: read-only
- L1: normal setup/deploy changes
- L2: cost, IAM, production, or secret-write impact
- L3: destructive or lifecycle actions

Important implemented guards:

- Approval queue with args hash validation and one-use consumed markers.
- Trust deny policy before approvals.
- Active gcloud account vs ADC account mismatch reporting.
- Project delete/undelete approvals bind to the active gcloud account.
- `--expect-account` guard for project delete/undelete.
- Project deletion blocks protected, billing-enabled, do-not-touch, and non-owner cases before approval.
- Project undeletion only runs for `DELETE_REQUESTED`.
- Live `omg deploy`, `omg firebase deploy --execute`, `secret set`, and `omg init` billing/API/IAM setup require no active local cost lock and budget audit `risk: configured`.
- `omg cost lock` records a local project-scoped blocker; `omg cost unlock` requires `--yes`.
- `budget ensure --dry-run` plans expected budget policy, but live budget create/update remains blocked.
- Budget API create/update request execution and post-verification core exist behind injected functions; CLI live mutation is not wired.
- Budget ensure live gate contract fixes transport/auth, L2 approval, decision-log, and post-verification failure envelope expectations before live wiring.
- `budget notifications audit` and `budget notifications ensure --dry-run` inspect visible routing plus Pub/Sub topic/IAM state, but live notification mutation remains blocked.
- `budget notifications lock-ingestion --dry-run` plans a subscriber/handler path into local cost lock, but live subscription, IAM, and handler setup remain blocked.
- Pub/Sub topic creation, Pub/Sub Publisher grants, budget alert ingestion setup, and live agent IAM bootstrap are manual-first boundaries.
- Read-only `firestore audit` reports visible databases, composite indexes, and protection/PITR posture.
- Read-only `storage audit` reports visible buckets, bucket posture, bucket IAM, and public principals.
- Read-only `sql audit` reports visible instances, backup metadata, deletion protection, public IPv4, and public authorized networks.
- Read-only `iam audit` reports visible IAM bindings, service accounts, public principals, primitive roles, and inaccessible policy areas.
- `iam plan` and `iam bootstrap --dry-run` propose separated auditor/deployer/secret-admin agent identities without applying grants.
- Read-only `security audit` rolls up project, IAM, and budget posture without enabling new Google APIs.
- Downstream MCP gateway audit/discovery reads `.omg/mcp.yaml` and `tools/list`.
- Downstream MCP gateway call allows only explicitly allowlisted read-only tools and logs every call attempt.

Important remaining gaps:

- `budget enable-api` remains an explicit dry-run/`--yes` bootstrap exception for budget visibility.
- Local cost lock is operator-driven unless a separately reviewed Budget Pub/Sub ingestion handler is implemented outside the current live scope.
- Manual-first cloud write boundaries are documented in `docs/runbooks/manual-first-cloud-writes.md`.
- Downstream MCP write/lifecycle proxying is not implemented.
- Live budget creation/mutation is not implemented.
- Firestore write/provisioning/data workflows are not implemented.
- Cloud Storage bucket/object/IAM/lifecycle write workflows are not implemented.
- Cloud SQL instance/backup/export/import/lifecycle write workflows are not implemented.
- Live IAM service account creation and IAM grants are not implemented.
- External `notify` senders are deferred until budget Pub/Sub notification posture exists and concrete recipients/channels are specified.
- Advanced rollback orchestration is not implemented.
- Next.js SSR deployment is not supported.

## Don'ts

- Do not resurrect `pipeline.ts` or `AsyncConnector`.
- Do not add a broad adapter layer before operation intent, capability classification, and tests exist.
- Do not add new dependencies without explicit need.
- Do not implement MCP by shelling out to the CLI.
- Do not expose raw downstream Google/Firebase MCP tools for privileged operations.
- Do not store secret env values in `.omg/mcp.yaml`; use `envAllowlist`.
- Do not silently switch ADC after switching gcloud configuration.
- Do not auto-select among multiple visible projects in JSON mode.
- Do not broaden destructive cloud actions without approval and tests.
- Do not treat Google Cloud budgets as hard spend caps.
- Do not claim live resources were cleaned up without verifying final state.

## Project Structure

```text
src/
  approval/     approval hash, queue, and types
  auth/         local config and gcloud/ADC context
  cli/          commander commands and output formatting
  connectors/   thin service-specific execution/audit adapters
  cost-lock/    local cost lock state
  executor/     sequential plan execution
  harness/      decision log and handoff artifacts
  iam/          agent IAM planning
  mcp/          stdio MCP server and tools
  planner/      repo detection, GCP state, plan builder/schema
  setup/        project, billing, API, IAM setup helpers
  system/       CLI process runner
  trust/        Trust Profile, level mapping, checks
  types/        shared TypeScript contracts
  wiring/       Firebase rewrites and env injection
```

## Documentation Map

| Document | Purpose |
|---|---|
| `README.md` | Korean overview, current status, CLI/MCP usage |
| `README.en.md` | English overview |
| `PRD.md` | Product purpose, goals, non-goals, safety requirements |
| `PLAN.md` | Implementation phases and next work |
| `TODO.md` | Current checklist and known risks |
| `ARCHITECTURE.md` | Current module boundaries and execution flow |
| `AGENTS.md` | Agent operating contract and omg usage contract |
| `docs/runbooks/*` | Live validation and operational runbooks |
| `docs/runbooks/phase-4-4b-release-notes.md` | Phase 4 resource audits and Phase 4B gateway release notes |
| `docs/runbooks/history-rewrite-and-conflict-safety.md` | Conflict, clone, and push safety after history rewrite |

## Tech Stack

- TypeScript
- Node.js >= 20
- ESM
- commander
- `@modelcontextprotocol/sdk`
- `google-auth-library`
- `@google-cloud/run`
- `@inquirer/prompts`
- `yaml`
- vitest

Firebase and many GCP operations are intentionally invoked through their official CLIs rather than fully reimplemented in SDK code.
