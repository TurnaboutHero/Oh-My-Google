import type { BudgetEnsureExecutionResult } from "./budget-api.js";

export interface BudgetEnsureLiveCommandInput {
  projectId: string;
  amount: string | number;
  currencyCode: string;
  thresholds?: string | number[];
  displayName?: string;
}

export interface BudgetEnsureLiveGateContract {
  command: "budget:ensure";
  operationIntent: "budget.ensure";
  trustLevel: "L2";
  liveCliStatus: "blocked";
  currentLiveErrorCode: "BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED";
  transport: {
    baseUrl: "https://billingbudgets.googleapis.com/v1";
    tokenCommand: ["gcloud", "auth", "print-access-token"];
    requiredHeaders: ["authorization", "content-type", "x-goog-user-project"];
    tokenLogging: "forbidden";
    quotaProjectHeader: "x-goog-user-project";
    retryableFailureCodes: ["BUDGET_API_RATE_LIMITED", "BUDGET_API_UNAVAILABLE"];
    nonRetryableFailureCodes: [
      "NO_AUTH",
      "ACCOUNT_MISMATCH",
      "BUDGET_API_TOKEN_COMMAND_FAILED",
      "BUDGET_API_INVALID_REQUEST",
      "BUDGET_API_UNAUTHENTICATED",
      "BUDGET_API_PERMISSION_DENIED",
      "BUDGET_API_NOT_FOUND",
      "BUDGET_API_CONFLICT",
      "BUDGET_API_REQUEST_FAILED",
    ];
  };
  approval: {
    required: true;
    argsHashFields: ["projectId", "amount", "currencyCode", "thresholds", "displayName"];
    consumeBeforeMutation: true;
    reuseAllowed: false;
  };
  decisionLog: {
    required: true;
    phases: ["live-gate", "api-mutation", "post-verify"];
    redactKeys: ["authorization", "token", "credential"];
  };
  postVerification: {
    auditCommand: string;
    successCondition: "verifyBudgetEnsurePostState(...).verified === true";
    failureCode: "BUDGET_ENSURE_POST_VERIFY_FAILED";
    failureHandling: "return structured failure without claiming the budget policy is configured";
  };
  dryRunCommand: string;
}

export type BudgetEnsureLiveGateFailure = Extract<BudgetEnsureExecutionResult, { ok: false }>;

export interface BudgetEnsureLiveGateError {
  code: "BUDGET_ENSURE_MUTATION_BLOCKED" | "BUDGET_ENSURE_POST_VERIFY_FAILED";
  message: string;
  recoverable: true;
  hint: string;
  data: {
    projectId: string;
    liveMutationAttempted: boolean;
    mutationAction: BudgetEnsureLiveGateFailure["mutation"]["action"];
    blockers: string[];
    postVerification?: BudgetEnsureLiveGateFailure["postVerification"];
  };
  next: string[];
}

export function describeBudgetEnsureLiveGate(
  input: BudgetEnsureLiveCommandInput,
): BudgetEnsureLiveGateContract {
  return {
    command: "budget:ensure",
    operationIntent: "budget.ensure",
    trustLevel: "L2",
    liveCliStatus: "blocked",
    currentLiveErrorCode: "BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED",
    transport: {
      baseUrl: "https://billingbudgets.googleapis.com/v1",
      tokenCommand: ["gcloud", "auth", "print-access-token"],
      requiredHeaders: ["authorization", "content-type", "x-goog-user-project"],
      tokenLogging: "forbidden",
      quotaProjectHeader: "x-goog-user-project",
      retryableFailureCodes: ["BUDGET_API_RATE_LIMITED", "BUDGET_API_UNAVAILABLE"],
      nonRetryableFailureCodes: [
        "NO_AUTH",
        "ACCOUNT_MISMATCH",
        "BUDGET_API_TOKEN_COMMAND_FAILED",
        "BUDGET_API_INVALID_REQUEST",
        "BUDGET_API_UNAUTHENTICATED",
        "BUDGET_API_PERMISSION_DENIED",
        "BUDGET_API_NOT_FOUND",
        "BUDGET_API_CONFLICT",
        "BUDGET_API_REQUEST_FAILED",
      ],
    },
    approval: {
      required: true,
      argsHashFields: ["projectId", "amount", "currencyCode", "thresholds", "displayName"],
      consumeBeforeMutation: true,
      reuseAllowed: false,
    },
    decisionLog: {
      required: true,
      phases: ["live-gate", "api-mutation", "post-verify"],
      redactKeys: ["authorization", "token", "credential"],
    },
    postVerification: {
      auditCommand: `omg budget audit --project ${input.projectId}`,
      successCondition: "verifyBudgetEnsurePostState(...).verified === true",
      failureCode: "BUDGET_ENSURE_POST_VERIFY_FAILED",
      failureHandling: "return structured failure without claiming the budget policy is configured",
    },
    dryRunCommand: buildBudgetEnsureDryRunCommand(input),
  };
}

export function toBudgetEnsureLiveGateError(input: {
  failure: BudgetEnsureLiveGateFailure;
  command: BudgetEnsureLiveCommandInput;
}): BudgetEnsureLiveGateError {
  const dryRunCommand = buildBudgetEnsureDryRunCommand(input.command);
  const auditCommand = `omg budget audit --project ${input.command.projectId}`;
  const baseData = {
    projectId: input.command.projectId,
    liveMutationAttempted: input.failure.mutationResult.executed,
    mutationAction: input.failure.mutation.action,
    blockers: input.failure.blockers,
  };

  if (input.failure.errorCode === "BUDGET_ENSURE_POST_VERIFY_FAILED") {
    return {
      code: "BUDGET_ENSURE_POST_VERIFY_FAILED",
      message: "Budget API mutation completed, but post-verification did not confirm the expected budget policy.",
      recoverable: true,
      hint: "Run budget audit and inspect the visible budget policy before retrying or claiming success.",
      data: {
        ...baseData,
        postVerification: input.failure.postVerification,
      },
      next: [auditCommand, dryRunCommand],
    };
  }

  return {
    code: "BUDGET_ENSURE_MUTATION_BLOCKED",
    message: "Budget API mutation plan is blocked and was not executed.",
    recoverable: true,
    hint: "Resolve the blockers and rerun budget ensure as a dry-run before any live attempt.",
    data: baseData,
    next: [dryRunCommand],
  };
}

export function buildBudgetEnsureDryRunCommand(input: BudgetEnsureLiveCommandInput): string {
  const parts = [
    "omg budget ensure",
    "--project",
    quoteArg(input.projectId),
    "--amount",
    quoteArg(String(input.amount)),
    "--currency",
    quoteArg(input.currencyCode),
  ];

  if (input.thresholds !== undefined) {
    parts.push("--thresholds", quoteArg(formatThresholds(input.thresholds)));
  }

  if (input.displayName !== undefined && input.displayName.trim().length > 0) {
    parts.push("--display-name", quoteArg(input.displayName.trim()));
  }

  parts.push("--dry-run");
  return parts.join(" ");
}

function formatThresholds(thresholds: string | number[]): string {
  if (typeof thresholds === "string") {
    return thresholds.trim();
  }
  return thresholds.join(",");
}

function quoteArg(value: string): string {
  if (!/[\s"]/u.test(value)) {
    return value;
  }
  return `"${value.replace(/(["\\])/g, "\\$1")}"`;
}
