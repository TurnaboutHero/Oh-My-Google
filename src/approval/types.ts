export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "consumed"
  | "expired";

export interface ApprovalRequest {
  id: string;
  action: string;
  argsHash: string;
  projectId: string;
  environment: "local" | "dev" | "staging" | "prod";
  requestedBy: string;
  requestedAt: string;
  expiresAt: string;
  status: ApprovalStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  reason: string | null;
}

export interface ApprovalListFilter {
  status?: ApprovalStatus;
  action?: string;
}
