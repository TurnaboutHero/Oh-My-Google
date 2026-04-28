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
