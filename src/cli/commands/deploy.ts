import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { hashArgs } from "../../approval/hash.js";
import { createApproval } from "../../approval/queue.js";
import { auditBillingGuard } from "../../connectors/billing-audit.js";
import { getCostLock } from "../../cost-lock/state.js";
import { applyPlan, type ApplyResult } from "../../executor/apply.js";
import { createRunId, tryAppendDecision } from "../../harness/decision-log.js";
import { tryWriteHandoff } from "../../harness/handoff.js";
import { loadPlan } from "../../planner/schema.js";
import { evaluateSafety, type SafetyDecision } from "../../safety/decision.js";
import { classifyOperation } from "../../safety/intent.js";
import { loadProfile } from "../../trust/profile.js";
import { OmgError, ValidationError } from "../../types/errors.js";
import type { Plan } from "../../types/plan.js";
import { fail, getOutputFormat, success } from "../output.js";

export interface RunDeployInput {
  cwd: string;
  dryRun?: boolean;
  approval?: string;
  yes?: boolean;
  jsonMode?: boolean;
  requester?: string;
}

export interface DeploySuccessPayload {
  plan?: Plan;
  urls?: ApplyResult["urls"];
  steps?: ApplyResult["steps"];
}

export interface DeployErrorPayload {
  code: string;
  message: string;
  recoverable: boolean;
  hint?: string;
  data?: Record<string, unknown>;
  next?: string[];
}

export type RunDeployOutcome =
  | { ok: true; data: DeploySuccessPayload; next?: string[] }
  | { ok: false; error: DeployErrorPayload };

export const deployCommand = new Command("deploy")
  .description("Deploy according to .omg/project.yaml")
  .option("--dry-run", "Show deployment plan without executing")
  .option("--approval <id>", "Manual approval request ID")
  .option("-y, --yes", "Approve trust-gated deployment actions")
  .action(async (opts) => {
    const outcome = await runDeploy({
      cwd: process.cwd(),
      dryRun: !!opts.dryRun,
      approval: opts.approval,
      yes: !!opts.yes,
      jsonMode: getOutputFormat() === "json",
    });

    if (outcome.ok) {
      success(
        "deploy",
        outcome.data.plan ? "Deployment plan ready." : "Deployment completed.",
        outcome.data as Record<string, unknown>,
        outcome.next,
      );
      return;
    }

    fail(
      "deploy",
      outcome.error.code,
      outcome.error.message,
      outcome.error.recoverable,
      outcome.error.hint,
      outcome.error.data,
      outcome.error.next,
    );
    process.exit(1);
  });

export async function runDeploy(input: RunDeployInput): Promise<RunDeployOutcome> {
  const runId = createRunId("deploy");
  let projectId: string | undefined;
  let environment: string | undefined;
  let action: string | undefined;

  try {
    const plan = await loadPlan(input.cwd);
    if (!plan) {
      throw new OmgError("No project plan found. Run 'omg link' first.", "NO_PLAN", false);
    }

    const profile = await loadProfile(input.cwd);
    if (!profile) {
      throw new OmgError("No trust profile found. Run 'omg init' first.", "NO_TRUST_PROFILE", false);
    }
    projectId = profile.projectId;
    environment = profile.environment;

    if (input.dryRun) {
      await tryAppendDecision(input.cwd, {
        runId,
        command: "deploy",
        phase: "dry-run",
        status: "success",
        projectId,
        environment,
        result: { stack: plan.detected.stack, deploymentOrder: plan.deploymentOrder },
        next: ["omg deploy --yes"],
      });
      return { ok: true, data: { plan }, next: ["omg deploy --yes"] };
    }

    action = plan.targets.backend ? "deploy.cloud-run" : "deploy.firebase-hosting";
    const deployArgs = extractDeployArgs(plan, action);
    const argsHash = hashArgs(deployArgs);
    const safety = await evaluateSafety(
      classifyOperation(action, {
        projectId: profile.projectId,
        resource: getDeployResource(plan, action),
      }),
      profile,
      {
        approvalId: input.approval,
        argsHash,
        yes: !!input.yes,
        jsonMode: !!input.jsonMode,
        cwd: input.cwd,
        budgetAuditProvider: auditBillingGuard,
        costLockProvider: (targetProjectId) => getCostLock(input.cwd, targetProjectId),
      },
    );

    if (!safety.allowed) {
      if (safety.code === "APPROVAL_REQUIRED") {
        const approval = await createApproval(input.cwd, {
          action,
          args: deployArgs,
          projectId: profile.projectId,
          environment: profile.environment,
          requestedBy: input.requester ?? getRequester(),
        });
        await tryAppendDecision(input.cwd, {
          runId,
          command: "deploy",
          phase: "trust",
          status: "pending_approval",
          action,
          projectId,
          environment,
          trustAction: safety.permission?.action,
          reasonCode: safety.permission?.reasonCode,
          approvalId: approval.id,
          inputs: { args: deployArgs },
          result: { expiresAt: approval.expiresAt },
          next: [`omg approve ${approval.id}`, `omg deploy --approval ${approval.id}`],
        });
        await tryWriteHandoff(input.cwd, {
          runId,
          command: "deploy",
          status: "pending_approval",
          projectId,
          environment,
          pending: [`approval ${approval.id} for ${action}`],
          risks: ["deployment is blocked until the approval is explicitly approved"],
          next: [`omg approve ${approval.id}`, `omg deploy --approval ${approval.id}`],
        });

        return {
          ok: false,
          error: {
            code: "APPROVAL_REQUIRED",
            message: `Deploy requires manual approval. Approval ${approval.id} created.`,
            recoverable: true,
            data: { approvalId: approval.id, action, expiresAt: approval.expiresAt },
            next: [`omg approve ${approval.id}`, `omg deploy --approval ${approval.id}`],
          },
        };
      }

      if (safety.code === "BUDGET_GUARD_BLOCKED" && safety.budgetAudit) {
        const budgetGuard = safety.budgetAudit;
        const next = safety.next ?? [`omg budget audit --project ${profile.projectId}`];
        await tryAppendDecision(input.cwd, {
          runId,
          command: "deploy",
          phase: "budget",
          status: "blocked",
          action,
          projectId,
          environment,
          result: {
            code: "BUDGET_GUARD_BLOCKED",
            budgetRisk: budgetGuard.risk,
            billingEnabled: budgetGuard.billingEnabled,
            billingAccountId: budgetGuard.billingAccountId,
            signals: budgetGuard.signals,
          },
          next,
        });
        await tryWriteHandoff(input.cwd, {
          runId,
          command: "deploy",
          status: "blocked",
          projectId,
          environment,
          risks: [`Budget guard blocked live deployment: ${budgetGuard.recommendedAction}`],
          next,
        });

        return {
          ok: false,
          error: {
            code: "BUDGET_GUARD_BLOCKED",
            message: `Budget guard blocked live deployment: ${budgetGuard.recommendedAction}`,
            recoverable: true,
            data: {
              projectId: profile.projectId,
              budgetRisk: budgetGuard.risk,
              billingEnabled: budgetGuard.billingEnabled,
              billingAccountId: budgetGuard.billingAccountId,
              signals: budgetGuard.signals,
            },
            next,
          },
        };
      }

      if (safety.code === "COST_LOCKED" && safety.costLock) {
        const next = safety.next ?? [`omg cost status --project ${profile.projectId}`];
        await tryAppendDecision(input.cwd, {
          runId,
          command: "deploy",
          phase: "cost-lock",
          status: "blocked",
          action,
          projectId,
          environment,
          result: {
            code: "COST_LOCKED",
            reason: safety.costLock.reason,
            lockedAt: safety.costLock.lockedAt,
          },
          next,
        });
        await tryWriteHandoff(input.cwd, {
          runId,
          command: "deploy",
          status: "blocked",
          projectId,
          environment,
          risks: [`Cost lock blocked live deployment: ${safety.costLock.reason}`],
          next,
        });

        return {
          ok: false,
          error: {
            code: "COST_LOCKED",
            message: `Cost lock blocked live deployment: ${safety.costLock.reason}`,
            recoverable: true,
            data: {
              projectId: safety.costLock.projectId,
              reason: safety.costLock.reason,
              lockedAt: safety.costLock.lockedAt,
            },
            next,
          },
        };
      }

      const { code, hint } = mapSafetyFailure(safety);
      await tryAppendDecision(input.cwd, {
        runId,
        command: "deploy",
        phase: "trust",
        status: "blocked",
        action,
        projectId,
        environment,
        trustAction: safety.permission?.action,
        reasonCode: safety.permission?.reasonCode,
        result: {
          code,
          message: safety.reason,
          deniedBy: safety.permission?.deniedBy,
        },
        next: hint ? [hint] : undefined,
      });
      await tryWriteHandoff(input.cwd, {
        runId,
        command: "deploy",
        status: "blocked",
        projectId,
        environment,
        risks: [safety.reason ?? "deployment blocked by trust profile"],
        next: hint ? [hint] : ["adjust .omg/trust.yaml or rerun a safe command"],
      });
      return {
        ok: false,
        error: {
          code,
          message: safety.reason ?? "Deployment blocked by trust profile.",
          recoverable: false,
          hint,
        },
      };
    }

    const result = await applyPlan(plan, {
      cwd: input.cwd,
      profile,
      dryRun: false,
      yes: !!input.yes,
    });
    await tryAppendDecision(input.cwd, {
      runId,
      command: "deploy",
      phase: "execute",
      status: "success",
      action,
      projectId,
      environment,
      result,
      artifacts: { handoff: ".omg/handoff.md" },
      next: ["omg doctor"],
    });
    await tryWriteHandoff(input.cwd, {
      runId,
      command: "deploy",
      status: "success",
      projectId,
      environment,
      urls: result.urls,
      rollback: result.steps
        .filter((step) => step.name.startsWith("rollback:"))
        .map((step) => `${step.name}: ${step.state}`),
      next: ["omg doctor"],
    });

    return {
      ok: true,
      data: {
        urls: result.urls,
        steps: result.steps,
      },
    };
  } catch (error) {
    const omgError =
      error instanceof OmgError
        ? error
        : new ValidationError(error instanceof Error ? error.message : "Unknown deploy error.");
    await tryAppendDecision(input.cwd, {
      runId,
      command: "deploy",
      phase: "execute",
      status: "failure",
      action,
      projectId,
      environment,
      result: {
        code: omgError.code,
        message: omgError.message,
        recoverable: omgError.recoverable,
      },
      next: omgError.code === "NO_PLAN" ? ["omg link"] : undefined,
    });
    await tryWriteHandoff(input.cwd, {
      runId,
      command: "deploy",
      status: "failure",
      projectId,
      environment,
      risks: [omgError.message],
      next: omgError.code === "NO_PLAN" ? ["omg link"] : ["inspect the decision log and retry"],
    });

    return {
      ok: false,
      error: {
        code: omgError.code,
        message: omgError.message,
        recoverable: omgError.recoverable,
        hint: omgError.code === "NO_PLAN" ? "omg link" : undefined,
      },
    };
  }
}

deployCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg deploy --dry-run
  omg deploy --yes
  omg --output json deploy --dry-run
`,
);

function extractDeployArgs(plan: Plan, action: string): Record<string, unknown> {
  if (action === "deploy.cloud-run") {
    const backend = plan.targets.backend;
    if (!backend) {
      return {};
    }

    return {
      service: backend.serviceName,
      region: backend.region,
      image: plan.detected.backend?.dockerfile,
      port: plan.detected.backend?.port,
      runtime: plan.detected.backend?.type,
      envKeys: Object.keys(plan.environment?.backend ?? {}).sort(),
    };
  }

  const frontend = plan.targets.frontend;
  if (!frontend) {
    return {};
  }

  return {
    site: frontend.siteName,
    buildCommand: plan.detected.frontend?.buildCommand,
    outputDir: plan.detected.frontend?.outputDir,
    type: plan.detected.frontend?.type,
  };
}

function getDeployResource(plan: Plan, action: string): string | undefined {
  if (action === "deploy.cloud-run") {
    return plan.targets.backend?.serviceName
      ? `service/${plan.targets.backend.serviceName}`
      : undefined;
  }

  return plan.targets.frontend?.siteName
    ? `site/${plan.targets.frontend.siteName}`
    : undefined;
}

function getRequester(): string {
  try {
    const email = execFileSync("git", ["config", "user.email"], {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    if (email) {
      return email;
    }
  } catch {
  }

  return process.env.USER || process.env.USERNAME || "agent";
}

function mapSafetyFailure(safety: SafetyDecision): {
  code: string;
  hint?: string;
} {
  switch (safety.code) {
    case "TRUST_DENIED":
      return { code: "TRUST_DENIED" };
    case "TRUST_REQUIRES_CONFIRM":
      return { code: "TRUST_REQUIRES_CONFIRM", hint: "--yes" };
    case "APPROVAL_NOT_FOUND":
      return { code: "APPROVAL_NOT_FOUND" };
    case "APPROVAL_EXPIRED":
      return { code: "APPROVAL_EXPIRED" };
    case "APPROVAL_NOT_APPROVED":
      return {
        code: "APPROVAL_NOT_APPROVED",
        hint: safety.permission?.approvalId ? `omg approve ${safety.permission.approvalId}` : undefined,
      };
    case "APPROVAL_MISMATCH":
      return { code: "APPROVAL_MISMATCH" };
    case "APPROVAL_CONSUMED":
      return { code: "APPROVAL_CONSUMED" };
    default:
      return { code: safety.code };
  }
}
