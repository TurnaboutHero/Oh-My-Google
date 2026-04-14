# oh-my-google (omg) Architecture

> 버전: 0.2.0 (Claude 초안 + Codex 아키텍처 + API 조사 종합)
> 최종 수정: 2026-04-14

This document synthesizes `PRD.md` and `CLAUDE.md` into an implementation-ready software architecture for `oh-my-google (omg)`: an independent CLI orchestration layer that sits between coding agents and Google services.

Design constraints:

- `omg` is an independent CLI, not a plugin tied to a single agent.
- The **hard harness** owns all Google-side effects. The **soft harness** (SKILL.md) guides agent intent, but only `omg` executes service calls.
- The 2-hop rule is mandatory: `agent → omg → Google service`. No `agent → omg → other agent/tool → Google service`.
- MVP-alpha: Cloud Run (GA API). MVP-beta: Jules (alpha API). Phase 2: Stitch (MCP, experimental).
- Authentication is **service-specific**: GCP ADC for Cloud Run/Firebase, API key for Jules, TBD for Stitch.

## 0. Soft / Hard harness boundary

```text
[Soft Harness — 에이전트 판단 영역]
  에이전트가 SKILL.md를 읽고 의도 파악
  "이건 deploy 커맨드가 적합하겠다"
  → NormalizedIntent 생성 → omg CLI 또는 어댑터 호출

      ↓  NormalizedIntent (JSON)

[Hard Harness — 코드 통제 영역]
  PipelineOrchestrator가 실행 계획 수립
  각 단계 pre/post 검증
  비용 영향 작업은 사용자 확인 요구
  에러 시 롤백 또는 중단
  에이전트 개입 불가
```

에이전트의 자유: **뭘 할지** 선택 (소프트)
코드의 통제: **어떻게 실행할지** 강제 (하드)

## Shared TypeScript primitives

These shared primitives are referenced by the six sections below.

```ts
export type ModuleId =
  | 'cli'
  | 'auth'
  | 'connectors'
  | 'orchestrator'
  | 'adapters'
  | 'skills';

export type ConnectorId = 'stitch' | 'jules' | 'cloud-run' | 'firebase';

export type AdapterId =
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'gemini-cli'
  | 'antigravity';

export type JsonObject = Record<string, unknown>;

export interface ProjectRef {
  projectId: string;
  region?: string;
  environment?: 'dev' | 'stage' | 'prod';
}

export interface ActorRef {
  kind: 'direct-cli' | 'adapter' | 'skill';
  id: string;
  displayName: string;
}

export interface RequestMetadata {
  requestId: string;
  correlationId: string;
  initiatedAt: string;
  cwd: string;
  dryRun: boolean;
  actor: ActorRef;
  labels?: Record<string, string>;
}

export interface OperationLogger {
  debug(message: string, context?: JsonObject): void;
  info(message: string, context?: JsonObject): void;
  warn(message: string, context?: JsonObject): void;
  error(message: string, context?: JsonObject): void;
}
```

## 1. Module dependency graph

### 1.1 Runtime layering

The runtime is intentionally one-directional. `cli/` is the composition root. `auth/` and `skills/` are foundational. `connectors/` are the only Google-facing integration points. `orchestrator/` is the hard harness. `adapters/` are agent-facing normalization/rendering layers.

Import direction: `A -> B` means `A` may import `B`.

```text
cli ---------> adapters ---------> skills
 |               |
 |               +---------------> orchestrator ---------> connectors ---------> auth
 |                                    |                       |
 |                                    +-----------------------> auth
 |
 +-----------------------------------> skills
 +-----------------------------------> orchestrator
 +-----------------------------------> auth
```

Equivalent layer stack:

```text
Layer 5: cli
Layer 4: adapters
Layer 3: orchestrator
Layer 2: connectors
Layer 1: auth, skills
```

### 1.2 Module responsibilities and allowed dependencies

```ts
export interface ModuleBoundary {
  id: ModuleId;
  owns: readonly string[];
  allowedDependencies: readonly ModuleId[];
  forbiddenDependencies: readonly ModuleId[];
  runtimeRole:
    | 'composition-root'
    | 'foundation'
    | 'integration'
    | 'control-plane'
    | 'agent-surface';
  notes: string;
}

export const MODULE_BOUNDARIES: readonly ModuleBoundary[] = [
  {
    id: 'cli',
    owns: ['command parsing', 'process bootstrap', 'dependency wiring', 'human-readable output'],
    allowedDependencies: ['auth', 'orchestrator', 'adapters', 'skills'],
    forbiddenDependencies: [],
    runtimeRole: 'composition-root',
    notes: 'The only module allowed to wire the full system together.'
  },
  {
    id: 'auth',
    owns: ['project profile', 'OAuth tokens', 'scope broker', 'credential injection'],
    allowedDependencies: [],
    forbiddenDependencies: ['cli', 'connectors', 'orchestrator', 'adapters', 'skills'],
    runtimeRole: 'foundation',
    notes: 'No domain module should leak back into auth.'
  },
  {
    id: 'connectors',
    owns: ['Google service adapters', 'transport code', 'remote status polling', 'rollback hooks'],
    allowedDependencies: ['auth'],
    forbiddenDependencies: ['cli', 'orchestrator', 'adapters', 'skills'],
    runtimeRole: 'integration',
    notes: 'All side effects against Google APIs/CLIs happen here.'
  },
  {
    id: 'orchestrator',
    owns: ['pipeline planning', 'validation gates', 'rollback coordination', 'execution state'],
    allowedDependencies: ['auth', 'connectors'],
    forbiddenDependencies: ['cli', 'adapters', 'skills'],
    runtimeRole: 'control-plane',
    notes: 'Hard harness. Never imports agent-specific code.'
  },
  {
    id: 'adapters',
    owns: ['agent normalization', 'adapter-specific formatting', 'capability negotiation'],
    allowedDependencies: ['orchestrator', 'skills'],
    forbiddenDependencies: ['cli', 'connectors', 'auth'],
    runtimeRole: 'agent-surface',
    notes: 'Adapters can request orchestration, but cannot reach connectors directly.'
  },
  {
    id: 'skills',
    owns: ['SKILL.md discovery', 'metadata parsing', 'skill-to-command mapping'],
    allowedDependencies: [],
    forbiddenDependencies: ['cli', 'auth', 'connectors', 'orchestrator', 'adapters'],
    runtimeRole: 'foundation',
    notes: 'Treat skill content as declarative. No service calls from skills.'
  }
];
```

### 1.3 Concrete implementation notes

- `src/cli/` should contain `bootstrap.ts` or equivalent composition root code. That file constructs `AuthManager`, `ConnectorRegistry`, `SkillRegistry`, `AdapterRegistry`, and `PipelineOrchestrator`.
- `src/auth/` must be import-safe and testable in isolation. It should expose no knowledge of specific CLI commands or connectors beyond service IDs and scope requirements.
- `src/connectors/` must implement only transport and service semantics. It should never choose pipeline order.
- `src/orchestrator/` owns dependency ordering, validation, retries, rollback, state persistence, and 2-hop rule enforcement.
- `src/adapters/` should remain thin. Adapters normalize agent input into an `omg` execution request and format `omg` results back into the agent’s expected shape.
- `skills/` at repository root is content. The runtime loader can live in `src/skills/`, but it must depend only on filesystem/markdown parsing concerns, not on orchestration internals.

## 2. Connector interface

### 2.1 Connector contract goals

Every connector must implement the same contract so the orchestrator can treat `Stitch`, `Jules`, `Cloud Run`, and `Firebase` uniformly:

- auth is injected, never fetched ad hoc inside a connector
- request/response shapes are typed per connector
- sync and async services return a common operation handle
- remote failures normalize into one error model
- status polling works for async services like `Jules`

### 2.2 Common connector interfaces

```ts
export type AuthInjectionTarget =
  | 'rest-header'
  | 'api-key-header'
  | 'google-client'
  | 'gcloud-env'
  | 'firebase-env';

export interface ConnectorAuthRequirement {
  target: AuthInjectionTarget;
  scopes: readonly string[];
  audience?: string;
}

export interface ConnectorCapability {
  action: string;
  deliveryMode: 'sync' | 'async';
  supportsDryRun: boolean;
  supportsRollback: boolean;
  timeoutMsDefault: number;
}

export interface ConnectorRequestBase {
  connectorId: ConnectorId;
  action: string;
  project: ProjectRef;
  metadata: RequestMetadata;
  idempotencyKey?: string;
  timeoutMs?: number;
}

export interface ConnectorArtifact {
  kind: 'design' | 'source' | 'deployment' | 'url' | 'log' | 'bundle' | 'json';
  name: string;
  uri: string;
  metadata?: JsonObject;
}

export type ConnectorErrorCategory =
  | 'auth'
  | 'validation'
  | 'transport'
  | 'quota'
  | 'timeout'
  | 'remote'
  | 'policy'
  | 'rollback';

export interface ConnectorError {
  connectorId: ConnectorId;
  category: ConnectorErrorCategory;
  code: string;
  message: string;
  retryable: boolean;
  remoteStatusCode?: number;
  details?: JsonObject;
}

export interface OperationHandle {
  connectorId: ConnectorId;
  operationId: string;
  externalId?: string;
  deliveryMode: 'sync' | 'async';
  createdAt: string;
  pollAfterMs?: number;
}

export type OperationState =
  | 'accepted'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'rolled-back';

export interface ConnectorStatus<TResult> {
  handle: OperationHandle;
  state: OperationState;
  percent?: number;
  externalStatus?: string;
  startedAt: string;
  updatedAt: string;
  result?: TResult;
  error?: ConnectorError;
  artifacts?: readonly ConnectorArtifact[];
}

export interface PreparedConnectorRequest<TRequest extends ConnectorRequestBase> {
  request: TRequest;
  authRequirement: ConnectorAuthRequirement;
  authInjection: AuthInjection;
}

export interface ConnectorValidationResult {
  ok: boolean;
  findings: readonly ValidationFinding[];
}

export interface ConnectorExecutionResult<TResult> {
  handle: OperationHandle;
  initialStatus: ConnectorStatus<TResult>;
}

export interface ConnectorRollbackResult {
  ok: boolean;
  rolledBackAt: string;
  artifacts?: readonly ConnectorArtifact[];
  error?: ConnectorError;
}

export interface ConnectorContext {
  metadata: RequestMetadata;
  logger: OperationLogger;
  signal?: AbortSignal;
}

export interface GoogleConnector<
  TRequest extends ConnectorRequestBase,
  TResult
> {
  readonly id: ConnectorId;
  readonly displayName: string;
  readonly authRequirements: readonly ConnectorAuthRequirement[];
  readonly capabilities: readonly ConnectorCapability[];

  validate(request: TRequest, ctx: ConnectorContext): Promise<ConnectorValidationResult>;
  prepare(request: TRequest, auth: AuthSession, ctx: ConnectorContext): Promise<PreparedConnectorRequest<TRequest>>;
  execute(prepared: PreparedConnectorRequest<TRequest>, ctx: ConnectorContext): Promise<ConnectorExecutionResult<TResult>>;
  getStatus(handle: OperationHandle, auth: AuthSession, ctx: ConnectorContext): Promise<ConnectorStatus<TResult>>;
  cancel?(handle: OperationHandle, auth: AuthSession, ctx: ConnectorContext): Promise<ConnectorStatus<TResult>>;
  rollback?(
    handle: OperationHandle,
    auth: AuthSession,
    ctx: ConnectorContext
  ): Promise<ConnectorRollbackResult>;
  normalizeError(error: unknown): ConnectorError;
}
```

### 2.3 Concrete connector request/response types

```ts
export interface StitchCreateDesignRequest extends ConnectorRequestBase {
  connectorId: 'stitch';
  action: 'create-design';
  prompt: string;
  designSpecMarkdown?: string;
  outputFormat: 'figma-like-json' | 'html' | 'react';
}

export interface StitchCreateDesignResult {
  designId: string;
  previewUrl?: string;
  exportUri?: string;
}

export interface JulesRunTaskRequest extends ConnectorRequestBase {
  connectorId: 'jules';
  action: 'run-task';
  repoUrl: string;
  branch: string;
  taskPrompt: string;
  expectedArtifacts?: readonly string[];
}

export interface JulesRunTaskResult {
  taskId: string;
  branch?: string;
  patchUri?: string;
  summary?: string;
}

export interface CloudRunDeployRequest extends ConnectorRequestBase {
  connectorId: 'cloud-run';
  action: 'deploy-service';
  serviceName: string;
  imageUri: string;
  region: string;
  trafficPercent?: number;
  env?: Record<string, string>;
}

export interface CloudRunDeployResult {
  revisionName: string;
  serviceUrl: string;
  trafficPercent: number;
}

export interface FirebaseDeployRequest extends ConnectorRequestBase {
  connectorId: 'firebase';
  action: 'deploy';
  targets: readonly ('hosting' | 'functions' | 'firestore' | 'storage')[];
  projectAlias?: string;
  sourceDir: string;
}

export interface FirebaseDeployResult {
  deploymentId: string;
  consoleUrl?: string;
  hostingUrl?: string;
}
```

### 2.4 Connector registry

```ts
export interface ConnectorRegistry {
  get<TRequest extends ConnectorRequestBase, TResult>(
    connectorId: ConnectorId
  ): GoogleConnector<TRequest, TResult>;
  list(): readonly GoogleConnector<ConnectorRequestBase, unknown>[];
}
```

### 2.5 Concrete implementation notes

- `StitchConnector` (Phase 2): MCP server exists at `stitch.googleapis.com/mcp` but auth/API docs are sparse. Treat as experimental. Initially implement as MCP client if feasible, with fallback to DESIGN.md file-based integration.
- `JulesConnector` must always be treated as `async`. `execute()` should return `accepted`, and `getStatus()` must translate remote task states into `OperationState`.
- `CloudRunConnector` should wrap `gcloud run deploy` with auth injected through environment variables rather than relying on mutable global `gcloud auth` state.
- `FirebaseConnector` should wrap `firebase` CLI or `firebase-tools` with the same auth broker contract. Prefer ephemeral ADC-based auth injection; keep legacy token injection as a fallback only.
- Every connector must implement `normalizeError()` so the orchestrator never branches on raw exceptions from `fetch`, `googleapis`, or child processes.

## 3. Orchestrator design

### 3.1 Hard harness responsibilities

The orchestrator is the control plane. It is the only module allowed to:

- compile a user or adapter request into a validated execution plan
- resolve the required scopes and auth session for each step
- enforce the 2-hop rule
- run steps sequentially or selectively
- persist state for `omg status`
- rollback previously completed steps on failure

Execution flow:

```text
adapter/cli request
  -> normalize intent
  -> compile plan
  -> enforce 2-hop policy
  -> validate plan and selected steps
  -> resolve auth for step
  -> connector.validate()
  -> connector.execute()
  -> poll if async
  -> post-step validation
  -> next step
failure
  -> stop further steps
  -> rollback completed reversible steps in reverse order
  -> persist final execution state
```

### 3.2 Orchestrator interfaces

```ts
export type PipelineId =
  | 'design-code-deploy'
  | 'deploy-only'
  | 'firebase-deploy'
  | 'custom';

export type StepId = 'stitch' | 'jules' | 'cloud-run' | 'firebase';

export interface StepSelector {
  mode: 'all' | 'single' | 'range' | 'set';
  stepId?: StepId;
  fromStepId?: StepId;
  toStepId?: StepId;
  stepIds?: readonly StepId[];
}

export interface ValidationFinding {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
  stepId?: StepId;
  details?: JsonObject;
}

export interface PipelineStepDefinition<TRequest extends ConnectorRequestBase = ConnectorRequestBase> {
  id: StepId;
  connectorId: ConnectorId;
  action: TRequest['action'];
  dependsOn: readonly StepId[];
  rollbackPolicy: 'none' | 'best-effort' | 'required';
  timeoutMs: number;
  buildRequest(input: PipelineExecutionInput, state: PipelineExecutionRecord): Promise<TRequest>;
  validateOutput(status: ConnectorStatus<unknown>, state: PipelineExecutionRecord): Promise<ConnectorValidationResult>;
}

export interface PipelineDefinition {
  id: PipelineId;
  description: string;
  steps: readonly PipelineStepDefinition[];
}

export interface PipelineExecutionInput {
  project: ProjectRef;
  selector: StepSelector;
  payload: JsonObject;
  metadata: RequestMetadata;
}

export type StepRunState =
  | 'pending'
  | 'skipped'
  | 'running'
  | 'completed'
  | 'failed'
  | 'rolled-back';

export interface StepRunRecord {
  stepId: StepId;
  connectorId: ConnectorId;
  state: StepRunState;
  startedAt?: string;
  completedAt?: string;
  handle?: OperationHandle;
  status?: ConnectorStatus<unknown>;
  rollback?: ConnectorRollbackResult;
  findings?: readonly ValidationFinding[];
}

export type PipelineExecutionState =
  | 'planned'
  | 'running'
  | 'failed'
  | 'completed'
  | 'rolled-back'
  | 'cancelled';

export interface PipelineExecutionRecord {
  executionId: string;
  pipelineId: PipelineId;
  project: ProjectRef;
  state: PipelineExecutionState;
  selector: StepSelector;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  currentStepId?: StepId;
  stepRuns: Record<StepId, StepRunRecord>;
  findings: readonly ValidationFinding[];
}

export interface ExecutionRepository {
  save(record: PipelineExecutionRecord): Promise<void>;
  get(executionId: string): Promise<PipelineExecutionRecord | null>;
  listOpen(): Promise<readonly PipelineExecutionRecord[]>;
}

export interface PipelineOrchestrator {
  compile(input: PipelineExecutionInput): Promise<PipelineDefinition>;
  validate(definition: PipelineDefinition, input: PipelineExecutionInput): Promise<readonly ValidationFinding[]>;
  execute(definition: PipelineDefinition, input: PipelineExecutionInput): Promise<PipelineExecutionRecord>;
  resume(executionId: string): Promise<PipelineExecutionRecord>;
  cancel(executionId: string, reason: string): Promise<PipelineExecutionRecord>;
  getStatus(executionId: string): Promise<PipelineExecutionRecord | null>;
}
```

### 3.3 2-hop policy enforcement

```ts
export interface InvocationPath {
  agent: AdapterId | 'direct-cli';
  omgSurface: 'cli' | 'adapter';
  connectorId: ConnectorId;
  googleTransport: 'rest' | 'googleapis-sdk' | 'gcloud-cli' | 'firebase-cli';
  extraIntermediaries: readonly string[];
}

export interface HopPolicyViolation {
  code: 'TWO_HOP_RULE_VIOLATION';
  message: string;
  path: InvocationPath;
}

export interface HopPolicyEnforcer {
  assert(path: InvocationPath): void;
}
```

Required policy:

- `extraIntermediaries` must always be empty.
- `googleTransport` may be a Google API/SDK/CLI only.
- Adapters may normalize requests, but they may not shell out to other agent CLIs to complete work.
- Connectors may call `gcloud`, `firebase`, or Google APIs directly. They may not call `gemini`, `claude`, `codex`, or `opencode`.

### 3.4 Partial execution and rollback

Partial execution modes:

- `omg deploy` compiles a single-step plan with `selector = { mode: 'single', stepId: 'cloud-run' }`
- `omg pipeline --from jules --to cloud-run` compiles a range plan
- `omg pipeline --only firebase` compiles a single-step or set-based plan

Selection rules:

- the selector is validated against step dependencies
- a step cannot run if any required predecessor is neither already completed nor explicitly included
- outputs of skipped prerequisite steps must be supplied in `payload`

Rollback rules:

- rollback happens in reverse completion order
- only steps whose `rollbackPolicy !== 'none'` are attempted
- rollback failure is recorded but does not hide the original failure
- status after rollback is `rolled-back` if all completed reversible steps were successfully reverted, otherwise `failed`

### 3.5 Concrete implementation notes

- Persist execution state under `.omg/state/executions/<executionId>.json` so `omg status` survives process restarts.
- Use optimistic idempotency keys per step, especially for deploy operations.
- Implement plan-time validation and post-step validation separately. Example: `Cloud Run` may succeed at command level but fail post-step validation if the service URL does not respond or the expected revision is not active.
- Do not allow adapters or skills to construct arbitrary connector graphs. They may choose among registered pipeline definitions or single commands only.

## 4. Adapter pattern

### 4.1 Adapter goals

Adapters let agent environments plug into the same `omg` core without contaminating the hard harness with agent-specific logic.

Responsibilities:

- detect whether the adapter applies in the current environment
- normalize raw agent messages/tool calls into an `omg` command or pipeline request
- advertise supported commands/skills back to the agent
- format `omg` responses for the agent’s preferred output shape

Non-responsibilities:

- no Google-side effects
- no direct connector access
- no pipeline execution decisions outside supported `omg` request models

### 4.2 Adapter interfaces

```ts
export interface AdapterEnvironment {
  cwd: string;
  env: Record<string, string | undefined>;
  supportsSubagents: boolean;
  supportsStreaming: boolean;
}

export interface AdapterInvocation {
  rawCommand?: string;
  rawArgs?: readonly string[];
  rawPayload?: JsonObject;
  requestedSkillId?: string;
}

export interface NormalizedIntent {
  kind: 'setup' | 'auth' | 'doctor' | 'connector' | 'pipeline' | 'status' | 'skill';
  commandId: string;
  connectorId?: ConnectorId;
  pipelineId?: PipelineId;
  selector?: StepSelector;
  args: JsonObject;
}

export interface AdapterExecutionResponse {
  exitCode: number;
  stdout: string;
  stderr?: string;
  structured?: JsonObject;
}

export interface ToolAdapter {
  readonly id: AdapterId;
  readonly displayName: string;
  readonly invocationMode: 'plugin' | 'tool-call' | 'shell-wrapper';
  readonly supportsParallelSubagents: boolean;

  matches(env: AdapterEnvironment): boolean;
  normalize(invocation: AdapterInvocation, env: AdapterEnvironment): Promise<NormalizedIntent>;
  describeCapabilities(): Promise<{
    commands: readonly string[];
    skills: readonly string[];
    supportsStreaming: boolean;
  }>;
  formatSuccess(result: PipelineExecutionRecord | JsonObject, env: AdapterEnvironment): Promise<AdapterExecutionResponse>;
  formatFailure(error: ConnectorError | Error, env: AdapterEnvironment): Promise<AdapterExecutionResponse>;
}

export interface AdapterRegistry {
  get(id: AdapterId): ToolAdapter;
  detect(env: AdapterEnvironment): ToolAdapter | null;
  list(): readonly ToolAdapter[];
}
```

### 4.3 Concrete adapter behavior

- `ClaudeCodeAdapter` is the first-class adapter. It should support parallel subagent-friendly output, skill discovery, and structured summaries that map cleanly into Claude Code tool use.
- `CodexAdapter` and `OpenCodeAdapter` should reuse most of the same normalization and formatting path, differing mostly in environment detection and output conventions.
- `GeminiCliAdapter` should emphasize tool-call-native flows rather than shell-wrapper ergonomics.
- `AntigravityAdapter` must report `supportsParallelSubagents = false` and degrade to sequential workflows. It still produces the same normalized intent model.

### 4.4 Implementation notes

- Adapters should be loaded dynamically from `src/adapters/<adapter-id>/index.ts`.
- Keep agent-specific prompt shaping outside the orchestrator. The adapter may attach presentation metadata, but the orchestrator should only see normalized intent and execution input.
- `omg` should be able to run with `direct-cli` and no adapter present. Adapters are optional entry surfaces, not runtime prerequisites.

## 5. Skill loading

### 5.1 Discovery model

Skill content is declarative Markdown. Runtime code reads it, indexes it, and maps it to commands or pipelines. The recommended discovery order is:

1. project-local skills: `<repo>/skills/*/SKILL.md`
2. user-local skills: `~/.omg/skills/*/SKILL.md`
3. bundled skills shipped with the package

Precedence: project overrides user overrides bundled when `skillId` collides.

### 5.2 Skill metadata and loader interfaces

```ts
export interface SkillParameter {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'string[]';
  required: boolean;
  description: string;
  defaultValue?: string | number | boolean | readonly string[];
}

export interface SkillFrontmatter {
  id: string;
  title: string;
  description: string;
  aliases?: readonly string[];
  commands?: readonly string[];
  connectorIds?: readonly ConnectorId[];
  pipelineIds?: readonly PipelineId[];
  visibleToAdapters?: readonly (AdapterId | '*')[];
  parameters?: readonly SkillParameter[];
}

export interface SkillDefinition {
  id: string;
  source: 'project' | 'user' | 'bundled';
  directory: string;
  filePath: string;
  checksum: string;
  metadata: SkillFrontmatter;
  markdown: string;
}

export interface SkillCommandBinding {
  skillId: string;
  commandId: string;
  connectorId?: ConnectorId;
  pipelineId?: PipelineId;
  defaultArgs?: JsonObject;
}

export interface SkillIndex {
  byId: Record<string, SkillDefinition>;
  byAlias: Record<string, string>;
  bindings: readonly SkillCommandBinding[];
}

export interface SkillDiscoveryOptions {
  cwd: string;
  includeBundled: boolean;
  includeUser: boolean;
  includeProject: boolean;
}

export interface SkillLoader {
  discover(options: SkillDiscoveryOptions): Promise<readonly SkillDefinition[]>;
  load(filePath: string): Promise<SkillDefinition>;
  buildIndex(skills: readonly SkillDefinition[]): Promise<SkillIndex>;
}

export interface SkillRegistry {
  list(): readonly SkillDefinition[];
  get(skillId: string): SkillDefinition | null;
  resolveAlias(alias: string): SkillDefinition | null;
  resolveBinding(commandOrSkill: string): SkillCommandBinding | null;
}
```

### 5.3 Mapping rules

- `skills/<name>/SKILL.md` with frontmatter `id` becomes the canonical skill ID.
- If frontmatter is missing, infer `id` from the directory name and `title` from the first H1.
- `commands` maps a skill to one or more `omg` commands.
- `pipelineIds` maps a skill to a registered pipeline definition.
- `connectorIds` marks the relevant service(s) for discovery/UI filtering, but execution still goes through a command or pipeline binding.

Example:

```ts
export const EXAMPLE_BINDINGS: readonly SkillCommandBinding[] = [
  {
    skillId: 'omg-setup',
    commandId: 'setup'
  },
  {
    skillId: 'stitch',
    commandId: 'stitch',
    connectorId: 'stitch'
  },
  {
    skillId: 'pipeline',
    commandId: 'pipeline',
    pipelineId: 'design-code-deploy'
  }
];
```

### 5.4 Implementation notes

- Treat SKILL.md as data, not executable code.
- Parse frontmatter once and cache checksums for fast startup.
- `cli` should expose `omg skills list` and `omg skills show <id>` off the same `SkillRegistry`.
- Adapters should call `SkillRegistry` to advertise skill-capable commands to their host agent.
- Missing or malformed skills should produce warnings, not process-fatal errors.

## 6. Auth flow

### 6.1 Auth design goals

`omg` uses a **service-specific auth provider** pattern. Not all Google services use the same auth:

| Service | Auth method | Mechanism |
|---|---|---|
| Cloud Run | GCP ADC (OAuth2) | `gcloud auth application-default login` |
| Firebase | GCP ADC (OAuth2) | Same as Cloud Run |
| Jules | **API key** | `x-goog-api-key` header, issued at `jules.google.com/settings` |
| Stitch | **TBD** | MCP server auth mechanism undocumented |

The auth manager is central but delegates to service-specific providers:

```text
AuthManager
├── GcpAuthProvider     (ADC-based: Cloud Run, Firebase, BigQuery...)
├── ApiKeyProvider      (API key-based: Jules)
└── StitchAuthProvider  (TBD: added when Stitch auth is confirmed)
```

Auth flow:

```text
omg setup
  -> capture projectId / default region
  -> GCP OAuth browser flow (for ADC-based services)
  -> persist profile + GCP token bundle

omg jules setup
  -> prompt for Jules API key (from jules.google.com/settings)
  -> persist API key in credentials.json

run command
  -> orchestrator asks auth manager for connector auth
  -> auth manager routes to correct provider (ADC vs API key)
  -> provider refreshes if needed (ADC) or passes key (Jules)
  -> auth injection into connector
  -> connector executes
```

### 6.2 Auth interfaces

```ts
export interface ProjectProfile {
  projectId: string;
  defaultRegion?: string;
  accountEmail: string;
  createdAt: string;
  updatedAt: string;
}

export interface OAuthTokenBundle {
  accessToken?: string;
  refreshToken: string;
  idToken?: string;
  tokenType: 'Bearer';
  scope: readonly string[];
  expiryDate?: number;
}

export interface CredentialFile {
  version: 1;
  profile: ProjectProfile;
  token: OAuthTokenBundle;
  grantedScopes: readonly string[];
  updatedAt: string;
}

export type AuthInjection =
  | {
      target: 'rest-header';
      headers: {
        Authorization: string;
      };
    }
  | {
      target: 'api-key-header';
      headers: {
        'x-goog-api-key': string;
      };
    }
  | {
      target: 'google-client';
      accessToken: string;
      projectId: string;
    }
  | {
      target: 'gcloud-env';
      env: {
        CLOUDSDK_AUTH_ACCESS_TOKEN: string;
        CLOUDSDK_CORE_PROJECT: string;
        GOOGLE_CLOUD_PROJECT: string;
      };
    }
  | {
      target: 'firebase-env';
      env: {
        GOOGLE_APPLICATION_CREDENTIALS?: string;
        GOOGLE_CLOUD_PROJECT: string;
        FIREBASE_TOKEN?: string;
      };
      tempCredentialFile?: string;
    };

export interface AuthSession {
  profile: ProjectProfile;
  token: OAuthTokenBundle;
  grantedScopes: readonly string[];
  expiresAt: string;
}

export interface ServiceScopeDescriptor {
  connectorId: ConnectorId;
  requiredScopes: readonly string[];
  optionalScopes?: readonly string[];
  preferredTargets: readonly AuthInjectionTarget[];
}

export interface CredentialStore {
  read(): Promise<CredentialFile | null>;
  write(file: CredentialFile): Promise<void>;
  delete(): Promise<void>;
}

export interface ScopeBroker {
  getDescriptor(connectorId: ConnectorId): ServiceScopeDescriptor;
  ensureScopes(current: AuthSession, requiredScopes: readonly string[]): Promise<AuthSession>;
}

export interface AuthManager {
  setup(profile: Pick<ProjectProfile, 'projectId' | 'defaultRegion'>): Promise<ProjectProfile>;
  getSession(connectorId: ConnectorId): Promise<AuthSession>;
  refreshIfNeeded(session: AuthSession, minTtlMs: number): Promise<AuthSession>;
  buildInjection(
    session: AuthSession,
    requirement: ConnectorAuthRequirement
  ): Promise<AuthInjection>;
  revoke(): Promise<void>;
}
```

### 6.3 Scope and token strategy

Recommended initial scope registry:

```ts
export const SERVICE_SCOPE_MAP: Record<ConnectorId, ServiceScopeDescriptor> = {
  stitch: {
    connectorId: 'stitch',
    requiredScopes: ['https://www.googleapis.com/auth/cloud-platform'],
    preferredTargets: ['rest-header', 'google-client']
  },
  jules: {
    connectorId: 'jules',
    requiredScopes: [],  // Jules uses API key, not OAuth scopes
    preferredTargets: ['api-key-header'],
    notes: 'Jules REST API (v1alpha) uses x-goog-api-key header. Key issued at jules.google.com/settings.'
  },
  'cloud-run': {
    connectorId: 'cloud-run',
    requiredScopes: ['https://www.googleapis.com/auth/cloud-platform'],
    preferredTargets: ['gcloud-env']
  },
  firebase: {
    connectorId: 'firebase',
    requiredScopes: [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/firebase'
    ],
    preferredTargets: ['firebase-env']
  }
};
```

Storage and refresh rules:

- Persist `CredentialFile` at `~/.omg/credentials.json`.
- Lock permissions to current user only.
- Refresh when `expiryDate` is within five minutes of the current time.
- If a connector needs scopes not already granted, the auth broker initiates a scope upgrade flow and then rewrites `credentials.json`.

### 6.4 Concrete implementation notes

- Use `google-auth-library` `OAuth2Client` as the primary refresh engine.
- Keep the refresh token in `credentials.json` for MVP consistency with the PRD. Abstract it behind `CredentialStore` so a future OS-keychain backend can replace file storage without touching connectors or the orchestrator.
- For `gcloud`, inject `CLOUDSDK_AUTH_ACCESS_TOKEN` and project vars into the spawned process environment.
- For `firebase`, prefer an ephemeral ADC file written to a temp directory and referenced via `GOOGLE_APPLICATION_CREDENTIALS`. Use `FIREBASE_TOKEN` only when ADC is not supported by the execution path.
- Never let connectors call login flows themselves. They must fail with a normalized `auth` error and let the CLI or adapter surface the remediation.

## 7. Safety guardrails

### 7.1 Error type hierarchy

```ts
export class OmgError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly recoverable: boolean,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class AuthError extends OmgError {}        // Auth failure/expired/missing
export class ApiError extends OmgError {}          // Google API error (4xx/5xx)
export class QuotaError extends OmgError {}        // Rate limit / quota exceeded
export class ValidationError extends OmgError {}   // Pre/post validation failure
export class TimeoutError extends OmgError {}      // Operation timeout
export class CliRunnerError extends OmgError {}    // gcloud/firebase CLI error
export class PolicyError extends OmgError {}       // 2-hop violation, forbidden action
```

### 7.2 Retry and recovery policy

```text
Error occurs in connector
  │
  ├─ AuthError → halt entire pipeline, surface "omg setup" / "omg auth refresh"
  ├─ QuotaError (recoverable) → exponential backoff, max 3 retries
  ├─ ApiError 5xx (recoverable) → 1 retry after 2s
  ├─ ApiError 4xx → halt, show error cause
  ├─ TimeoutError → 1 retry
  └─ ValidationError → rollback if possible, then halt
```

### 7.3 Cost and deployment protection

| Guardrail | Applies to | Behavior |
|---|---|---|
| `--dry-run` | deploy, pipeline | Show execution plan, no actual calls |
| User confirmation prompt | deploy, pipeline deploy steps | "Deploy <service> to <region>? (y/N)" |
| `--yes` / `-y` flag | All confirmable actions | Skip confirmation (CI/CD use) |
| Timeout | All connectors | Default 5min, configurable per connector |
| Rollback on failure | Pipeline steps with `rollbackPolicy != 'none'` | Auto-rollback completed reversible steps |

### 7.4 Connector-specific rollback capability

| Connector | Rollback? | Mechanism |
|---|---|---|
| Cloud Run | ✅ | Restore previous revision |
| Jules | ⚠️ partial | Cancel session (PR must be closed manually) |
| Firebase | ✅ | Restore previous deployment |
| Stitch | ❌ | Generated designs cannot be auto-deleted |

## Recommended initial file layout

This keeps the boundaries above explicit:

```text
src/
  cli/
    bootstrap.ts
    commands/
  auth/
    auth-manager.ts
    credential-store.ts
    scope-broker.ts
  connectors/
    base-connector.ts
    stitch-connector.ts
    jules-connector.ts
    cloud-run-connector.ts
    firebase-connector.ts
  orchestrator/
    pipeline-orchestrator.ts
    execution-repository.ts
    hop-policy.ts
    validators.ts
  adapters/
    claude-code/
    codex/
    gemini-cli/
    antigravity/
  skills/
    loader.ts
    registry.ts
skills/
  omg-setup/SKILL.md
  stitch/SKILL.md
  jules/SKILL.md
  deploy/SKILL.md
  pipeline/SKILL.md
```

## Implementation order

### MVP-alpha: CLI + Auth + Cloud Run

1. Build `auth/` (AuthManager, GcpAuthProvider, CredentialStore) and `ConnectorRegistry`.
2. Implement generic connector base contract + `CloudRunConnector` only.
3. Build CLI commands: `omg setup`, `omg auth`, `omg doctor`, `omg deploy`.
4. Unit tests for auth + Cloud Run connector (mock API responses).
5. Acceptance: `omg deploy --dry-run` shows plan, `omg deploy` deploys to real Cloud Run.

### MVP-beta: Jules + Pipeline

6. Add `ApiKeyProvider` for Jules, `omg jules setup`.
7. Implement `JulesConnector` (AsyncConnector: submit → poll → result).
8. Implement `PipelineOrchestrator` with ExecutionRepository and rollback.
9. Build `omg jules` and `omg pipeline` commands.
10. Add Claude Code adapter (SKILL.md + bash wrapper).
11. Add `SkillLoader` and `SkillRegistry`.

### Phase 2

12. `StitchConnector` (when MCP auth is confirmed).
13. `FirebaseConnector` on the same contract.
14. Gemini CLI, Antigravity adapters.
15. Additional pipelines (design-code-deploy when Stitch is ready).
