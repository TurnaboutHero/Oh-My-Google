import { auditBillingGuard, type BillingGuardAudit } from "./billing-audit.js";
import {
  planBudgetApiMutation,
  verifyBudgetEnsurePostState,
  type BudgetApiBudgetPayload,
  type BudgetApiMutationPlan,
  type BudgetEnsurePlan,
  type BudgetEnsurePostVerification,
} from "./budget-policy.js";
import { ValidationError } from "../types/errors.js";

const BUDGET_API_BASE_URL = "https://billingbudgets.googleapis.com/v1";

export type BudgetApiHttpMethod = "POST" | "PATCH";

export type BudgetApiTransportFailureCode =
  | "NO_AUTH"
  | "ACCOUNT_MISMATCH"
  | "BUDGET_API_TOKEN_COMMAND_FAILED"
  | "BUDGET_API_INVALID_REQUEST"
  | "BUDGET_API_UNAUTHENTICATED"
  | "BUDGET_API_PERMISSION_DENIED"
  | "BUDGET_API_NOT_FOUND"
  | "BUDGET_API_CONFLICT"
  | "BUDGET_API_RATE_LIMITED"
  | "BUDGET_API_UNAVAILABLE"
  | "BUDGET_API_REQUEST_FAILED";

export interface BudgetApiRequest {
  method: BudgetApiHttpMethod;
  url: string;
  path: string;
  headers: {
    "content-type": "application/json";
    "x-goog-user-project": string;
  };
  body: BudgetApiBudgetPayload;
}

export type BudgetApiRequestExecutor = (
  request: BudgetApiRequest,
) => Promise<BudgetApiBudgetPayload>;

export type BudgetEnsureAuditProvider = (
  projectId: string,
) => Promise<BillingGuardAudit>;

export interface BudgetApiTransportFailure {
  code: BudgetApiTransportFailureCode;
  message: string;
  recoverable: boolean;
  retryable: boolean;
  statusCode?: number;
  retryAfterMs?: number;
  reason?: string;
  next: string[];
}

export interface CreateBudgetInput {
  apiUserProjectId: string;
  parent: string;
  budget: BudgetApiBudgetPayload;
}

export interface UpdateBudgetInput {
  apiUserProjectId: string;
  name: string;
  updateMask: string[];
  budget: BudgetApiBudgetPayload;
}

export type BudgetApiMutationExecutionResult =
  | {
      action: "none";
      executed: false;
      blockers: [];
    }
  | {
      action: "blocked";
      executed: false;
      blockers: string[];
    }
  | {
      action: "create" | "update";
      executed: true;
      request: BudgetApiRequest;
      budget: BudgetApiBudgetPayload;
      blockers: [];
    };

export type BudgetEnsureExecutionResult =
  | {
      ok: true;
      mutation: BudgetApiMutationPlan;
      mutationResult: BudgetApiMutationExecutionResult;
      postVerification: BudgetEnsurePostVerification;
    }
  | {
      ok: false;
      errorCode: "BUDGET_ENSURE_MUTATION_BLOCKED" | "BUDGET_ENSURE_POST_VERIFY_FAILED";
      mutation: BudgetApiMutationPlan;
      mutationResult: BudgetApiMutationExecutionResult;
      postVerification?: BudgetEnsurePostVerification;
      blockers: string[];
    };

export function buildCreateBudgetRequest(input: CreateBudgetInput): BudgetApiRequest {
  const apiUserProjectId = normalizeProjectId(input.apiUserProjectId);
  const parent = normalizeBillingParent(input.parent);
  validateBudgetPayload(input.budget);

  const path = `/v1/${parent}/budgets`;
  return {
    method: "POST",
    url: `${BUDGET_API_BASE_URL}/${parent}/budgets`,
    path,
    headers: buildHeaders(apiUserProjectId),
    body: input.budget,
  };
}

export function buildUpdateBudgetRequest(input: UpdateBudgetInput): BudgetApiRequest {
  const apiUserProjectId = normalizeProjectId(input.apiUserProjectId);
  const name = normalizeBudgetName(input.name);
  const updateMask = normalizeUpdateMask(input.updateMask);
  validateBudgetPayload(input.budget);

  const query = new URLSearchParams({ updateMask: updateMask.join(",") }).toString();
  const path = `/v1/${name}?${query}`;
  return {
    method: "PATCH",
    url: `${BUDGET_API_BASE_URL}/${name}?${query}`,
    path,
    headers: buildHeaders(apiUserProjectId),
    body: input.budget,
  };
}

export function mapBudgetApiTokenFailure(input: {
  projectId?: string;
  expectedAccount?: string;
  activeAccount?: string;
  exitCode?: number;
  stderr?: string;
  message?: string;
}): BudgetApiTransportFailure {
  const expectedAccount = input.expectedAccount?.trim();
  const activeAccount = input.activeAccount?.trim();
  const details = `${input.stderr ?? ""}\n${input.message ?? ""}`.trim();
  const normalized = details.toLowerCase();

  if (expectedAccount && activeAccount && expectedAccount !== activeAccount) {
    return {
      code: "ACCOUNT_MISMATCH",
      message: `Active gcloud account ${activeAccount} does not match expected account ${expectedAccount}.`,
      recoverable: true,
      retryable: false,
      reason: "Budget API live transport must not silently switch accounts.",
      next: ["omg auth context", "Switch accounts explicitly before retrying."],
    };
  }

  if (
    normalized.includes("not authenticated")
    || normalized.includes("no active account")
    || normalized.includes("active account selected")
    || normalized.includes("login required")
    || normalized.includes("relogin")
  ) {
    return {
      code: "NO_AUTH",
      message: "gcloud is not authenticated, so a Budget API access token cannot be issued.",
      recoverable: true,
      retryable: false,
      reason: summarizeFailureReason(details),
      next: ["omg auth context", "omg setup --login"],
    };
  }

  return {
    code: "BUDGET_API_TOKEN_COMMAND_FAILED",
    message: "Failed to issue a gcloud access token for the Budget API transport.",
    recoverable: true,
    retryable: false,
    reason: summarizeFailureReason(details || `gcloud exited with code ${input.exitCode ?? "unknown"}.`),
    next: ["omg auth context", "gcloud auth print-access-token"],
  };
}

export function mapBudgetApiHttpFailure(input: {
  statusCode: number;
  projectId?: string;
  responseBody?: unknown;
  message?: string;
  retryAfterMs?: number;
}): BudgetApiTransportFailure {
  const reason = summarizeFailureReason(extractGoogleApiMessage(input.responseBody) ?? input.message ?? "");
  const next = getBudgetApiHttpFailureNext(input.statusCode, input.projectId);

  if (input.statusCode === 400) {
    return {
      code: "BUDGET_API_INVALID_REQUEST",
      message: "Budget API rejected the request payload.",
      recoverable: true,
      retryable: false,
      statusCode: input.statusCode,
      reason,
      next,
    };
  }

  if (input.statusCode === 401) {
    return {
      code: "BUDGET_API_UNAUTHENTICATED",
      message: "Budget API rejected the request authentication.",
      recoverable: true,
      retryable: false,
      statusCode: input.statusCode,
      reason,
      next,
    };
  }

  if (input.statusCode === 403) {
    return {
      code: "BUDGET_API_PERMISSION_DENIED",
      message: "Budget API permission was denied.",
      recoverable: true,
      retryable: false,
      statusCode: input.statusCode,
      reason,
      next,
    };
  }

  if (input.statusCode === 404) {
    return {
      code: "BUDGET_API_NOT_FOUND",
      message: "Budget API target resource was not found.",
      recoverable: true,
      retryable: false,
      statusCode: input.statusCode,
      reason,
      next,
    };
  }

  if (input.statusCode === 409) {
    return {
      code: "BUDGET_API_CONFLICT",
      message: "Budget API reported a write conflict.",
      recoverable: true,
      retryable: false,
      statusCode: input.statusCode,
      reason,
      next,
    };
  }

  if (input.statusCode === 429) {
    return {
      code: "BUDGET_API_RATE_LIMITED",
      message: "Budget API rate limit was exceeded.",
      recoverable: true,
      retryable: true,
      statusCode: input.statusCode,
      retryAfterMs: input.retryAfterMs,
      reason,
      next,
    };
  }

  if (input.statusCode >= 500 && input.statusCode <= 599) {
    return {
      code: "BUDGET_API_UNAVAILABLE",
      message: "Budget API is temporarily unavailable.",
      recoverable: true,
      retryable: true,
      statusCode: input.statusCode,
      retryAfterMs: input.retryAfterMs,
      reason,
      next,
    };
  }

  return {
    code: "BUDGET_API_REQUEST_FAILED",
    message: "Budget API request failed.",
    recoverable: true,
    retryable: false,
    statusCode: input.statusCode,
    reason,
    next,
  };
}

export async function createBudget(
  input: CreateBudgetInput,
  executor: BudgetApiRequestExecutor,
): Promise<BudgetApiBudgetPayload> {
  return executor(buildCreateBudgetRequest(input));
}

export async function updateBudget(
  input: UpdateBudgetInput,
  executor: BudgetApiRequestExecutor,
): Promise<BudgetApiBudgetPayload> {
  return executor(buildUpdateBudgetRequest(input));
}

export async function executeBudgetApiMutation(input: {
  mutation: BudgetApiMutationPlan;
  apiUserProjectId: string;
  executor: BudgetApiRequestExecutor;
}): Promise<BudgetApiMutationExecutionResult> {
  const apiUserProjectId = normalizeProjectId(input.apiUserProjectId);
  const mutation = input.mutation;

  if (mutation.action === "blocked") {
    return {
      action: "blocked",
      executed: false,
      blockers: mutation.blockers,
    };
  }

  if (mutation.action === "none") {
    return {
      action: "none",
      executed: false,
      blockers: [],
    };
  }

  if (mutation.action === "create") {
    if (!mutation.parent || !mutation.budget) {
      return missingMutationFields("create");
    }
    const request = buildCreateBudgetRequest({
      apiUserProjectId,
      parent: mutation.parent,
      budget: mutation.budget,
    });
    const budget = await input.executor(request);
    return {
      action: "create",
      executed: true,
      request,
      budget,
      blockers: [],
    };
  }

  if (!mutation.name || !mutation.updateMask || !mutation.budget) {
    return missingMutationFields("update");
  }
  const request = buildUpdateBudgetRequest({
    apiUserProjectId,
    name: mutation.name,
    updateMask: mutation.updateMask,
    budget: mutation.budget,
  });
  const budget = await input.executor(request);
  return {
    action: "update",
    executed: true,
    request,
    budget,
    blockers: [],
  };
}

export async function executeBudgetEnsureWithPostVerification(input: {
  plan: BudgetEnsurePlan;
  apiUserProjectId?: string;
  executor: BudgetApiRequestExecutor;
  auditAfterMutation?: BudgetEnsureAuditProvider;
}): Promise<BudgetEnsureExecutionResult> {
  const mutation = planBudgetApiMutation(input.plan);
  const mutationResult = await executeBudgetApiMutation({
    mutation,
    apiUserProjectId: input.apiUserProjectId ?? input.plan.projectId,
    executor: input.executor,
  });

  if (mutationResult.action === "blocked") {
    return {
      ok: false,
      errorCode: "BUDGET_ENSURE_MUTATION_BLOCKED",
      mutation,
      mutationResult,
      blockers: mutationResult.blockers,
    };
  }

  const auditAfterMutation = input.auditAfterMutation ?? auditBillingGuard;
  const postAudit = await auditAfterMutation(input.plan.projectId);
  const postVerification = verifyBudgetEnsurePostState(postAudit, input.plan.desiredPolicy);

  if (!postVerification.verified) {
    return {
      ok: false,
      errorCode: "BUDGET_ENSURE_POST_VERIFY_FAILED",
      mutation,
      mutationResult,
      postVerification,
      blockers: postVerification.blockers,
    };
  }

  return {
    ok: true,
    mutation,
    mutationResult,
    postVerification,
  };
}

function buildHeaders(apiUserProjectId: string): BudgetApiRequest["headers"] {
  return {
    "content-type": "application/json",
    "x-goog-user-project": apiUserProjectId,
  };
}

function getBudgetApiHttpFailureNext(statusCode: number, projectId: string | undefined): string[] {
  const next: string[] = [];
  if (statusCode === 401 || statusCode === 403) {
    next.push("omg auth context");
  }
  if (projectId) {
    next.push(`omg budget audit --project ${projectId}`);
    next.push(`omg budget ensure --project ${projectId} --amount <amount> --currency <code> --dry-run`);
  } else {
    next.push("Run budget audit and budget ensure dry-run before retrying.");
  }
  if (statusCode === 429 || statusCode >= 500) {
    next.push("Retry only after backoff; do not repeat blindly.");
  }
  return next;
}

function extractGoogleApiMessage(responseBody: unknown): string | undefined {
  if (!responseBody || typeof responseBody !== "object") {
    return typeof responseBody === "string" ? responseBody : undefined;
  }

  const record = responseBody as Record<string, unknown>;
  const error = record.error && typeof record.error === "object"
    ? record.error as Record<string, unknown>
    : undefined;
  const message = typeof error?.message === "string"
    ? error.message
    : typeof record.message === "string"
      ? record.message
      : undefined;
  const status = typeof error?.status === "string" ? error.status : undefined;
  return [status, message].filter(Boolean).join(": ") || undefined;
}

function summarizeFailureReason(reason: string): string | undefined {
  const trimmed = reason.trim();
  if (!trimmed) {
    return undefined;
  }
  return trimmed.length > 300 ? `${trimmed.slice(0, 297)}...` : trimmed;
}

function missingMutationFields(action: "create" | "update"): BudgetApiMutationExecutionResult {
  return {
    action: "blocked",
    executed: false,
    blockers: [`Budget API ${action} mutation plan is incomplete.`],
  };
}

function validateBudgetPayload(budget: BudgetApiBudgetPayload): void {
  if (!budget.displayName.trim()) {
    throw new ValidationError("Budget display name is required.");
  }
  if (budget.budgetFilter.projects.length === 0) {
    throw new ValidationError("Budget API payload must include at least one project filter.");
  }
  for (const project of budget.budgetFilter.projects) {
    if (!/^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project)) {
      throw new ValidationError("Budget API project filter must use projects/{projectId}.");
    }
  }
  if (!/^[A-Z]{3}$/.test(budget.amount.specifiedAmount.currencyCode)) {
    throw new ValidationError("Budget API payload requires a 3-letter currency code.");
  }
  if (!budget.thresholdRules.length) {
    throw new ValidationError("Budget API payload requires at least one threshold rule.");
  }
}

function normalizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(trimmed)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return trimmed;
}

function normalizeBillingParent(parent: string): string {
  const trimmed = parent.trim();
  if (!/^billingAccounts\/[A-Za-z0-9-]+$/.test(trimmed)) {
    throw new ValidationError("Budget API parent must use billingAccounts/{billingAccountId}.");
  }
  return trimmed;
}

function normalizeBudgetName(name: string): string {
  const trimmed = name.trim();
  if (!/^billingAccounts\/[A-Za-z0-9-]+\/budgets\/[A-Za-z0-9_-]+$/.test(trimmed)) {
    throw new ValidationError("Budget API name must use billingAccounts/{billingAccountId}/budgets/{budgetId}.");
  }
  return trimmed;
}

function normalizeUpdateMask(updateMask: string[]): string[] {
  const mask = [...new Set(updateMask.map((field) => field.trim()).filter(Boolean))];
  if (!mask.length || mask.some((field) => !/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z][A-Za-z0-9]*)*$/.test(field))) {
    throw new ValidationError("Budget API update mask is invalid.");
  }
  return mask;
}
