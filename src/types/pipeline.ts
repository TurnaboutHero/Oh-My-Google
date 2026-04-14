import type { ConnectorId, ConnectorResult, ConnectorStatus, ProjectRef } from "./connector.js";

export type PipelineId = "code-to-deploy" | "deploy-only" | "custom";

export type StepState = "pending" | "skipped" | "running" | "completed" | "failed" | "rolled-back";

export interface PipelineStep {
  id: string;
  connectorId: ConnectorId;
  action: string;
  dependsOn: string[];
  rollbackPolicy: "none" | "best-effort" | "required";
  timeoutMs: number;
  buildParams(context: PipelineContext): Record<string, unknown>;
  validateOutput?(status: ConnectorStatus): Promise<boolean>;
  skipIf?(context: PipelineContext): boolean;
}

export interface Pipeline {
  id: PipelineId;
  description: string;
  steps: PipelineStep[];
}

export interface StepRecord {
  stepId: string;
  connectorId: ConnectorId;
  state: StepState;
  startedAt?: string;
  completedAt?: string;
  result?: ConnectorResult;
}

export type PipelineState = "planned" | "running" | "completed" | "failed" | "rolled-back" | "cancelled";

export interface PipelineContext {
  results: Map<string, ConnectorResult>;
  project: ProjectRef;
  dryRun: boolean;
  payload: Record<string, unknown>;
}

export interface PipelineRecord {
  executionId: string;
  pipelineId: PipelineId;
  project: ProjectRef;
  state: PipelineState;
  createdAt: string;
  updatedAt: string;
  stepRuns: Record<string, StepRecord>;
}

export type StepSelector =
  | { mode: "all" }
  | { mode: "single"; stepId: string }
  | { mode: "from"; fromStepId: string }
  | { mode: "only"; stepIds: string[] };
