import type { IamAudit } from "../connectors/iam-audit.js";
import { ValidationError } from "../types/errors.js";

export type AgentIamPlanStatus = "ready" | "review" | "blocked";
export type AgentIamPrincipalKey = "auditor" | "deployer" | "secret-admin";
export type AgentIamGrantScope = "project" | "service-account" | "billing-account";
export type AgentIamGrantStatus = "present" | "missing" | "manual-review";

export interface AgentIamGrantPlan {
  principal: string;
  role: string;
  scope: AgentIamGrantScope;
  target: string;
  reason: string;
  status: AgentIamGrantStatus;
  command?: string;
}

export interface AgentIamPrincipalPlan {
  key: AgentIamPrincipalKey;
  serviceAccountId: string;
  email: string;
  member: string;
  displayName: string;
  purpose: string;
  serviceAccountExists: boolean;
  createCommand: string;
  grants: AgentIamGrantPlan[];
}

export interface AgentIamManualAction {
  category: string;
  reason: string;
  examples: string[];
}

export interface AgentIamPlan {
  projectId: string;
  prefix: string;
  auditRisk: IamAudit["risk"];
  status: AgentIamPlanStatus;
  blocked: boolean;
  blockers: string[];
  warnings: string[];
  principals: AgentIamPrincipalPlan[];
  manualActions: AgentIamManualAction[];
  next: string[];
}

interface PrincipalDefinition {
  key: AgentIamPrincipalKey;
  suffix: string;
  displayName: string;
  purpose: string;
  projectRoles: Array<{
    role: string;
    reason: string;
  }>;
}

const PRINCIPALS: PrincipalDefinition[] = [
  {
    key: "auditor",
    suffix: "auditor",
    displayName: "omg read-only auditor",
    purpose: "Runs read-only posture checks for project, IAM, resources, and service readiness.",
    projectRoles: [
      {
        role: "roles/viewer",
        reason: "Read project resource metadata for audit and status commands.",
      },
      {
        role: "roles/iam.securityReviewer",
        reason: "Read IAM policies and service account metadata without granting permissions.",
      },
      {
        role: "roles/serviceusage.serviceUsageViewer",
        reason: "Read enabled API state for doctor, setup review, and readiness checks.",
      },
    ],
  },
  {
    key: "deployer",
    suffix: "deployer",
    displayName: "omg deploy executor",
    purpose: "Runs live deploy paths after trust, cost-lock, and budget guard checks pass.",
    projectRoles: [
      {
        role: "roles/run.admin",
        reason: "Deploy and update Cloud Run services used by omg deploy.",
      },
      {
        role: "roles/firebasehosting.admin",
        reason: "Deploy Firebase Hosting and manage hosting release state.",
      },
    ],
  },
  {
    key: "secret-admin",
    suffix: "secret-admin",
    displayName: "omg secret administrator",
    purpose: "Runs Secret Manager list/set/delete workflows without sharing deployer identity.",
    projectRoles: [
      {
        role: "roles/secretmanager.admin",
        reason: "Create, add versions to, list, and delete Secret Manager secrets through omg.",
      },
    ],
  },
];

const DEFAULT_PREFIX = "omg-agent";

export function planAgentIam(
  audit: IamAudit,
  input: {
    prefix?: string;
  } = {},
): AgentIamPlan {
  const projectId = normalizeProjectId(audit.projectId);
  const prefix = normalizePrefix(input.prefix ?? DEFAULT_PREFIX);
  const blockers = getBlockers(audit);
  const warnings = getWarnings(audit);
  const principals = PRINCIPALS.map((principal) =>
    buildPrincipalPlan(audit, projectId, prefix, principal),
  );
  const manualActions = buildManualActions(projectId, prefix);
  const missingProjectGrants = principals.flatMap((principal) =>
    principal.grants.filter((grant) => grant.status === "missing"),
  );
  const missingServiceAccounts = principals.filter((principal) => !principal.serviceAccountExists);
  const status = blockers.length > 0
    ? "blocked"
    : audit.risk === "review"
      || warnings.length > 0
      || missingProjectGrants.length > 0
      || missingServiceAccounts.length > 0
        ? "review"
        : "ready";

  return {
    projectId,
    prefix,
    auditRisk: audit.risk,
    status,
    blocked: status === "blocked",
    blockers,
    warnings,
    principals,
    manualActions,
    next: getNext(status, projectId),
  };
}

function buildPrincipalPlan(
  audit: IamAudit,
  projectId: string,
  prefix: string,
  definition: PrincipalDefinition,
): AgentIamPrincipalPlan {
  const serviceAccountId = `${prefix}-${definition.suffix}`;
  const email = `${serviceAccountId}@${projectId}.iam.gserviceaccount.com`;
  const member = `serviceAccount:${email}`;
  const serviceAccountExists = audit.serviceAccounts.some((account) => account.email === email);

  return {
    key: definition.key,
    serviceAccountId,
    email,
    member,
    displayName: definition.displayName,
    purpose: definition.purpose,
    serviceAccountExists,
    createCommand: [
      "gcloud iam service-accounts create",
      serviceAccountId,
      `--project ${projectId}`,
      `--display-name "${definition.displayName}"`,
    ].join(" "),
    grants: definition.projectRoles.map((grant) => ({
      principal: member,
      role: grant.role,
      scope: "project",
      target: projectId,
      reason: grant.reason,
      status: hasProjectBinding(audit, member, grant.role) ? "present" : "missing",
      command: [
        "gcloud projects add-iam-policy-binding",
        projectId,
        `--member ${member}`,
        `--role ${grant.role}`,
      ].join(" "),
    })),
  };
}

function buildManualActions(projectId: string, prefix: string): AgentIamManualAction[] {
  const deployerMember = `serviceAccount:${prefix}-deployer@${projectId}.iam.gserviceaccount.com`;
  const auditorMember = `serviceAccount:${prefix}-auditor@${projectId}.iam.gserviceaccount.com`;
  return [
    {
      category: "runtime-service-account-user",
      reason: "Grant deployer impersonation only on the selected Cloud Run runtime service account, not project-wide, unless the owner explicitly approves broader scope.",
      examples: [
        `gcloud iam service-accounts add-iam-policy-binding <runtime-sa>@${projectId}.iam.gserviceaccount.com --project ${projectId} --member ${deployerMember} --role roles/iam.serviceAccountUser`,
      ],
    },
    {
      category: "billing-visibility",
      reason: "Budget and billing visibility can require billing-account scope, which cannot be fully inferred from project IAM policy alone.",
      examples: [
        `Grant roles/billing.viewer to ${auditorMember} on the linked billing account after owner review.`,
      ],
    },
    {
      category: "bootstrap-human-only",
      reason: "API enablement, IAM grants, and billing linkage remain high-impact setup operations and should stay human-run until a separate owner-approved bootstrap workflow exists.",
      examples: [
        "Keep roles/serviceusage.serviceUsageAdmin and roles/resourcemanager.projectIamAdmin out of always-on agent identities.",
      ],
    },
  ];
}

function hasProjectBinding(audit: IamAudit, member: string, role: string): boolean {
  return audit.bindings.some((binding) =>
    binding.role === role && binding.members.includes(member),
  );
}

function getBlockers(audit: IamAudit): string[] {
  const blockers: string[] = [];
  if (audit.risk === "high") {
    blockers.push("IAM audit risk is high; review findings before planning agent IAM bootstrap.");
  }
  if (audit.inaccessible.includes("iam policy")) {
    blockers.push("IAM policy is not visible; cannot compare proposed grants against current bindings.");
  }
  if (audit.inaccessible.includes("service accounts")) {
    blockers.push("Service accounts are not visible; cannot compare proposed agent identities against current state.");
  }
  return blockers;
}

function getWarnings(audit: IamAudit): string[] {
  return audit.findings
    .filter((finding) => finding.severity === "review")
    .map((finding) => {
      const role = finding.role ? ` Role: ${finding.role}.` : "";
      const member = finding.member ? ` Member: ${finding.member}.` : "";
      return `${finding.reason}${role}${member}`;
    });
}

function getNext(status: AgentIamPlanStatus, projectId: string): string[] {
  if (status === "blocked") {
    return [`omg iam audit --project ${projectId}`];
  }
  return [`omg iam bootstrap --project ${projectId} --dry-run`];
}

function normalizeProjectId(projectId: string): string {
  const trimmed = projectId.trim();
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(trimmed)) {
    throw new ValidationError("A valid project ID is required.");
  }
  return trimmed;
}

function normalizePrefix(value: string): string {
  const prefix = value.trim();
  if (!/^[a-z][a-z0-9-]{1,15}[a-z0-9]$/.test(prefix)) {
    throw new ValidationError("Agent IAM prefix must be 3-17 lowercase letters, numbers, or hyphens.");
  }
  return prefix;
}
