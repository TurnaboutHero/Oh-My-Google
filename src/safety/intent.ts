import type { TrustLevel } from "../types/trust.js";
import { getLevel } from "../trust/levels.js";

export type OperationService =
  | "auth"
  | "billing"
  | "cloud-run"
  | "cloud-sql"
  | "cloud-storage"
  | "diagnostics"
  | "firebase-hosting"
  | "firestore"
  | "iam"
  | "planner"
  | "project-lifecycle"
  | "secret-manager"
  | "security"
  | "service-usage"
  | "unknown";

export type OperationAction =
  | "read"
  | "plan"
  | "write"
  | "deploy"
  | "secret-write"
  | "iam"
  | "lifecycle";

export type AdapterId =
  | "gcloud-cli"
  | "firebase-cli"
  | "google-client"
  | "downstream-mcp"
  | "unknown";

export interface OperationIntent {
  id: string;
  service: OperationService;
  action: OperationAction;
  trustLevel: TrustLevel;
  projectId?: string;
  resource?: string;
  adapter: AdapterId;
  costBearing: boolean;
  destructive: boolean;
  secretTouching: boolean;
  requiresBudget: boolean;
  supportsDryRun: boolean;
  postVerify: boolean;
}

export interface OperationContext {
  projectId?: string;
  resource?: string;
}

export interface AdapterCapability {
  id: AdapterId;
  kind: "cli" | "client-library" | "mcp" | "unknown";
  execution: "enabled" | "discovery-only" | "disabled";
  safetyBoundary: "operation-intent" | "deny-by-default";
}

type OperationDefaults = Omit<OperationIntent, "id" | "trustLevel" | "projectId">;

const OPERATION_DEFAULTS: Record<string, OperationDefaults> = {
  "gcp.projects.list": readOnly("project-lifecycle", "gcloud-cli", "project"),
  "gcp.auth.status": readOnly("auth", "gcloud-cli", "auth"),
  "planner.detect": readOnly("planner", "unknown", "repo"),
  "doctor.run": readOnly("diagnostics", "gcloud-cli", "doctor"),
  "project.audit": readOnly("project-lifecycle", "gcloud-cli", "project"),
  "project.cleanup.plan": {
    ...readOnly("project-lifecycle", "gcloud-cli", "cleanup-plan"),
    action: "plan",
    supportsDryRun: true,
  },
  "billing.audit": readOnly("billing", "gcloud-cli", "budget"),
  "firestore.audit": readOnly("firestore", "gcloud-cli", "firestore-databases"),
  "iam.audit": readOnly("iam", "gcloud-cli", "iam-policy"),
  "security.audit": readOnly("security", "gcloud-cli", "security-posture"),
  "secret.list": readOnly("secret-manager", "gcloud-cli", "secret"),
  "sql.audit": readOnly("cloud-sql", "gcloud-cli", "sql-instances"),
  "storage.audit": readOnly("cloud-storage", "gcloud-cli", "storage-buckets"),

  "deploy.cloud-run": {
    service: "cloud-run",
    action: "deploy",
    adapter: "gcloud-cli",
    costBearing: true,
    destructive: false,
    secretTouching: false,
    requiresBudget: true,
    supportsDryRun: true,
    postVerify: true,
  },
  "deploy.firebase-hosting": {
    service: "firebase-hosting",
    action: "deploy",
    adapter: "firebase-cli",
    costBearing: true,
    destructive: false,
    secretTouching: false,
    requiresBudget: true,
    supportsDryRun: true,
    postVerify: true,
  },
  "apis.enable": {
    service: "service-usage",
    action: "write",
    adapter: "gcloud-cli",
    costBearing: true,
    destructive: false,
    secretTouching: false,
    requiresBudget: true,
    supportsDryRun: false,
    postVerify: true,
  },
  "budget.enable-api": {
    service: "service-usage",
    action: "write",
    adapter: "gcloud-cli",
    costBearing: false,
    destructive: false,
    secretTouching: false,
    requiresBudget: false,
    supportsDryRun: true,
    postVerify: true,
  },
  "firebase.rewrites.update": {
    service: "firebase-hosting",
    action: "write",
    adapter: "firebase-cli",
    costBearing: false,
    destructive: false,
    secretTouching: false,
    requiresBudget: false,
    supportsDryRun: false,
    postVerify: true,
  },
  "iam.role.grant": {
    service: "iam",
    action: "iam",
    adapter: "gcloud-cli",
    costBearing: false,
    destructive: false,
    secretTouching: false,
    requiresBudget: false,
    supportsDryRun: false,
    postVerify: true,
  },
  "billing.link": {
    service: "billing",
    action: "write",
    adapter: "gcloud-cli",
    costBearing: true,
    destructive: false,
    secretTouching: false,
    requiresBudget: true,
    supportsDryRun: false,
    postVerify: true,
  },
  "deploy.prod": {
    service: "cloud-run",
    action: "deploy",
    adapter: "gcloud-cli",
    costBearing: true,
    destructive: false,
    secretTouching: false,
    requiresBudget: true,
    supportsDryRun: true,
    postVerify: true,
  },
  "secret.set": {
    service: "secret-manager",
    action: "secret-write",
    adapter: "gcloud-cli",
    costBearing: true,
    destructive: false,
    secretTouching: true,
    requiresBudget: true,
    supportsDryRun: true,
    postVerify: true,
  },
  "secret.delete": {
    service: "secret-manager",
    action: "lifecycle",
    adapter: "gcloud-cli",
    costBearing: false,
    destructive: true,
    secretTouching: false,
    requiresBudget: false,
    supportsDryRun: true,
    postVerify: true,
  },
  "gcp.project.delete": {
    service: "project-lifecycle",
    action: "lifecycle",
    adapter: "gcloud-cli",
    costBearing: false,
    destructive: true,
    secretTouching: false,
    requiresBudget: false,
    supportsDryRun: false,
    postVerify: true,
  },
  "gcp.project.undelete": {
    service: "project-lifecycle",
    action: "lifecycle",
    adapter: "gcloud-cli",
    costBearing: false,
    destructive: false,
    secretTouching: false,
    requiresBudget: false,
    supportsDryRun: false,
    postVerify: true,
  },
  "firestore.data.delete": {
    service: "unknown",
    action: "lifecycle",
    adapter: "unknown",
    costBearing: false,
    destructive: true,
    secretTouching: false,
    requiresBudget: false,
    supportsDryRun: false,
    postVerify: true,
  },
};

const ADAPTER_CAPABILITIES: Record<AdapterId, AdapterCapability> = {
  "gcloud-cli": {
    id: "gcloud-cli",
    kind: "cli",
    execution: "enabled",
    safetyBoundary: "operation-intent",
  },
  "firebase-cli": {
    id: "firebase-cli",
    kind: "cli",
    execution: "enabled",
    safetyBoundary: "operation-intent",
  },
  "google-client": {
    id: "google-client",
    kind: "client-library",
    execution: "enabled",
    safetyBoundary: "operation-intent",
  },
  "downstream-mcp": {
    id: "downstream-mcp",
    kind: "mcp",
    execution: "discovery-only",
    safetyBoundary: "deny-by-default",
  },
  unknown: {
    id: "unknown",
    kind: "unknown",
    execution: "disabled",
    safetyBoundary: "deny-by-default",
  },
};

export function classifyOperation(
  id: string,
  context: OperationContext = {},
): OperationIntent {
  const defaults = OPERATION_DEFAULTS[id] ?? unknownOperationDefaults(id);
  return {
    id,
    service: defaults.service,
    action: defaults.action,
    trustLevel: getLevel(id),
    projectId: context.projectId,
    resource: context.resource ?? defaults.resource,
    adapter: defaults.adapter,
    costBearing: defaults.costBearing,
    destructive: defaults.destructive,
    secretTouching: defaults.secretTouching,
    requiresBudget: defaults.requiresBudget,
    supportsDryRun: defaults.supportsDryRun,
    postVerify: defaults.postVerify,
  };
}

export function getAdapterCapability(id: AdapterId): AdapterCapability {
  return ADAPTER_CAPABILITIES[id];
}

export function listAdapterCapabilities(): AdapterCapability[] {
  return [
    ADAPTER_CAPABILITIES["gcloud-cli"],
    ADAPTER_CAPABILITIES["firebase-cli"],
    ADAPTER_CAPABILITIES["google-client"],
    ADAPTER_CAPABILITIES["downstream-mcp"],
    ADAPTER_CAPABILITIES.unknown,
  ];
}

function readOnly(
  service: OperationService,
  adapter: AdapterId,
  resource: string,
): OperationDefaults {
  return {
    service,
    action: "read",
    resource,
    adapter,
    costBearing: false,
    destructive: false,
    secretTouching: false,
    requiresBudget: false,
    supportsDryRun: false,
    postVerify: false,
  };
}

function unknownOperationDefaults(id: string): OperationDefaults {
  return {
    service: "unknown",
    action: inferUnknownAction(id),
    adapter: "unknown",
    costBearing: true,
    destructive: id.includes("delete") || id.includes("destroy"),
    secretTouching: id.includes("secret"),
    requiresBudget: true,
    supportsDryRun: false,
    postVerify: true,
  };
}

function inferUnknownAction(id: string): OperationAction {
  if (id.includes("delete") || id.includes("undelete")) {
    return "lifecycle";
  }
  if (id.includes("deploy")) {
    return "deploy";
  }
  if (id.includes("secret")) {
    return "secret-write";
  }
  if (id.includes("audit") || id.includes("list") || id.includes("status")) {
    return "read";
  }
  return "write";
}
