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

export class AuthError extends OmgError {
  constructor(message: string, code = "AUTH_ERROR") {
    super(message, code, false);
  }
}

export class ApiError extends OmgError {
  constructor(
    message: string,
    public readonly statusCode: number,
    code = "API_ERROR",
  ) {
    super(message, code, statusCode >= 500);
  }
}

export class QuotaError extends OmgError {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message, "QUOTA_EXCEEDED", true);
  }
}

export class ValidationError extends OmgError {
  constructor(message: string) {
    super(message, "VALIDATION_ERROR", false);
  }
}

export class TimeoutError extends OmgError {
  constructor(message: string, public readonly timeoutMs: number) {
    super(message, "TIMEOUT", true);
  }
}

export class CliRunnerError extends OmgError {
  constructor(
    message: string,
    public readonly exitCode: number,
    public readonly stderr: string,
  ) {
    super(message, "CLI_RUNNER_ERROR", false);
  }
}

export class PolicyError extends OmgError {
  constructor(message: string) {
    super(message, "POLICY_VIOLATION", false);
  }
}

export type ApprovalErrorCode =
  | "APPROVAL_REQUIRED"
  | "APPROVAL_NOT_FOUND"
  | "APPROVAL_EXPIRED"
  | "APPROVAL_NOT_APPROVED"
  | "APPROVAL_MISMATCH"
  | "ACCOUNT_MISMATCH"
  | "APPROVAL_CONSUMED";

export class ApprovalError extends OmgError {
  constructor(
    public readonly approvalCode: ApprovalErrorCode,
    message: string,
    public readonly approvalId?: string,
  ) {
    super(message, approvalCode, false);
    this.name = "ApprovalError";
  }
}
