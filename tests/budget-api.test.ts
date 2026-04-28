import { describe, expect, it, vi } from "vitest";
import {
  buildCreateBudgetRequest,
  buildUpdateBudgetRequest,
  BudgetApiTransportError,
  createBudgetApiFetchExecutor,
  executeBudgetApiMutation,
  executeBudgetEnsureWithPostVerification,
  getGcloudBudgetApiAccessToken,
  mapBudgetApiHttpFailure,
  mapBudgetApiTokenFailure,
  type BudgetApiFetch,
  type BudgetApiRequestExecutor,
} from "../src/connectors/budget-api.js";
import { planBudgetApiMutation, planBudgetEnsure } from "../src/connectors/budget-policy.js";
import type { BillingGuardAudit } from "../src/connectors/billing-audit.js";

describe("budget API executor core", () => {
  it("builds a create request without executing the transport", () => {
    const plan = planBudgetApiMutation(createPlan());

    expect(plan.action).toBe("create");
    const request = buildCreateBudgetRequest({
      apiUserProjectId: "demo-project",
      parent: plan.parent ?? "",
      budget: plan.budget!,
    });

    expect(request).toMatchObject({
      method: "POST",
      url: "https://billingbudgets.googleapis.com/v1/billingAccounts/ABC-123/budgets",
      path: "/v1/billingAccounts/ABC-123/budgets",
      headers: {
        "content-type": "application/json",
        "x-goog-user-project": "demo-project",
      },
      body: {
        displayName: "omg budget guard: demo-project",
      },
    });
  });

  it("builds an update request with a conservative update mask", () => {
    const plan = planBudgetApiMutation(updatePlan());

    expect(plan.action).toBe("update");
    const request = buildUpdateBudgetRequest({
      apiUserProjectId: "demo-project",
      name: plan.name ?? "",
      updateMask: plan.updateMask ?? [],
      budget: plan.budget!,
    });

    expect(request.method).toBe("PATCH");
    expect(request.url).toContain(
      "https://billingbudgets.googleapis.com/v1/billingAccounts/ABC-123/budgets/budget-1?",
    );
    expect(request.url).toContain("updateMask=displayName%2CbudgetFilter%2Camount%2CthresholdRules");
    expect(request.body.name).toBe("billingAccounts/ABC-123/budgets/budget-1");
  });

  it("executes create and update through an injected transport only", async () => {
    const executor = vi.fn<BudgetApiRequestExecutor>(async (request) => ({
      name: request.method === "POST"
        ? "billingAccounts/ABC-123/budgets/budget-2"
        : request.body.name,
      ...request.body,
    }));

    const createResult = await executeBudgetApiMutation({
      mutation: planBudgetApiMutation(createPlan()),
      apiUserProjectId: "demo-project",
      executor,
    });
    const updateResult = await executeBudgetApiMutation({
      mutation: planBudgetApiMutation(updatePlan()),
      apiUserProjectId: "demo-project",
      executor,
    });

    expect(createResult).toMatchObject({ action: "create", executed: true });
    expect(updateResult).toMatchObject({ action: "update", executed: true });
    expect(executor).toHaveBeenCalledTimes(2);
  });

  it("does not execute transport for none or blocked mutation plans", async () => {
    const executor = vi.fn<BudgetApiRequestExecutor>();
    const noneResult = await executeBudgetApiMutation({
      mutation: planBudgetApiMutation(noopPlan()),
      apiUserProjectId: "demo-project",
      executor,
    });
    const blockedResult = await executeBudgetApiMutation({
      mutation: planBudgetApiMutation(blockedPlan()),
      apiUserProjectId: "demo-project",
      executor,
    });

    expect(noneResult).toEqual({ action: "none", executed: false, blockers: [] });
    expect(blockedResult).toMatchObject({ action: "blocked", executed: false });
    expect(executor).not.toHaveBeenCalled();
  });

  it("post-verifies a successful create through a supplied audit provider", async () => {
    const executor = vi.fn<BudgetApiRequestExecutor>(async (request) => ({
      name: "billingAccounts/ABC-123/budgets/budget-2",
      ...request.body,
    }));
    const auditAfterMutation = vi.fn(async () => configuredAudit());

    const result = await executeBudgetEnsureWithPostVerification({
      plan: createPlan(),
      executor,
      auditAfterMutation,
    });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.mutationResult.executed : undefined).toBe(true);
    expect(result.ok ? result.postVerification.verified : undefined).toBe(true);
    expect(auditAfterMutation).toHaveBeenCalledWith("demo-project");
  });

  it("returns a structured post-verification failure without claiming success", async () => {
    const executor = vi.fn<BudgetApiRequestExecutor>(async (request) => ({
      name: "billingAccounts/ABC-123/budgets/budget-2",
      ...request.body,
    }));
    const auditAfterMutation = vi.fn(async () => baseAudit());

    const result = await executeBudgetEnsureWithPostVerification({
      plan: createPlan(),
      executor,
      auditAfterMutation,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.errorCode).toBe("BUDGET_ENSURE_POST_VERIFY_FAILED");
    expect(result.ok ? undefined : result.postVerification?.verified).toBe(false);
  });

  it("maps token command auth and account failures without retrying", () => {
    expect(mapBudgetApiTokenFailure({
      expectedAccount: "owner@example.com",
      activeAccount: "other@example.com",
    })).toMatchObject({
      code: "ACCOUNT_MISMATCH",
      recoverable: true,
      retryable: false,
      next: ["omg auth context", "Switch accounts explicitly before retrying."],
    });

    expect(mapBudgetApiTokenFailure({
      stderr: "ERROR: (gcloud.auth.print-access-token) You do not currently have an active account selected.",
    })).toMatchObject({
      code: "NO_AUTH",
      retryable: false,
      next: ["omg auth context", "omg setup --login"],
    });

    expect(mapBudgetApiTokenFailure({
      exitCode: 2,
      stderr: "unexpected gcloud failure",
    })).toMatchObject({
      code: "BUDGET_API_TOKEN_COMMAND_FAILED",
      retryable: false,
      reason: "unexpected gcloud failure",
    });
  });

  it("maps non-retryable Budget API HTTP failures to structured codes", () => {
    const cases = [
      [400, "BUDGET_API_INVALID_REQUEST"],
      [401, "BUDGET_API_UNAUTHENTICATED"],
      [403, "BUDGET_API_PERMISSION_DENIED"],
      [404, "BUDGET_API_NOT_FOUND"],
      [409, "BUDGET_API_CONFLICT"],
    ] as const;

    for (const [statusCode, code] of cases) {
      const failure = mapBudgetApiHttpFailure({
        statusCode,
        projectId: "demo-project",
        responseBody: {
          error: {
            status: "PERMISSION_DENIED",
            message: "caller lacks permission",
          },
        },
      });

      expect(failure).toMatchObject({
        code,
        statusCode,
        recoverable: true,
        retryable: false,
        reason: "PERMISSION_DENIED: caller lacks permission",
      });
      expect(failure.next).toContain("omg budget audit --project demo-project");
    }
  });

  it("marks rate limit and server Budget API failures as retryable", () => {
    expect(mapBudgetApiHttpFailure({
      statusCode: 429,
      projectId: "demo-project",
      retryAfterMs: 30_000,
      responseBody: { error: { status: "RESOURCE_EXHAUSTED", message: "quota exceeded" } },
    })).toMatchObject({
      code: "BUDGET_API_RATE_LIMITED",
      retryable: true,
      retryAfterMs: 30_000,
    });

    expect(mapBudgetApiHttpFailure({
      statusCode: 503,
      projectId: "demo-project",
      responseBody: { error: { status: "UNAVAILABLE", message: "backend unavailable" } },
    })).toMatchObject({
      code: "BUDGET_API_UNAVAILABLE",
      retryable: true,
      statusCode: 503,
    });
  });

  it("gets a gcloud access token through an injected token command executor", async () => {
    const executor = vi.fn(async (args: string[]) => ({
      stdout: " ya29.test-token \n",
      stderr: "",
      args,
    }));

    await expect(getGcloudBudgetApiAccessToken({ executor })).resolves.toBe("ya29.test-token");
    expect(executor).toHaveBeenCalledWith(["auth", "print-access-token"]);
  });

  it("maps gcloud token command failure to a transport error", async () => {
    const executor = vi.fn(async () => {
      throw Object.assign(new Error("not authenticated"), {
        stderr: "ERROR: no active account selected",
        code: 1,
      });
    });

    await expect(getGcloudBudgetApiAccessToken({ executor })).rejects.toMatchObject({
      failure: {
        code: "NO_AUTH",
        retryable: false,
      },
    });
  });

  it("executes Budget API requests with bearer auth and quota project headers through injected fetch", async () => {
    const fetchImpl = vi.fn<BudgetApiFetch>(async (_url, _init) => ({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: { get: () => null },
      text: async () => JSON.stringify({
        name: "billingAccounts/ABC-123/budgets/budget-2",
        displayName: "omg budget guard: demo-project",
        budgetFilter: {
          projects: ["projects/demo-project"],
          calendarPeriod: "MONTH",
          creditTypesTreatment: "INCLUDE_ALL_CREDITS",
        },
        amount: { specifiedAmount: { currencyCode: "KRW", units: "50000" } },
        thresholdRules: [{ thresholdPercent: 1, spendBasis: "CURRENT_SPEND" }],
      }),
    }));
    const executor = createBudgetApiFetchExecutor({
      apiUserProjectId: "demo-project",
      tokenProvider: async () => "ya29.test-token",
      fetchImpl,
    });
    const mutation = planBudgetApiMutation(createPlan());
    const request = buildCreateBudgetRequest({
      apiUserProjectId: "demo-project",
      parent: "billingAccounts/ABC-123",
      budget: mutation.budget!,
    });

    await expect(executor(request)).resolves.toMatchObject({
      displayName: "omg budget guard: demo-project",
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://billingbudgets.googleapis.com/v1/billingAccounts/ABC-123/budgets",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer ya29.test-token",
          "content-type": "application/json",
          "x-goog-user-project": "demo-project",
        }),
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toMatchObject({
      displayName: "omg budget guard: demo-project",
    });
  });

  it("does not call fetch when the token provider returns an empty token", async () => {
    const fetchImpl = vi.fn<BudgetApiFetch>();
    const executor = createBudgetApiFetchExecutor({
      apiUserProjectId: "demo-project",
      tokenProvider: async () => " ",
      fetchImpl,
    });
    const request = buildCreateBudgetRequest({
      apiUserProjectId: "demo-project",
      parent: "billingAccounts/ABC-123",
      budget: planBudgetApiMutation(createPlan()).budget!,
    });

    await expect(executor(request)).rejects.toMatchObject({
      failure: {
        code: "BUDGET_API_TOKEN_COMMAND_FAILED",
        retryable: false,
      },
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps Budget API fetch failures through the transport error contract", async () => {
    const fetchImpl = vi.fn<BudgetApiFetch>(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      headers: { get: () => null },
      text: async () => JSON.stringify({
        error: {
          status: "PERMISSION_DENIED",
          message: "caller lacks billing.budgets.create",
        },
      }),
    }));
    const executor = createBudgetApiFetchExecutor({
      apiUserProjectId: "demo-project",
      tokenProvider: async () => "ya29.test-token",
      fetchImpl,
    });
    const request = buildCreateBudgetRequest({
      apiUserProjectId: "demo-project",
      parent: "billingAccounts/ABC-123",
      budget: planBudgetApiMutation(createPlan()).budget!,
    });

    const result = executor(request);

    await expect(result).rejects.toBeInstanceOf(BudgetApiTransportError);
    await expect(result).rejects.toMatchObject({
      failure: {
        code: "BUDGET_API_PERMISSION_DENIED",
        retryable: false,
        reason: "PERMISSION_DENIED: caller lacks billing.budgets.create",
      },
    });
  });
});

function createPlan() {
  return planBudgetEnsure(baseAudit(), {
    projectId: "demo-project",
    amount: 50000,
    currencyCode: "KRW",
    thresholdPercents: [0.5, 0.9, 1],
  });
}

function updatePlan() {
  return planBudgetEnsure({
    ...baseAudit(),
    risk: "configured",
    budgets: [
      {
        name: "billingAccounts/ABC-123/budgets/budget-1",
        displayName: "omg budget guard: demo-project",
        amount: { currencyCode: "KRW", units: "30000" },
        thresholdPercents: [0.5],
      },
    ],
  }, {
    projectId: "demo-project",
    amount: 50000,
    currencyCode: "KRW",
    thresholdPercents: [0.5, 0.9, 1],
  });
}

function noopPlan() {
  return planBudgetEnsure(configuredAudit(), {
    projectId: "demo-project",
    amount: 50000,
    currencyCode: "KRW",
    thresholdPercents: [0.5, 0.9, 1],
  });
}

function blockedPlan() {
  return planBudgetEnsure({
    ...baseAudit(),
    risk: "review",
    inaccessible: ["billing budgets"],
    budgets: [],
  }, {
    projectId: "demo-project",
    amount: 50000,
    currencyCode: "KRW",
    thresholdPercents: [0.5, 0.9, 1],
  });
}

function configuredAudit(): BillingGuardAudit {
  return {
    ...baseAudit(),
    risk: "configured",
    budgets: [
      {
        name: "billingAccounts/ABC-123/budgets/budget-2",
        displayName: "omg budget guard: demo-project",
        amount: { currencyCode: "KRW", units: "50000" },
        thresholdPercents: [0.5, 0.9, 1],
      },
    ],
    signals: ["Budget configured: omg budget guard: demo-project."],
    recommendedAction: "Budget guard is configured for this billing account.",
  };
}

function baseAudit(): BillingGuardAudit {
  return {
    projectId: "demo-project",
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: [],
    signals: ["Billing is enabled but no budgets were found."],
    risk: "missing_budget",
    recommendedAction: "Create a billing budget before running cost-bearing live operations.",
  };
}
