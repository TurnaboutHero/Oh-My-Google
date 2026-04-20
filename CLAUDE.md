# oh-my-google (omg) — Project Instructions

Last updated: 2026-04-20

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
- `omg secret list/set/delete`
- `omg project audit/cleanup/delete/undelete`

MCP surface:

- `omg mcp start`
- 16 MCP tools over the same core implementation

## Coding Principles

1. **GCP + Firebase integration is the core value.** A feature that only wraps one CLI without planner, trust, or wiring value is usually not enough.
2. **Agent-first output.** Every command used by agents must support `--output json` and the `{ ok, command, data?, error?, next? }` envelope.
3. **Trust Profile decides.** Agents should not invent safety judgments. Run the trust check and follow the result.
4. **CLI + MCP share core.** Do not implement separate business logic for MCP.
5. **Planner before executor.** Decide what should happen before running cloud commands.
6. **Dry-run first where possible.** Live writes/deletes need explicit flags, trust checks, or approvals.
7. **No silent account mutation.** gcloud configuration switching and ADC alignment must be explicit.
8. **Budget guard before cost expansion.** Expand budget guard coverage before adding broad live cloud operations.
9. **Secrets stay secret.** Never print or store secret payloads in outputs, logs, approval args, or tests.
10. **Prefer narrow surfaces.** Add admin commands only when the user workflow needs them.

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
- Live `secret set` requires budget audit `risk: configured`.

Important remaining gaps:

- Budget guard is not yet connected to every live Google Cloud operation.
- Budget creation/mutation is not implemented.
- `iam`, `notify`, and `security` admin surfaces are not implemented.
- Advanced rollback orchestration is not implemented.
- Next.js SSR deployment is not supported.

## Don'ts

- Do not resurrect `pipeline.ts` or `AsyncConnector`.
- Do not add a broad adapter layer before the concrete workflow needs it.
- Do not add new dependencies without explicit need.
- Do not implement MCP by shelling out to the CLI.
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
  executor/     sequential plan execution
  harness/      decision log and handoff artifacts
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
