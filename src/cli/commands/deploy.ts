import { Command } from "commander";
import { applyPlan } from "../../executor/apply.js";
import { loadPlan } from "../../planner/schema.js";
import { checkPermission } from "../../trust/check.js";
import { loadProfile } from "../../trust/profile.js";
import { OmgError, ValidationError } from "../../types/errors.js";
import { fail, getOutputFormat, success } from "../output.js";

export const deployCommand = new Command("deploy")
  .description("Deploy according to .omg/project.yaml")
  .option("--dry-run", "Show deployment plan without executing")
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
      const permission = checkPermission(action, profile, {
        yes: !!opts.yes,
        jsonMode: getOutputFormat() === "json",
      });

      if (!permission.allowed) {
        const code =
          permission.action === "require_confirm"
            ? "TRUST_REQUIRES_CONFIRM"
            : "TRUST_REQUIRES_APPROVAL";
        fail(
          "deploy",
          code,
          permission.reason ?? "Deployment blocked by trust profile.",
          false,
          permission.action === "require_confirm" ? "--yes" : undefined,
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
