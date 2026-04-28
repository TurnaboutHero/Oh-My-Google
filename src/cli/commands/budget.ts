import { Command } from "commander";
import { hashArgs } from "../../approval/hash.js";
import { createApproval } from "../../approval/queue.js";
import { auditBillingGuard } from "../../connectors/billing-audit.js";
import {
  auditBudgetNotificationPosture,
  parseBudgetNotificationPolicyInput,
  planBudgetNotificationEnsure,
} from "../../connectors/budget-notifications.js";
import {
  BudgetApiTransportError,
  executeBudgetEnsureWithPostVerification,
  type BudgetApiRequestExecutor,
  type BudgetEnsureAuditProvider,
} from "../../connectors/budget-api.js";
import {
  toBudgetEnsureLiveGateError,
} from "../../connectors/budget-live-gate.js";
import {
  parseBudgetPolicyInput,
  planBudgetEnsure,
  type BudgetPolicyInput,
} from "../../connectors/budget-policy.js";
import { readActiveGcloudAccount } from "../../connectors/project-audit.js";
import { auditPubsubTopic } from "../../connectors/pubsub-topic-audit.js";
import { planCostLockIngestion } from "../../cost-lock/ingestion-plan.js";
import { createRunId, tryAppendDecision } from "../../harness/decision-log.js";
import { evaluateSafety, type SafetyDecision } from "../../safety/decision.js";
import { classifyOperation } from "../../safety/intent.js";
import { enableApis } from "../../setup/apis.js";
import { loadProfile } from "../../trust/profile.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import type { TrustProfile } from "../../types/trust.js";
import { fail, success } from "../output.js";

const BUDGET_API = "billingbudgets.googleapis.com";

export type RunBudgetOutcome =
  | { ok: true; data: Record<string, unknown>; next?: string[] }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        recoverable: boolean;
        hint?: string;
        data?: Record<string, unknown>;
        next?: string[];
      };
    };

export const budgetCommand = new Command("budget")
  .description("Audit billing and budget guardrails");

budgetCommand
  .command("audit")
  .description("Read-only billing budget guard audit")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .action(async (opts) => {
    const outcome = await runBudgetAudit({ project: opts.project as string | undefined });
    if (outcome.ok) {
      success("budget:audit", "Budget guard audit complete.", outcome.data, outcome.next);
      return;
    }

    fail(
      "budget:audit",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

budgetCommand
  .command("enable-api")
  .description("Enable the Cloud Billing Budget API with explicit confirmation")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .option("--dry-run", "Show the API enable plan without calling gcloud")
  .option("-y, --yes", "Enable the API")
  .action(async (opts) => {
    const outcome = await runBudgetEnableApi({
      project: opts.project as string | undefined,
      dryRun: !!opts.dryRun,
      yes: !!opts.yes,
    });
    if (outcome.ok) {
      success(
        "budget:enable-api",
        outcome.data.dryRun ? "Budget API enable plan ready." : "Budget API enabled.",
        outcome.data,
        outcome.next,
      );
      return;
    }

    fail(
      "budget:enable-api",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

budgetCommand
  .command("ensure")
  .description("Dry-run an expected billing budget policy for a project")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .requiredOption("--amount <number>", "Expected budget amount")
  .requiredOption("--currency <code>", "3-letter currency code, for example KRW or USD")
  .option("--thresholds <list>", "Comma-separated threshold percents as decimals", "0.5,0.9,1")
  .option("--display-name <name>", "Expected budget display name")
  .option("--dry-run", "Plan the expected budget policy without creating or updating budgets")
  .option("--approval <id>", "Approval ID for a reviewed live budget mutation")
  .option("-y, --yes", "Reserved for future live budget mutation")
  .action(async (opts) => {
    const outcome = await runBudgetEnsure({
      cwd: process.cwd(),
      project: opts.project as string | undefined,
      amount: opts.amount as string | undefined,
      currency: opts.currency as string | undefined,
      thresholds: opts.thresholds as string | undefined,
      displayName: opts.displayName as string | undefined,
      dryRun: !!opts.dryRun,
      yes: !!opts.yes,
      approval: opts.approval as string | undefined,
    });
    if (outcome.ok) {
      success("budget:ensure", "Budget policy ensure plan ready.", outcome.data, outcome.next);
      return;
    }

    fail(
      "budget:ensure",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

const notificationsCommand = budgetCommand
  .command("notifications")
  .description("Audit and plan budget Pub/Sub notification routing");

notificationsCommand
  .command("audit")
  .description("Read-only audit of visible budget Pub/Sub notification routing")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .option("--topic <topic>", "Optional Pub/Sub topic ID or projects/{projectId}/topics/{topicId} to inspect")
  .action(async (opts) => {
    const outcome = await runBudgetNotificationsAudit({
      project: opts.project as string | undefined,
      topic: opts.topic as string | undefined,
    });
    if (outcome.ok) {
      success("budget:notifications:audit", "Budget notification audit complete.", outcome.data, outcome.next);
      return;
    }

    fail(
      "budget:notifications:audit",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

notificationsCommand
  .command("ensure")
  .description("Dry-run expected budget Pub/Sub notification routing")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .requiredOption("--topic <topic>", "Pub/Sub topic ID or projects/{projectId}/topics/{topicId}")
  .option("--display-name <name>", "Target budget display name")
  .option("--dry-run", "Plan notification routing without updating budgets")
  .option("-y, --yes", "Reserved for future live notification mutation")
  .action(async (opts) => {
    const outcome = await runBudgetNotificationsEnsure({
      project: opts.project as string | undefined,
      topic: opts.topic as string | undefined,
      displayName: opts.displayName as string | undefined,
      dryRun: !!opts.dryRun,
      yes: !!opts.yes,
    });
    if (outcome.ok) {
      success("budget:notifications:ensure", "Budget notification ensure plan ready.", outcome.data, outcome.next);
      return;
    }

    fail(
      "budget:notifications:ensure",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

notificationsCommand
  .command("lock-ingestion")
  .description("Dry-run Budget Pub/Sub alert ingestion into local cost lock")
  .requiredOption("--project <id>", "Google Cloud project ID")
  .requiredOption("--topic <topic>", "Pub/Sub topic ID or projects/{projectId}/topics/{topicId}")
  .option("--display-name <name>", "Target budget display name")
  .option("--dry-run", "Plan automatic cost lock ingestion without creating subscriptions or handlers")
  .option("-y, --yes", "Reserved for future live ingestion setup")
  .action(async (opts) => {
    const outcome = await runBudgetNotificationsLockIngestion({
      project: opts.project as string | undefined,
      topic: opts.topic as string | undefined,
      displayName: opts.displayName as string | undefined,
      dryRun: !!opts.dryRun,
      yes: !!opts.yes,
    });
    if (outcome.ok) {
      success("budget:notifications:lock-ingestion", "Budget cost-lock ingestion plan ready.", outcome.data, outcome.next);
      return;
    }

    fail(
      "budget:notifications:lock-ingestion",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

budgetCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg --output json budget audit --project my-project
  omg --output json budget enable-api --project my-project --dry-run
  omg --output json budget enable-api --project my-project --yes
  omg --output json budget ensure --project my-project --amount 50000 --currency KRW --dry-run
  omg --output json budget notifications audit --project my-project --topic budget-alerts
  omg --output json budget notifications ensure --project my-project --topic budget-alerts --dry-run
  omg --output json budget notifications lock-ingestion --project my-project --topic budget-alerts --dry-run
`,
);

export async function runBudgetAudit(input: { project?: string }): Promise<RunBudgetOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const audit = await auditBillingGuard(input.project);
    return {
      ok: true,
      data: { ...audit },
      next: getBudgetAuditNext(audit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runBudgetEnableApi(input: {
  project?: string;
  dryRun?: boolean;
  yes?: boolean;
}): Promise<RunBudgetOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const projectId = input.project.trim();
    const data = {
      projectId,
      api: BUDGET_API,
      dryRun: !!input.dryRun,
    };

    if (input.dryRun) {
      return {
        ok: true,
        data,
        next: [`omg budget enable-api --project ${projectId} --yes`],
      };
    }

    if (!input.yes) {
      return {
        ok: false,
        error: {
          code: "TRUST_REQUIRES_CONFIRM",
          message: "Enabling the Cloud Billing Budget API requires explicit --yes.",
          recoverable: true,
          hint: `Run omg budget enable-api --project ${projectId} --dry-run first, then rerun with --yes.`,
          data,
          next: [`omg budget enable-api --project ${projectId} --dry-run`],
        },
      };
    }

    await enableApis(projectId, [BUDGET_API]);
    return {
      ok: true,
      data: {
        ...data,
        dryRun: false,
        enabled: true,
      },
      next: [`omg budget audit --project ${projectId}`],
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runBudgetEnsure(input: {
  cwd?: string;
  project?: string;
  amount?: string | number;
  currency?: string;
  thresholds?: string | number[];
  displayName?: string;
  dryRun?: boolean;
  yes?: boolean;
  approval?: string;
  requester?: string;
  activeAccount?: string;
  liveExecutor?: BudgetApiRequestExecutor;
  auditAfterMutation?: BudgetEnsureAuditProvider;
}): Promise<RunBudgetOutcome> {
  try {
    const cwd = input.cwd ?? process.cwd();
    const policy = parseBudgetPolicyInput(input);
    const runId = createRunId("budget_ensure");

    if (!input.dryRun && !input.yes) {
      return {
        ok: false,
        error: {
          code: "TRUST_REQUIRES_CONFIRM",
          message: "Budget ensure requires --dry-run or explicit --yes.",
          recoverable: true,
          hint: "Run with --dry-run to inspect the expected budget policy without cloud mutation.",
          data: {
            projectId: policy.projectId,
            liveMutation: false,
          },
          next: [
            `omg budget ensure --project ${policy.projectId} --amount ${policy.amount} --currency ${policy.currencyCode} --dry-run`,
          ],
        },
      };
    }

    if (!input.dryRun && !input.liveExecutor) {
      return {
        ok: false,
        error: budgetEnsureLiveNotImplementedError(policy),
      };
    }
    const audit = await auditBillingGuard(policy.projectId);
    const plan = planBudgetEnsure(audit, policy);

    if (input.dryRun) {
      return {
        ok: true,
        data: { ...plan },
        next: getBudgetEnsureNext(plan),
      };
    }

    const liveExecutor = input.liveExecutor;
    if (!liveExecutor) {
      return {
        ok: false,
        error: budgetEnsureLiveNotImplementedError(policy),
      };
    }

    if (plan.action === "create" || plan.action === "update") {
      const approval = await requireBudgetEnsureApproval({
        cwd,
        runId,
        policy,
        approval: input.approval,
        requester: input.requester,
        activeAccount: input.activeAccount,
      });
      if (!approval.ok) {
        return { ok: false, error: approval.error };
      }
    }

    let execution;
    try {
      execution = await executeBudgetEnsureWithPostVerification({
        plan,
        apiUserProjectId: policy.projectId,
        executor: liveExecutor,
        auditAfterMutation: input.auditAfterMutation,
      });
    } catch (error) {
      if (error instanceof BudgetApiTransportError) {
        const transportError = toBudgetApiTransportOutcomeError(error);
        await tryAppendDecision(cwd, {
          runId,
          command: "budget:ensure",
          phase: "api-mutation",
          status: "failure",
          action: "budget.ensure",
          projectId: policy.projectId,
          inputs: getBudgetEnsureApprovalArgs(policy),
          result: {
            code: transportError.code,
            retryable: transportError.data?.retryable,
            statusCode: transportError.data?.statusCode,
          },
          next: transportError.next,
        });
        return { ok: false, error: transportError };
      }
      throw error;
    }

    if (!execution.ok) {
      const liveError = toBudgetEnsureLiveGateError({
        failure: execution,
        command: {
          projectId: policy.projectId,
          amount: policy.amount,
          currencyCode: policy.currencyCode,
          thresholds: policy.thresholdPercents,
          displayName: policy.displayName,
        },
      });
      await tryAppendDecision(cwd, {
        runId,
        command: "budget:ensure",
        phase: execution.errorCode === "BUDGET_ENSURE_MUTATION_BLOCKED" ? "live-gate" : "post-verify",
        status: execution.errorCode === "BUDGET_ENSURE_MUTATION_BLOCKED" ? "blocked" : "failure",
        action: "budget.ensure",
        projectId: policy.projectId,
        inputs: getBudgetEnsureApprovalArgs(policy),
        result: {
          code: liveError.code,
          mutationAction: execution.mutation.action,
          liveMutationAttempted: liveError.data.liveMutationAttempted,
          blockers: liveError.data.blockers,
        },
        next: liveError.next,
      });
      return {
        ok: false,
        error: liveError,
      };
    }

    await tryAppendDecision(cwd, {
      runId,
      command: "budget:ensure",
      phase: "post-verify",
      status: "success",
      action: "budget.ensure",
      projectId: policy.projectId,
      inputs: getBudgetEnsureApprovalArgs(policy),
      result: {
        mutationAction: execution.mutation.action,
        liveMutation: execution.mutationResult.executed,
        verified: execution.postVerification.verified,
      },
      next: getBudgetEnsureLiveNext(policy.projectId, execution.mutation.action),
    });

    return {
      ok: true,
      data: {
        projectId: policy.projectId,
        dryRun: false,
        liveMutation: execution.mutationResult.executed,
        mutation: execution.mutation,
        mutationResult: execution.mutationResult,
        postVerification: execution.postVerification,
      },
      next: getBudgetEnsureLiveNext(policy.projectId, execution.mutation.action),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runBudgetNotificationsAudit(input: {
  project?: string;
  topic?: string;
}): Promise<RunBudgetOutcome> {
  try {
    if (!input.project?.trim()) {
      throw new ValidationError("Project ID is required.");
    }

    const projectId = input.project.trim();
    const topic = input.topic?.trim()
      ? parseBudgetNotificationPolicyInput({ project: projectId, topic: input.topic }).pubsubTopic
      : undefined;
    const [audit, topicAudit] = await Promise.all([
      auditBillingGuard(projectId),
      topic ? auditPubsubTopic(topic) : Promise.resolve(undefined),
    ]);
    const notificationAudit = auditBudgetNotificationPosture(audit, topicAudit);
    return {
      ok: true,
      data: { ...notificationAudit },
      next: getBudgetNotificationsAuditNext(notificationAudit),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runBudgetNotificationsEnsure(input: {
  project?: string;
  topic?: string;
  displayName?: string;
  dryRun?: boolean;
  yes?: boolean;
}): Promise<RunBudgetOutcome> {
  try {
    const policy = parseBudgetNotificationPolicyInput(input);

    if (!input.dryRun) {
      return {
        ok: false,
        error: input.yes
          ? {
              code: "BUDGET_NOTIFICATIONS_LIVE_NOT_IMPLEMENTED",
              message: "Live budget notification updates are not implemented in this safe foundation pass.",
              recoverable: true,
              hint: "Run the dry-run first and implement the Budget API notification executor before enabling live mutation.",
              data: {
                projectId: policy.projectId,
                pubsubTopic: policy.pubsubTopic,
                liveMutation: false,
              },
              next: [`omg budget notifications ensure --project ${policy.projectId} --topic ${policy.pubsubTopic} --dry-run`],
            }
          : {
              code: "TRUST_REQUIRES_CONFIRM",
              message: "Budget notification ensure requires --dry-run in the current safe implementation.",
              recoverable: true,
              hint: "Run with --dry-run to inspect the expected notification routing without cloud mutation.",
              data: {
                projectId: policy.projectId,
                pubsubTopic: policy.pubsubTopic,
                liveMutation: false,
              },
              next: [`omg budget notifications ensure --project ${policy.projectId} --topic ${policy.pubsubTopic} --dry-run`],
            },
      };
    }

    const [audit, topicAudit] = await Promise.all([
      auditBillingGuard(policy.projectId),
      auditPubsubTopic(policy.pubsubTopic),
    ]);
    const plan = planBudgetNotificationEnsure(audit, policy, topicAudit);
    return {
      ok: true,
      data: { ...plan },
      next: getBudgetNotificationsEnsureNext(plan),
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runBudgetNotificationsLockIngestion(input: {
  project?: string;
  topic?: string;
  displayName?: string;
  dryRun?: boolean;
  yes?: boolean;
}): Promise<RunBudgetOutcome> {
  try {
    const policy = parseBudgetNotificationPolicyInput(input);

    if (!input.dryRun) {
      return {
        ok: false,
        error: input.yes
          ? {
              code: "BUDGET_LOCK_INGESTION_LIVE_NOT_IMPLEMENTED",
              message: "Live budget alert to cost lock ingestion setup is not implemented in this safe foundation pass.",
              recoverable: true,
              hint: "Run the dry-run first and implement a reviewed subscriber handler before enabling live ingestion.",
              data: {
                projectId: policy.projectId,
                pubsubTopic: policy.pubsubTopic,
                liveMutation: false,
              },
              next: [`omg budget notifications lock-ingestion --project ${policy.projectId} --topic ${policy.pubsubTopic} --dry-run`],
            }
          : {
              code: "TRUST_REQUIRES_CONFIRM",
              message: "Budget cost-lock ingestion requires --dry-run in the current safe implementation.",
              recoverable: true,
              hint: "Run with --dry-run to inspect the subscription and handler plan without cloud mutation.",
              data: {
                projectId: policy.projectId,
                pubsubTopic: policy.pubsubTopic,
                liveMutation: false,
              },
              next: [`omg budget notifications lock-ingestion --project ${policy.projectId} --topic ${policy.pubsubTopic} --dry-run`],
            },
      };
    }

    const [audit, topicAudit] = await Promise.all([
      auditBillingGuard(policy.projectId),
      auditPubsubTopic(policy.pubsubTopic),
    ]);
    const plan = planCostLockIngestion(audit, policy, topicAudit);
    return {
      ok: true,
      data: { ...plan },
      next: plan.next,
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

function getBudgetAuditNext(audit: {
  risk?: unknown;
  billingAccountId?: unknown;
}): string[] {
  if (audit.risk === "missing_budget" && typeof audit.billingAccountId === "string") {
    return [`Create a billing budget for billing account ${audit.billingAccountId}.`];
  }
  if (audit.risk === "review") {
    return ["Review billing budget permissions before live cost-bearing operations."];
  }
  if (audit.risk === "billing_disabled") {
    return ["Keep cost-bearing live operations blocked until billing is intentionally enabled."];
  }
  return [];
}

function getBudgetEnsureNext(plan: {
  action?: unknown;
  blockers?: string[];
  projectId?: string;
}): string[] {
  if (plan.action === "blocked") {
    return ["Resolve budget audit blockers before creating or updating budget policy."];
  }
  if (plan.action === "none") {
    return [];
  }
  if (typeof plan.projectId === "string") {
    return [
      "Review this dry-run plan before enabling live budget mutation.",
      `omg budget audit --project ${plan.projectId}`,
    ];
  }
  return ["Review this dry-run plan before enabling live budget mutation."];
}

function getBudgetEnsureLiveNext(projectId: string, action: unknown): string[] {
  const next = [`omg budget audit --project ${projectId}`];
  if (action !== "none") {
    next.push(`omg budget ensure --project ${projectId} --amount <amount> --currency <code> --dry-run`);
  }
  return next;
}

async function requireBudgetEnsureApproval(input: {
  cwd: string;
  runId: string;
  policy: BudgetPolicyInput;
  approval?: string;
  requester?: string;
  activeAccount?: string;
}): Promise<
  | { ok: true; activeAccount: string }
  | { ok: false; error: Extract<RunBudgetOutcome, { ok: false }>["error"] }
> {
  const profile = await getBudgetEnsureApprovalProfile(input.cwd, input.policy.projectId);
  const activeAccount = input.activeAccount ?? await readActiveGcloudAccount();
  const args = getBudgetEnsureApprovalArgs(input.policy);
  const safety = await evaluateSafety(
    classifyOperation("budget.ensure", { projectId: input.policy.projectId }),
    profile,
    {
      approvalId: input.approval,
      argsHash: hashArgs(args),
      activeAccount,
      cwd: input.cwd,
      jsonMode: true,
      yes: true,
    },
  );

  if (safety.allowed) {
    return { ok: true, activeAccount };
  }

  if (safety.code === "APPROVAL_REQUIRED") {
    const approval = await createApproval(input.cwd, {
      action: "budget.ensure",
      args,
      projectId: input.policy.projectId,
      environment: profile.environment,
      requestedBy: input.requester ?? getRequester(),
      requestedAccount: activeAccount,
    });
    const next = [
      `omg approve ${approval.id}`,
      `${buildBudgetEnsureLiveCommand(input.policy)} --approval ${approval.id}`,
    ];
    await tryAppendDecision(input.cwd, {
      runId: input.runId,
      command: "budget:ensure",
      phase: "approval",
      status: "pending_approval",
      action: "budget.ensure",
      projectId: input.policy.projectId,
      environment: profile.environment,
      trustAction: "require_approval",
      approvalId: approval.id,
      inputs: args,
      next,
    });
    return {
      ok: false,
      error: {
        code: "APPROVAL_REQUIRED",
        message: `Budget ensure live mutation requires manual approval. Approval ${approval.id} created.`,
        recoverable: true,
        data: {
          approvalId: approval.id,
          action: "budget.ensure",
          activeAccount,
          expiresAt: approval.expiresAt,
        },
        next,
      },
    };
  }

  const { code, hint } = mapBudgetEnsureSafetyFailure(safety);
  await tryAppendDecision(input.cwd, {
    runId: input.runId,
    command: "budget:ensure",
    phase: "approval",
    status: "blocked",
    action: "budget.ensure",
    projectId: input.policy.projectId,
    environment: profile.environment,
    trustAction: safety.permission?.action,
    reasonCode: safety.permission?.reasonCode,
    approvalId: input.approval,
    inputs: args,
    result: {
      code,
      reason: safety.reason,
    },
    next: safety.next,
  });
  return {
    ok: false,
    error: {
      code,
      message: safety.reason ?? "Budget ensure live mutation blocked by approval policy.",
      recoverable: true,
      hint,
      next: safety.next,
    },
  };
}

async function getBudgetEnsureApprovalProfile(cwd: string, projectId: string): Promise<TrustProfile> {
  const profile = await loadProfile(cwd);
  const now = new Date().toISOString();
  const base: TrustProfile = profile ?? {
    version: 1,
    projectId,
    environment: "prod",
    allowedServices: [],
    allowedRegions: [],
    deny: [],
    rules: {
      L0: "auto",
      L1: "require_approval",
      L2: "require_approval",
      L3: "deny",
    },
    createdAt: now,
    updatedAt: now,
  };

  return {
    ...base,
    projectId,
    rules: {
      ...base.rules,
      L2: "require_approval",
    },
  };
}

function getBudgetEnsureApprovalArgs(policy: BudgetPolicyInput): Record<string, unknown> {
  return {
    projectId: policy.projectId,
    amount: policy.amount,
    currencyCode: policy.currencyCode,
    thresholdPercents: policy.thresholdPercents,
    displayName: policy.displayName ?? null,
  };
}

function buildBudgetEnsureLiveCommand(policy: BudgetPolicyInput): string {
  const parts = [
    "omg budget ensure",
    "--project",
    policy.projectId,
    "--amount",
    String(policy.amount),
    "--currency",
    policy.currencyCode,
    "--thresholds",
    policy.thresholdPercents.join(","),
    "--yes",
  ];
  if (policy.displayName) {
    parts.push("--display-name", quoteShellArg(policy.displayName));
  }
  return parts.join(" ");
}

function quoteShellArg(value: string): string {
  return /[\s"]/u.test(value) ? `"${value.replace(/(["\\])/g, "\\$1")}"` : value;
}

function budgetEnsureLiveNotImplementedError(policy: {
  projectId: string;
  amount: number;
  currencyCode: string;
}): Extract<RunBudgetOutcome, { ok: false }>["error"] {
  return {
    code: "BUDGET_ENSURE_LIVE_NOT_IMPLEMENTED",
    message: "Live budget creation or update is not wired into the CLI runtime.",
    recoverable: true,
    hint: "The live Budget API executor must be injected and reviewed before enabling real cloud mutation.",
    data: {
      projectId: policy.projectId,
      liveMutation: false,
      mockable: true,
    },
    next: [
      `omg budget ensure --project ${policy.projectId} --amount ${policy.amount} --currency ${policy.currencyCode} --dry-run`,
    ],
  };
}

function mapBudgetEnsureSafetyFailure(safety: SafetyDecision): {
  code: string;
  hint?: string;
} {
  switch (safety.code) {
    case "APPROVAL_NOT_FOUND":
    case "APPROVAL_EXPIRED":
    case "APPROVAL_MISMATCH":
    case "ACCOUNT_MISMATCH":
    case "APPROVAL_CONSUMED":
    case "TRUST_DENIED":
      return { code: safety.code };
    case "APPROVAL_NOT_APPROVED":
      return {
        code: "APPROVAL_NOT_APPROVED",
        hint: safety.permission?.approvalId ? `omg approve ${safety.permission.approvalId}` : undefined,
      };
    default:
      return { code: safety.code };
  }
}

function getBudgetNotificationsAuditNext(audit: {
  posture?: unknown;
  projectId?: string;
}): string[] {
  if (audit.posture === "blocked") {
    return ["Resolve budget audit blockers before planning Pub/Sub notification routing."];
  }
  if (audit.posture === "configured") {
    return [];
  }
  if (typeof audit.projectId === "string") {
    return [`omg budget notifications ensure --project ${audit.projectId} --topic <topic> --dry-run`];
  }
  return ["Plan Pub/Sub notification routing with budget notifications ensure --dry-run."];
}

function getBudgetNotificationsEnsureNext(plan: {
  action?: unknown;
  blockers?: string[];
  projectId?: string;
}): string[] {
  if (plan.action === "blocked") {
    return ["Resolve notification plan blockers before updating budget notification routing."];
  }
  if (plan.action === "none") {
    return [];
  }
  if (typeof plan.projectId === "string") {
    return [
      "Review this dry-run plan before enabling live budget notification mutation.",
      `omg budget notifications audit --project ${plan.projectId}`,
    ];
  }
  return ["Review this dry-run plan before enabling live budget notification mutation."];
}

function toOutcomeError(error: unknown): Extract<RunBudgetOutcome, { ok: false }>["error"] {
  const omgError = toOmgError(error);
  return {
    code: omgError.code,
    message: omgError.message,
    recoverable: omgError.recoverable,
  };
}

function toBudgetApiTransportOutcomeError(
  error: BudgetApiTransportError,
): Extract<RunBudgetOutcome, { ok: false }>["error"] {
  const failure = error.failure;
  return {
    code: failure.code,
    message: failure.message,
    recoverable: failure.recoverable,
    hint: failure.reason,
    data: {
      liveMutation: false,
      retryable: failure.retryable,
      statusCode: failure.statusCode,
      retryAfterMs: failure.retryAfterMs,
    },
    next: failure.next,
  };
}

function toOmgError(error: unknown): OmgErrorType {
  if (error instanceof OmgError) {
    return error;
  }

  if (error instanceof Error) {
    return new ValidationError(error.message);
  }

  return new ValidationError("Unknown budget command error.");
}

function getRequester(): string {
  return process.env.USER || process.env.USERNAME || "agent";
}
