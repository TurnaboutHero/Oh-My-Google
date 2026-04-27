import type { BillingBudgetSummary, BillingGuardAudit } from "./billing-audit.js";
import { ValidationError } from "../types/errors.js";

export interface BudgetPolicyInput {
  projectId: string;
  amount: number;
  currencyCode: string;
  thresholdPercents: number[];
  displayName?: string;
}

export interface DesiredBudgetPolicy {
  projectId: string;
  displayName: string;
  amount: {
    currencyCode: string;
    units: string;
    nanos?: number;
  };
  thresholdPercents: number[];
}

export interface BudgetEnsurePlan {
  projectId: string;
  billingAccountId?: string;
  auditRisk: BillingGuardAudit["risk"];
  dryRun: true;
  desiredPolicy: DesiredBudgetPolicy;
  existingBudgetCount: number;
  matchedBudget?: BillingBudgetSummary;
  action: "none" | "create" | "update" | "blocked";
  changes: string[];
  blockers: string[];
  recommendedAction: string;
}

export interface BudgetApiBudgetPayload {
  name?: string;
  displayName: string;
  budgetFilter: {
    projects: string[];
    calendarPeriod: "MONTH";
    creditTypesTreatment: "INCLUDE_ALL_CREDITS";
  };
  amount: {
    specifiedAmount: DesiredBudgetPolicy["amount"];
  };
  thresholdRules: Array<{
    thresholdPercent: number;
    spendBasis: "CURRENT_SPEND";
  }>;
}

export interface BudgetApiMutationPlan {
  action: "none" | "create" | "update" | "blocked";
  parent?: string;
  name?: string;
  updateMask?: string[];
  budget?: BudgetApiBudgetPayload;
  blockers: string[];
}

export interface BudgetEnsurePostVerification {
  verified: boolean;
  action: "none" | "create" | "update" | "blocked";
  matchedBudget?: BillingBudgetSummary;
  remainingChanges: string[];
  blockers: string[];
}

export function parseBudgetPolicyInput(input: {
  project?: string;
  amount?: string | number;
  currency?: string;
  thresholds?: string | number[];
  displayName?: string;
}): BudgetPolicyInput {
  const projectId = normalizeProjectId(input.project);
  const amount = normalizeAmount(input.amount);
  const currencyCode = normalizeCurrency(input.currency);
  const thresholdPercents = normalizeThresholds(input.thresholds);
  const displayName = normalizeDisplayName(input.displayName);

  return {
    projectId,
    amount,
    currencyCode,
    thresholdPercents,
    displayName,
  };
}

export function planBudgetApiMutation(plan: BudgetEnsurePlan): BudgetApiMutationPlan {
  if (plan.action === "blocked") {
    return {
      action: "blocked",
      blockers: plan.blockers,
    };
  }

  if (plan.action === "none") {
    return {
      action: "none",
      blockers: [],
    };
  }

  if (!plan.billingAccountId) {
    return {
      action: "blocked",
      blockers: ["No linked billing account was visible."],
    };
  }

  const budget = buildBudgetApiBudgetPayload(plan.desiredPolicy, plan.matchedBudget?.name);
  if (plan.action === "create") {
    return {
      action: "create",
      parent: `billingAccounts/${plan.billingAccountId}`,
      budget,
      blockers: [],
    };
  }

  if (!plan.matchedBudget?.name) {
    return {
      action: "blocked",
      blockers: ["Matched budget resource name is missing."],
    };
  }

  return {
    action: "update",
    name: plan.matchedBudget.name,
    updateMask: ["displayName", "budgetFilter", "amount", "thresholdRules"],
    budget,
    blockers: [],
  };
}

export function verifyBudgetEnsurePostState(
  audit: BillingGuardAudit,
  desiredPolicy: DesiredBudgetPolicy,
): BudgetEnsurePostVerification {
  const blockers = getAuditBlockers(audit);
  if (blockers.length > 0) {
    return {
      verified: false,
      action: "blocked",
      remainingChanges: [],
      blockers,
    };
  }

  const matchedBudget = audit.budgets.find((budget) => budget.displayName === desiredPolicy.displayName);
  if (!matchedBudget) {
    return {
      verified: false,
      action: "create",
      remainingChanges: [`Create budget ${desiredPolicy.displayName}.`],
      blockers: [],
    };
  }

  const remainingChanges = getBudgetChanges(matchedBudget, desiredPolicy);
  return {
    verified: remainingChanges.length === 0,
    action: remainingChanges.length === 0 ? "none" : "update",
    matchedBudget,
    remainingChanges,
    blockers: [],
  };
}

export function planBudgetEnsure(
  audit: BillingGuardAudit,
  input: BudgetPolicyInput,
): BudgetEnsurePlan {
  const desiredPolicy = buildDesiredPolicy(input);
  const base = {
    projectId: input.projectId,
    billingAccountId: audit.billingAccountId,
    auditRisk: audit.risk,
    dryRun: true as const,
    desiredPolicy,
    existingBudgetCount: audit.budgets.length,
  };

  const blockers = getAuditBlockers(audit);
  if (blockers.length > 0) {
    return {
      ...base,
      action: "blocked",
      changes: [],
      blockers,
      recommendedAction: audit.recommendedAction,
    };
  }

  const namedBudget = audit.budgets.find((budget) => budget.displayName === desiredPolicy.displayName);
  if (!namedBudget) {
    return {
      ...base,
      action: "create",
      changes: [
        `Create budget ${desiredPolicy.displayName}.`,
        `Set amount to ${formatAmount(desiredPolicy.amount)}.`,
        `Set thresholds to ${formatThresholds(desiredPolicy.thresholdPercents)}.`,
      ],
      blockers: [],
      recommendedAction: "Create the expected project budget policy before cost-bearing live operations.",
    };
  }

  const changes = getBudgetChanges(namedBudget, desiredPolicy);
  if (changes.length === 0) {
    return {
      ...base,
      matchedBudget: namedBudget,
      action: "none",
      changes: [],
      blockers: [],
      recommendedAction: "Expected budget policy is already visible.",
    };
  }

  return {
    ...base,
    matchedBudget: namedBudget,
    action: "update",
    changes,
    blockers: [],
    recommendedAction: "Update the visible budget to match the expected policy.",
  };
}

function buildDesiredPolicy(input: BudgetPolicyInput): DesiredBudgetPolicy {
  return {
    projectId: input.projectId,
    displayName: input.displayName ?? `omg budget guard: ${input.projectId}`,
    amount: amountToMoney(input.amount, input.currencyCode),
    thresholdPercents: input.thresholdPercents,
  };
}

function buildBudgetApiBudgetPayload(
  desiredPolicy: DesiredBudgetPolicy,
  name?: string,
): BudgetApiBudgetPayload {
  return {
    ...(name ? { name } : {}),
    displayName: desiredPolicy.displayName,
    budgetFilter: {
      projects: [`projects/${desiredPolicy.projectId}`],
      calendarPeriod: "MONTH",
      creditTypesTreatment: "INCLUDE_ALL_CREDITS",
    },
    amount: {
      specifiedAmount: desiredPolicy.amount,
    },
    thresholdRules: desiredPolicy.thresholdPercents.map((thresholdPercent) => ({
      thresholdPercent,
      spendBasis: "CURRENT_SPEND",
    })),
  };
}

function getAuditBlockers(audit: BillingGuardAudit): string[] {
  const blockers: string[] = [];
  if (!audit.billingEnabled) {
    blockers.push("Billing is disabled for the project.");
  }
  if (!audit.billingAccountId) {
    blockers.push("No linked billing account was visible.");
  }
  if (audit.risk === "review") {
    blockers.push("Billing budgets could not be inspected.");
  }
  return blockers;
}

function getBudgetChanges(
  budget: BillingBudgetSummary,
  desired: DesiredBudgetPolicy,
): string[] {
  const changes: string[] = [];
  if (!sameAmount(budget, desired)) {
    changes.push(`Set amount to ${formatAmount(desired.amount)}.`);
  }
  if (!sameThresholds(budget.thresholdPercents, desired.thresholdPercents)) {
    changes.push(`Set thresholds to ${formatThresholds(desired.thresholdPercents)}.`);
  }
  return changes;
}

function sameAmount(
  budget: BillingBudgetSummary,
  desired: DesiredBudgetPolicy,
): boolean {
  const amount = budget.amount;
  if (!amount) {
    return false;
  }
  return (amount.currencyCode ?? "").toUpperCase() === desired.amount.currencyCode
    && Number(amount.units ?? "0") === Number(desired.amount.units)
    && Number(amount.nanos ?? 0) === Number(desired.amount.nanos ?? 0);
}

function sameThresholds(left: number[], right: number[]): boolean {
  const a = [...left].sort((x, y) => x - y);
  const b = [...right].sort((x, y) => x - y);
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < 0.000001);
}

function normalizeProjectId(value: string | undefined): string {
  const projectId = value?.trim() ?? "";
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return projectId;
}

function normalizeAmount(value: string | number | undefined): number {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new ValidationError("Budget amount must be a positive number.");
  }
  if (amount > Number.MAX_SAFE_INTEGER) {
    throw new ValidationError("Budget amount is too large.");
  }
  return amount;
}

function normalizeCurrency(value: string | undefined): string {
  const currency = value?.trim().toUpperCase() ?? "";
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new ValidationError("Budget currency must be a 3-letter currency code.");
  }
  return currency;
}

function normalizeThresholds(value: string | number[] | undefined): number[] {
  const raw = Array.isArray(value)
    ? value
    : (value ?? "0.5,0.9,1").split(",").map((entry) => Number(entry.trim()));
  const thresholds = [...new Set(raw)].sort((a, b) => a - b);
  if (thresholds.length === 0 || thresholds.some((entry) => !Number.isFinite(entry) || entry <= 0 || entry > 10)) {
    throw new ValidationError("Budget thresholds must be positive numbers no greater than 10.");
  }
  return thresholds;
}

function normalizeDisplayName(value: string | undefined): string | undefined {
  const displayName = value?.trim();
  if (!displayName) {
    return undefined;
  }
  if (displayName.length > 60) {
    throw new ValidationError("Budget display name must be 60 characters or less.");
  }
  return displayName;
}

function amountToMoney(amount: number, currencyCode: string): DesiredBudgetPolicy["amount"] {
  const units = Math.trunc(amount);
  const nanos = Math.round((amount - units) * 1_000_000_000);
  return {
    currencyCode,
    units: String(units),
    ...(nanos > 0 ? { nanos } : {}),
  };
}

function formatAmount(amount: DesiredBudgetPolicy["amount"]): string {
  const numeric = Number(amount.units) + Number(amount.nanos ?? 0) / 1_000_000_000;
  return `${amount.currencyCode} ${numeric}`;
}

function formatThresholds(thresholds: number[]): string {
  return thresholds.map((threshold) => `${Math.round(threshold * 100)}%`).join(", ");
}
