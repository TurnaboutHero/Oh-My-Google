import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { parse, stringify } from "yaml";
import { hashArgs } from "./hash.js";
import type { ApprovalListFilter, ApprovalRequest, ApprovalStatus } from "./types.js";
import { ValidationError } from "../types/errors.js";

const APPROVAL_DIR = ".omg/approvals";
export const DEFAULT_TTL_MINUTES = 60;

export interface CreateApprovalInput {
  action: string;
  args: Record<string, unknown>;
  projectId: string;
  environment: ApprovalRequest["environment"];
  requestedBy: string;
  ttlMinutes?: number;
}

export async function createApproval(
  cwd: string,
  input: CreateApprovalInput,
): Promise<ApprovalRequest> {
  const requestedAt = new Date();
  const ttlMinutes = input.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const approval: ApprovalRequest = {
    id: createApprovalId(requestedAt),
    action: input.action,
    argsHash: hashArgs(input.args),
    projectId: input.projectId,
    environment: input.environment,
    requestedBy: input.requestedBy,
    requestedAt: requestedAt.toISOString(),
    expiresAt: new Date(requestedAt.getTime() + ttlMinutes * 60_000).toISOString(),
    status: "pending",
    approvedBy: null,
    approvedAt: null,
    reason: null,
  };

  await saveApproval(cwd, approval);
  return approval;
}

export async function loadApproval(
  cwd: string,
  id: string,
): Promise<ApprovalRequest | null> {
  try {
    const raw = await fs.readFile(getApprovalPath(cwd, id), "utf-8");
    return parse(raw) as ApprovalRequest;
  } catch (error) {
    if (isMissingFile(error)) {
      return null;
    }
    throw error;
  }
}

export async function saveApproval(
  cwd: string,
  approval: ApprovalRequest,
): Promise<void> {
  const filePath = getApprovalPath(cwd, approval.id);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, stringify(approval), "utf-8");
}

export async function listApprovals(
  cwd: string,
  filter?: ApprovalListFilter,
): Promise<ApprovalRequest[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(getApprovalDir(cwd));
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }

  const approvals = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".yaml"))
      .map((entry) => loadApproval(cwd, path.basename(entry, ".yaml"))),
  );

  return approvals
    .filter((approval): approval is ApprovalRequest => approval !== null)
    .filter((approval) => matchesFilter(approval, filter))
    .sort(
      (a, b) =>
        new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime(),
    );
}

export function validateStatus(value: string): ApprovalStatus {
  if (
    value === "pending"
    || value === "approved"
    || value === "rejected"
    || value === "consumed"
    || value === "expired"
  ) {
    return value;
  }

  throw new ValidationError(
    "Approval status must be one of pending, approved, rejected, consumed, or expired.",
  );
}

function createApprovalId(date: Date): string {
  const datePart = [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join("");
  const timePart = [
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
  const suffix = crypto.randomBytes(3).toString("hex");
  return `apr_${datePart}_${timePart}_${suffix}`;
}

function getApprovalDir(cwd: string): string {
  return path.join(cwd, APPROVAL_DIR);
}

function getApprovalPath(cwd: string, id: string): string {
  return path.join(getApprovalDir(cwd), `${id}.yaml`);
}

function isMissingFile(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function matchesFilter(
  approval: ApprovalRequest,
  filter: ApprovalListFilter | undefined,
): boolean {
  return (
    (!filter?.status || approval.status === filter.status) &&
    (!filter?.action || approval.action === filter.action)
  );
}

function pad(value: number): string {
  return value.toString().padStart(2, "0");
}
