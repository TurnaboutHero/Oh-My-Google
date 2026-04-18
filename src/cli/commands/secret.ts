import fs from "node:fs/promises";
import { Command } from "commander";
import { hashArgs } from "../../approval/hash.js";
import { createApproval } from "../../approval/queue.js";
import { listSecrets, setSecret } from "../../connectors/secret-manager.js";
import { checkPermission } from "../../trust/check.js";
import { loadProfile } from "../../trust/profile.js";
import { OmgError, ValidationError, type OmgError as OmgErrorType } from "../../types/errors.js";
import type { TrustProfile } from "../../types/trust.js";
import { fail, getOutputFormat, success } from "../output.js";

export interface RunSecretListInput {
  cwd: string;
  project?: string;
  limit?: number;
}

export interface RunSecretSetInput {
  cwd: string;
  project?: string;
  name: string;
  value?: string;
  valueFile?: string;
  dryRun?: boolean;
  approval?: string;
  yes?: boolean;
  jsonMode?: boolean;
  requester?: string;
}

export type RunSecretOutcome =
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

export const secretCommand = new Command("secret")
  .description("Manage Google Secret Manager metadata and secret values");

secretCommand
  .command("list")
  .description("List Secret Manager secret metadata without reading secret values")
  .option("--project <id>", "Google Cloud project ID")
  .option("--limit <count>", "Maximum number of secrets to list", parseInteger)
  .action(async (opts) => {
    const outcome = await runSecretList({
      cwd: process.cwd(),
      project: opts.project as string | undefined,
      limit: opts.limit as number | undefined,
    });

    if (outcome.ok) {
      success("secret:list", "Secrets listed.", outcome.data);
      return;
    }

    emitOutcomeError("secret:list", outcome.error);
  });

secretCommand
  .command("set")
  .description("Create or update a Secret Manager secret version")
  .argument("<name>", "Secret name")
  .option("--project <id>", "Google Cloud project ID")
  .option("--value <value>", "Secret value. Prefer --value-file to avoid shell history.")
  .option("--value-file <path>", "File containing the secret value")
  .option("--dry-run", "Show the secret write plan without calling gcloud")
  .option("--approval <id>", "Manual approval request ID")
  .option("-y, --yes", "Approve trust-gated secret write actions")
  .action(async (name, opts) => {
    const outcome = await runSecretSet({
      cwd: process.cwd(),
      project: opts.project as string | undefined,
      name: String(name),
      value: opts.value as string | undefined,
      valueFile: opts.valueFile as string | undefined,
      dryRun: !!opts.dryRun,
      approval: opts.approval as string | undefined,
      yes: !!opts.yes,
      jsonMode: getOutputFormat() === "json",
    });

    if (outcome.ok) {
      success(
        "secret:set",
        outcome.data.dryRun ? "Secret write plan ready." : "Secret updated.",
        outcome.data,
        outcome.next,
      );
      return;
    }

    emitOutcomeError("secret:set", outcome.error);
  });

secretCommand.addHelpText(
  "afterAll",
  `
Examples:
  omg secret list
  omg secret set API_KEY --value-file .secrets/api-key.txt --dry-run
  omg secret set API_KEY --value-file .secrets/api-key.txt --yes
  omg --output json secret list --limit 20
`,
);

export async function runSecretList(input: RunSecretListInput): Promise<RunSecretOutcome> {
  try {
    const profile = await resolveProfile(input.cwd);
    const projectId = resolveProfileProject(profile, input.project);
    const permission = await checkPermission("secret.list", profile, {
      cwd: input.cwd,
      jsonMode: true,
      yes: true,
    });

    if (!permission.allowed) {
      const { code, hint } = mapPermissionFailure(permission);
      return {
        ok: false,
        error: {
          code,
          message: permission.reason ?? "Secret listing blocked by trust profile.",
          recoverable: false,
          hint,
        },
      };
    }

    const result = await listSecrets({
      projectId,
      limit: input.limit,
    });

    return { ok: true, data: { ...result } };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

export async function runSecretSet(input: RunSecretSetInput): Promise<RunSecretOutcome> {
  try {
    const profile = await resolveProfile(input.cwd);
    const projectId = resolveProfileProject(profile, input.project);
    const setInput = {
      projectId,
      name: input.name,
      value: input.value,
      valueFile: input.valueFile,
      dryRun: !!input.dryRun,
    };

    if (setInput.valueFile) {
      await assertReadableValueFile(setInput.valueFile);
    }

    if (setInput.dryRun) {
      const result = await setSecret(setInput);
      return {
        ok: true,
        data: { ...result },
        next: [`omg secret set ${setInput.name} --yes`],
      };
    }

    const action = "secret.set";
    const safeArgs = {
      projectId,
      name: setInput.name,
      source: setInput.valueFile ? "value-file" : "inline-value",
    };
    const permission = await checkPermission(action, profile, {
      approvalId: input.approval,
      argsHash: hashArgs(safeArgs),
      yes: !!input.yes,
      jsonMode: !!input.jsonMode,
      cwd: input.cwd,
    });

    if (!permission.allowed) {
      if (permission.reasonCode === "APPROVAL_REQUIRED") {
        const approval = await createApproval(input.cwd, {
          action,
          args: safeArgs,
          projectId,
          environment: profile.environment,
          requestedBy: input.requester ?? getRequester(),
        });

        return {
          ok: false,
          error: {
            code: "APPROVAL_REQUIRED",
            message: `Secret write requires manual approval. Approval ${approval.id} created.`,
            recoverable: true,
            data: { approvalId: approval.id, action, expiresAt: approval.expiresAt },
            next: [`omg approve ${approval.id}`, `omg secret set ${setInput.name} --approval ${approval.id}`],
          },
        };
      }

      const { code, hint } = mapPermissionFailure(permission);
      return {
        ok: false,
        error: {
          code,
          message: permission.reason ?? "Secret write blocked by trust profile.",
          recoverable: false,
          hint,
          next: [`omg secret set ${setInput.name} --yes`],
        },
      };
    }

    const result = await setSecret(setInput);
    return {
      ok: true,
      data: { ...result },
      next: [`Use \${SECRET:${setInput.name}} in .omg/project.yaml environment values.`],
    };
  } catch (error) {
    return { ok: false, error: toOutcomeError(error) };
  }
}

async function resolveProfile(cwd: string): Promise<TrustProfile> {
  const profile = await loadProfile(cwd);
  if (!profile) {
    throw new OmgError("No trust profile found. Run 'omg init' first.", "NO_TRUST_PROFILE", false);
  }
  return profile;
}

function resolveProfileProject(profile: TrustProfile, explicitProjectId?: string): string {
  if (!explicitProjectId?.trim()) {
    return profile.projectId;
  }

  const projectId = explicitProjectId.trim();
  if (projectId !== profile.projectId) {
    throw new ValidationError("Secret writes must target the project in .omg/trust.yaml.");
  }
  return projectId;
}

async function assertReadableValueFile(filePath: string): Promise<void> {
  try {
    await fs.access(filePath);
  } catch {
    throw new ValidationError(`Secret value file is not readable: ${filePath}`);
  }
}

function parseInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) {
    throw new Error("Expected an integer.");
  }
  return parsed;
}

function emitOutcomeError(
  command: string,
  error: Extract<RunSecretOutcome, { ok: false }>["error"],
): never {
  fail(
    command,
    error.code,
    error.message,
    error.recoverable,
    error.hint,
    error.data,
    error.next,
  );
  process.exit(1);
}

function toOutcomeError(error: unknown): Extract<RunSecretOutcome, { ok: false }>["error"] {
  const omgError = toOmgError(error);
  return {
    code: omgError.code,
    message: omgError.message,
    recoverable: omgError.recoverable,
  };
}

function toOmgError(error: unknown): OmgErrorType {
  if (error instanceof OmgError) {
    return error;
  }

  if (error instanceof Error) {
    return new ValidationError(error.message);
  }

  return new ValidationError("Unknown secret command error.");
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

function getRequester(): string {
  return process.env.USER || process.env.USERNAME || "agent";
}
