import type { OmgError } from "./errors.js";

export type ConnectorId = "cloud-run" | "jules" | "stitch" | "firebase";

export type OperationState =
  | "accepted"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "rolled-back";

export interface ProjectRef {
  projectId: string;
  region?: string;
}

export interface ConnectorConfig {
  project: ProjectRef;
}

export interface ConnectorResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: OmgError;
  metadata: {
    connector: ConnectorId;
    action: string;
    durationMs: number;
    timestamp: string;
  };
}

export interface OperationHandle {
  connectorId: ConnectorId;
  operationId: string;
  externalId?: string;
  deliveryMode: "sync" | "async";
  createdAt: string;
  pollAfterMs?: number;
}

export interface ConnectorStatus<T = unknown> {
  handle: OperationHandle;
  state: OperationState;
  percent?: number;
  result?: T;
  error?: OmgError;
}

export interface HealthStatus {
  healthy: boolean;
  message: string;
  details?: Record<string, unknown>;
}

/**
 * Base connector interface.
 * All Google service connectors implement this contract.
 */
export interface Connector<TRequest = Record<string, unknown>, TResult = unknown> {
  readonly id: ConnectorId;
  readonly displayName: string;

  /** Check service accessibility (for omg doctor) */
  healthCheck(config: ConnectorConfig): Promise<HealthStatus>;

  /** Execute an action */
  execute(action: string, params: TRequest, config: ConnectorConfig): Promise<ConnectorResult<TResult>>;

  /** Validate result after execution */
  validate(result: ConnectorResult<TResult>): Promise<boolean>;

  /** Rollback if possible */
  rollback?(action: string, config: ConnectorConfig): Promise<void>;
}

/**
 * Extended interface for async services (Jules).
 * Supports submit → poll → result pattern.
 */
export interface AsyncConnector<TRequest = Record<string, unknown>, TResult = unknown>
  extends Connector<TRequest, TResult> {

  /** Submit task, returns operation handle */
  submit(params: TRequest, config: ConnectorConfig): Promise<OperationHandle>;

  /** Poll for progress */
  poll(handle: OperationHandle, config: ConnectorConfig): Promise<ConnectorStatus<TResult>>;

  /** Get final result */
  result(handle: OperationHandle, config: ConnectorConfig): Promise<ConnectorResult<TResult>>;

  /** Cancel running operation */
  cancel(handle: OperationHandle, config: ConnectorConfig): Promise<void>;
}
