import { execFileSync } from "node:child_process";
import { Command } from "commander";
import { hashArgs } from "../../approval/hash.js";
import { createApproval } from "../../approval/queue.js";
import { applyPlan } from "../../executor/apply.js";
import { loadPlan } from "../../planner/schema.js";
import { checkPermission } from "../../trust/check.js";
import { loadProfile } from "../../trust/profile.js";
import { OmgError, ValidationError } from "../../types/errors.js";
import type { Plan } from "../../types/plan.js";
import { fail, getOutputFormat, success } from "../output.js";

export const deployCommand = new Command("deploy")
  .description("Deploy according to .omg/project.yaml")
  .option("--dry-run", "Show deployment plan without executing")
  .option("--approval <id>", "Manual approval request ID")
  .option("-y, --yes", "Approve trust-gated deployment actions")
  .action(async (opts) => {
    try {
      const plan = await loadPlan(process.cwd());
      if (!plan) {
        throw new OmgError("No project plan found. Run 'omg link' first.", "NO_PLAN", false);
      }

      const profile = await loadProfile(process.cwd());
      if (!profile) {
        throw new OmgError("No trust profile found. Run 'omg init' first.", "NO_TRUST_PROFILE", false);
      }

      if (opts.dryRun) {
        success("deploy", "Deployment plan ready.", { plan }, ["omg deploy --yes"]);
        return;
      }

      const action = plan.targets.backend ? "deploy.cloud-run" : "deploy.firebase-hosting";
      const deployArgs = extractDeployArgs(plan, action);
      const argsHash = hashArgs(deployArgs);
      const permission = await checkPermission(action, profile, {
        approvalId: opts.approval,
        argsHash,
        yes: !!opts.yes,
        jsonMode: getOutputFormat() === "json",
      });

      if (!permission.allowed) {
        if (permission.reasonCode === "APPROVAL_REQUIRED") {
          const approval = await createApproval(process.cwd(), {
            action,
            args: deployArgs,
            projectId: profile.projectId,
            environment: profile.environment,
            requestedBy: getRequester(),
          });

          fail(
            "deploy",
            "APPROVAL_REQUIRED",
            `Deploy requires manual approval. Approval ${approval.id} created.`,
            true,
            undefined,
            { approvalId: approval.id, action, expiresAt: approval.expiresAt },
            [`omg approve ${approval.id}`, `omg deploy --approval ${approval.id}`],
          );
          process.exit(1);
        }

        const { code, hint } = mapPermissionFailure(permission);
        fail(
          "deploy",
          code,
          permission.reason ?? "Deployment blocked by trust profile.",
          false,
          hint,
        );
        process.exit(1);
      }

      const result = await applyPlan(plan, {
        cwd: process.cwd(),
        profile,
        dryRun: false,
        yes: !!opts.yes,
      });

      success("deploy", "Deployment completed.", {
        urls: result.urls,
        steps: result.steps,
      });
    } catch (error) {
      const omgError =
        error instanceof OmgError
          ? error
          : new ValidationError(error instanceof Error ? error.message : "Unknown deploy error.");

      fail(
        "deploy",
        omgError.code,
        omgError.message,
        omgError.recoverable,
        omgError.code === "NO_PLAN" ? "omg link" : undefined,
      );
      process.exit(1);
    }
  });

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

function mapPermissionFailure(permission: Awaited<ReturnType<typeof checkPermission>>): {
  code: string;
  hint?: string;
} {
  switch (permission.reasonCode) {
    case "DENIED":
      return { code: "TRUST_DENIED" };
    case "REQUIRES_CONFIRM":
      return { code: "TRUST_REQUIRES_CONFIRM", hint: "--yes" };
    case "APPROVAL_NOT_FOUND":
      return { code: "APPROVAL_NOT_FOUND" };
    case "APPROVAL_EXPIRED":
      return { code: "APPROVAL_EXPIRED" };
    case "APPROVAL_NOT_APPROVED":
      return {
        code: "APPROVAL_NOT_APPROVED",
        hint: permission.approvalId ? `omg approve ${permission.approvalId}` : undefined,
      };
    case "APPROVAL_MISMATCH":
      return { code: "APPROVAL_MISMATCH" };
    case "APPROVAL_CONSUMED":
      return { code: "APPROVAL_CONSUMED" };
    default:
      return { code: "TRUST_REQUIRES_APPROVAL" };
  }
}
