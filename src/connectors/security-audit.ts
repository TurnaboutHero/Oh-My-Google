import { auditBillingGuard, type BillingGuardAudit } from "./billing-audit.js";
import { auditIam, type IamAudit } from "./iam-audit.js";
import { auditProject, type ProjectAudit } from "./project-audit.js";
import { OmgError, ValidationError } from "../types/errors.js";

export type SecurityAuditRisk = "low" | "review" | "high";

export interface SecuritySectionError {
  code: string;
  message: string;
  recoverable: boolean;
}

export interface SecurityAuditSection {
  ok: boolean;
  risk?: string;
  signals: string[];
  error?: SecuritySectionError;
  summary?: Record<string, unknown>;
}

export interface SecurityAudit {
  projectId: string;
  sections: {
    project: SecurityAuditSection;
    iam: SecurityAuditSection;
    budget: SecurityAuditSection;
  };
  signals: string[];
  risk: SecurityAuditRisk;
  recommendedAction: string;
}

export interface SecurityAuditProviders {
  projectAudit: (projectId: string) => Promise<ProjectAudit>;
  iamAudit: (projectId: string) => Promise<IamAudit>;
  budgetAudit: (projectId: string) => Promise<BillingGuardAudit>;
}

const DEFAULT_PROVIDERS: SecurityAuditProviders = {
  projectAudit: auditProject,
  iamAudit: auditIam,
  budgetAudit: auditBillingGuard,
};

export async function auditSecurity(
  projectId: string,
  providers: Partial<SecurityAuditProviders> = {},
): Promise<SecurityAudit> {
  const normalizedProjectId = normalizeProjectId(projectId);
  const resolvedProviders = { ...DEFAULT_PROVIDERS, ...providers };
  const project = await resolvedProviders.projectAudit(normalizedProjectId);
  const iam = await captureSection(() => resolvedProviders.iamAudit(normalizedProjectId));
  const budget = await captureSection(() => resolvedProviders.budgetAudit(normalizedProjectId));

  const sections = {
    project: summarizeProject(project),
    iam: iam.ok ? summarizeIam(iam.data) : sectionFromError(iam.error),
    budget: budget.ok ? summarizeBudget(budget.data) : sectionFromError(budget.error),
  };
  const signals = buildSignals(sections);
  const risk = classifyRisk(sections);

  return {
    projectId: normalizedProjectId,
    sections,
    signals,
    risk,
    recommendedAction: getRecommendedAction(risk),
  };
}

function summarizeProject(audit: ProjectAudit): SecurityAuditSection {
  return {
    ok: true,
    risk: audit.risk,
    signals: audit.signals,
    summary: {
      lifecycleState: audit.lifecycleState,
      billingEnabled: audit.billingEnabled,
      callerRoles: audit.callerRoles,
      enabledServiceCount: audit.enabledServices.length,
      serviceAccountCount: audit.serviceAccounts.length,
      inaccessible: audit.inaccessible,
    },
  };
}

function summarizeIam(audit: IamAudit): SecurityAuditSection {
  return {
    ok: true,
    risk: audit.risk,
    signals: audit.signals,
    summary: {
      bindingCount: audit.bindings.length,
      serviceAccountCount: audit.serviceAccounts.length,
      findingCount: audit.findings.length,
      highFindingCount: audit.findings.filter((finding) => finding.severity === "high").length,
      inaccessible: audit.inaccessible,
    },
  };
}

function summarizeBudget(audit: BillingGuardAudit): SecurityAuditSection {
  return {
    ok: true,
    risk: audit.risk,
    signals: audit.signals,
    summary: {
      billingEnabled: audit.billingEnabled,
      billingAccountId: audit.billingAccountId,
      budgetCount: audit.budgets.length,
      inaccessible: audit.inaccessible ?? [],
    },
  };
}

function sectionFromError(error: SecuritySectionError): SecurityAuditSection {
  return {
    ok: false,
    signals: [`Audit section failed: ${error.code}.`],
    error,
  };
}

async function captureSection<T>(
  fn: () => Promise<T>,
): Promise<{ ok: true; data: T } | { ok: false; error: SecuritySectionError }> {
  try {
    return { ok: true, data: await fn() };
  } catch (error) {
    return { ok: false, error: toSectionError(error) };
  }
}

function classifyRisk(sections: SecurityAudit["sections"]): SecurityAuditRisk {
  const risks = [
    mapProjectRisk(sections.project),
    mapIamRisk(sections.iam),
    mapBudgetRisk(sections.budget),
  ];
  if (risks.includes("high")) {
    return "high";
  }
  if (risks.includes("review")) {
    return "review";
  }
  return "low";
}

function mapProjectRisk(section: SecurityAuditSection): SecurityAuditRisk {
  if (!section.ok) {
    return "review";
  }
  if (section.risk === "do_not_touch") {
    return "high";
  }
  return section.risk === "review" ? "review" : "low";
}

function mapIamRisk(section: SecurityAuditSection): SecurityAuditRisk {
  if (!section.ok) {
    return "review";
  }
  if (section.risk === "high") {
    return "high";
  }
  return section.risk === "review" ? "review" : "low";
}

function mapBudgetRisk(section: SecurityAuditSection): SecurityAuditRisk {
  if (!section.ok) {
    return "review";
  }
  return section.risk === "missing_budget" || section.risk === "review" ? "review" : "low";
}

function buildSignals(sections: SecurityAudit["sections"]): string[] {
  return [
    ...prefixSignals("Project", sections.project),
    ...prefixSignals("IAM", sections.iam),
    ...prefixSignals("Budget", sections.budget),
  ];
}

function prefixSignals(label: string, section: SecurityAuditSection): string[] {
  if (section.signals.length === 0) {
    return [`${label}: no risk signals reported.`];
  }
  return section.signals.map((signal) => `${label}: ${signal}`);
}

function getRecommendedAction(risk: SecurityAuditRisk): string {
  if (risk === "high") {
    return "Review high-risk project or IAM findings manually before live operations.";
  }
  if (risk === "review") {
    return "Review security audit findings before adding new live operations.";
  }
  return "No broad security posture risk signals were detected.";
}

function normalizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(trimmed)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return trimmed;
}

function toSectionError(error: unknown): SecuritySectionError {
  if (error instanceof OmgError) {
    return {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
    };
  }
  if (error instanceof Error) {
    return {
      code: "VALIDATION_ERROR",
      message: error.message,
      recoverable: false,
    };
  }
  return {
    code: "VALIDATION_ERROR",
    message: "Unknown security audit section error.",
    recoverable: false,
  };
}
