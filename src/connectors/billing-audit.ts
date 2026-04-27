import type { ExecFileException } from "node:child_process";
import { execCliFile } from "../system/cli-runner.js";
import { AuthError, CliRunnerError, OmgError, ValidationError } from "../types/errors.js";

export type BillingGuardRisk = "configured" | "missing_budget" | "billing_disabled" | "review";

export interface BillingBudgetSummary {
  name: string;
  displayName: string;
  amount?: {
    currencyCode?: string;
    units?: string;
    nanos?: number;
  };
  thresholdPercents: number[];
  notificationsRule?: BillingBudgetNotificationsRule;
}

export interface BillingBudgetNotificationsRule {
  pubsubTopic?: string;
  schemaVersion?: string;
  monitoringNotificationChannels?: string[];
  disableDefaultIamRecipients?: boolean;
  enableProjectLevelRecipients?: boolean;
}

export interface BillingGuardAudit {
  projectId: string;
  billingEnabled: boolean;
  billingAccountId?: string;
  budgets: BillingBudgetSummary[];
  inaccessible?: string[];
  signals: string[];
  risk: BillingGuardRisk;
  recommendedAction: string;
}

export type BillingAuditExecutor = (
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export async function auditBillingGuard(
  projectId: string,
  executor: BillingAuditExecutor = runGcloud,
): Promise<BillingGuardAudit> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const billing = await readJsonObject(
    executor,
    ["billing", "projects", "describe", normalizedProjectId, "--format=json"],
    "billing project metadata",
  );
  const billingEnabled = billing.billingEnabled === true;
  const billingAccountId = stripBillingAccountPrefix(stringValue(billing.billingAccountName));

  if (!billingEnabled) {
    return {
      projectId: normalizedProjectId,
      billingEnabled: false,
      budgets: [],
      signals: ["Billing is disabled."],
      risk: "billing_disabled",
      recommendedAction: "Billing is disabled; cost-bearing live operations should remain blocked.",
    };
  }

  const budgetsResult = billingAccountId
    ? await readBudgets(executor, billingAccountId)
    : { budgets: [], inaccessible: ["billing budgets"] };
  const signals = buildSignals(budgetsResult.budgets, budgetsResult.inaccessible);
  const risk: BillingGuardRisk =
    budgetsResult.inaccessible.length > 0
      ? "review"
      : budgetsResult.budgets.length > 0
        ? "configured"
        : "missing_budget";

  return {
    projectId: normalizedProjectId,
    billingEnabled: true,
    billingAccountId,
    budgets: budgetsResult.budgets,
    inaccessible: budgetsResult.inaccessible.length > 0 ? budgetsResult.inaccessible : undefined,
    signals,
    risk,
    recommendedAction: getRecommendedAction(risk),
  };
}

export async function auditBillingAccountGuard(
  projectId: string,
  billingAccountId: string,
  executor: BillingAuditExecutor = runGcloud,
): Promise<BillingGuardAudit> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const normalizedBillingAccountId = normalizeBillingAccountId(billingAccountId);
  const budgetsResult = await readBudgets(executor, normalizedBillingAccountId);
  const signals = buildSignals(budgetsResult.budgets, budgetsResult.inaccessible);
  const risk: BillingGuardRisk =
    budgetsResult.inaccessible.length > 0
      ? "review"
      : budgetsResult.budgets.length > 0
        ? "configured"
        : "missing_budget";

  return {
    projectId: normalizedProjectId,
    billingEnabled: true,
    billingAccountId: normalizedBillingAccountId,
    budgets: budgetsResult.budgets,
    inaccessible: budgetsResult.inaccessible.length > 0 ? budgetsResult.inaccessible : undefined,
    signals,
    risk,
    recommendedAction: getRecommendedAction(risk),
  };
}

async function readBudgets(
  executor: BillingAuditExecutor,
  billingAccountId: string,
): Promise<{ budgets: BillingBudgetSummary[]; inaccessible: string[] }> {
  try {
    const rows = await readJsonArray(
      executor,
      ["billing", "budgets", "list", `--billing-account=${billingAccountId}`, "--format=json", "--quiet"],
      "billing budgets",
    );
    return {
      budgets: rows.map(parseBudget),
      inaccessible: [],
    };
  } catch {
    return {
      budgets: [],
      inaccessible: ["billing budgets"],
    };
  }
}

function parseBudget(row: Record<string, unknown>): BillingBudgetSummary {
  const amount = getRecord(getRecord(row.amount)?.specifiedAmount);
  const notificationsRule = parseNotificationsRule(getRecord(row.notificationsRule));
  return {
    name: stringValue(row.name),
    displayName: stringValue(row.displayName) || stringValue(row.name),
    amount: amount
      ? {
          currencyCode: stringValue(amount.currencyCode) || undefined,
          units: stringValue(amount.units) || undefined,
          nanos: typeof amount.nanos === "number" ? amount.nanos : undefined,
        }
      : undefined,
    thresholdPercents: arrayValue(row.thresholdRules)
      .map((rule) => getRecord(rule)?.thresholdPercent)
      .filter((value): value is number => typeof value === "number"),
    ...(notificationsRule ? { notificationsRule } : {}),
  };
}

function parseNotificationsRule(
  rule: Record<string, unknown> | undefined,
): BillingBudgetNotificationsRule | undefined {
  if (!rule) {
    return undefined;
  }

  const monitoringNotificationChannels = arrayValue(rule.monitoringNotificationChannels)
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0);
  const parsed: BillingBudgetNotificationsRule = {
    ...(stringValue(rule.pubsubTopic) ? { pubsubTopic: stringValue(rule.pubsubTopic) } : {}),
    ...(stringValue(rule.schemaVersion) ? { schemaVersion: stringValue(rule.schemaVersion) } : {}),
    ...(monitoringNotificationChannels.length > 0 ? { monitoringNotificationChannels } : {}),
    ...(typeof rule.disableDefaultIamRecipients === "boolean"
      ? { disableDefaultIamRecipients: rule.disableDefaultIamRecipients }
      : {}),
    ...(typeof rule.enableProjectLevelRecipients === "boolean"
      ? { enableProjectLevelRecipients: rule.enableProjectLevelRecipients }
      : {}),
  };

  return Object.keys(parsed).length > 0 ? parsed : undefined;
}

function buildSignals(budgets: BillingBudgetSummary[], inaccessible: string[]): string[] {
  if (inaccessible.length > 0) {
    return ["Billing budgets could not be inspected."];
  }
  if (budgets.length === 0) {
    return ["Billing is enabled but no budgets were found."];
  }
  return budgets.map((budget) => `Budget configured: ${budget.displayName}.`);
}

function getRecommendedAction(risk: BillingGuardRisk): string {
  switch (risk) {
    case "configured":
      return "Budget guard is configured for this billing account.";
    case "missing_budget":
      return "Create a billing budget before running cost-bearing live operations.";
    case "billing_disabled":
      return "Billing is disabled; cost-bearing live operations should remain blocked.";
    case "review":
      return "Review billing budget visibility before running cost-bearing live operations.";
  }
}

async function runGcloud(args: string[]): Promise<{ stdout: string; stderr: string }> {
  try {
    return await execCliFile("gcloud", args, {
      encoding: "utf-8",
      windowsHide: true,
      maxBuffer: 1024 * 1024 * 10,
    });
  } catch (error) {
    throw mapGcloudError(error, "gcloud billing audit command failed.");
  }
}

async function readJsonObject(
  executor: BillingAuditExecutor,
  args: string[],
  label: string,
): Promise<Record<string, unknown>> {
  try {
    const { stdout } = await executor(args);
    return JSON.parse(stdout || "{}") as Record<string, unknown>;
  } catch (error) {
    throw mapGcloudError(error, `Failed to read ${label}.`);
  }
}

async function readJsonArray(
  executor: BillingAuditExecutor,
  args: string[],
  label: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const { stdout } = await executor(args);
    return JSON.parse(stdout || "[]") as Array<Record<string, unknown>>;
  } catch (error) {
    throw mapGcloudError(error, `Failed to read ${label}.`);
  }
}

function normalizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(trimmed)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return trimmed;
}

function normalizeBillingAccountId(billingAccountId: string): string {
  const trimmed = stripBillingAccountPrefix(billingAccountId.trim());
  if (!trimmed) {
    throw new ValidationError("Billing account ID is required.");
  }
  return trimmed;
}

function stripBillingAccountPrefix(value: string): string | undefined {
  const stripped = value.replace(/^billingAccounts\//, "");
  return stripped || undefined;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function mapGcloudError(error: unknown, message: string): OmgError {
  if (error instanceof OmgError) {
    return error;
  }

  const cliError = error as ExecFileException & { stderr?: string; exitCode?: number };
  const stderr = `${cliError.stderr ?? cliError.message ?? ""}`.trim();
  const normalized = stderr.toLowerCase();
  if (normalized.includes("not authenticated") || normalized.includes("no active account")) {
    return new AuthError("gcloud is not authenticated.", "NO_AUTH");
  }
  if (normalized.includes("billing")) {
    return new OmgError("Billing information could not be accessed.", "NO_BILLING", true);
  }
  return new CliRunnerError(message, typeof cliError.code === "number" ? cliError.code : cliError.exitCode ?? 1, stderr);
}
