import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { saveApproval } from "../src/approval/queue.js";
import type { ApprovalRequest } from "../src/approval/types.js";
import { handleApprovalsList } from "../src/mcp/tools/approvals-list.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("omg.approvals.list MCP tool", () => {
  it("filters approvals by pending status", async () => {
    const cwd = await createTempWorkspace();
    await writeApproval(cwd, { id: "apr_pending_1" });
    await writeApproval(cwd, { id: "apr_pending_2" });
    await writeApproval(cwd, {
      id: "apr_approved_1",
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await withCwd(cwd, () => handleApprovalsList({ status: "pending" }));
    const approvals = result.data?.approvals as ApprovalRequest[];

    expect(result.ok).toBe(true);
    expect(approvals).toHaveLength(2);
    expect(approvals.map((approval) => approval.status)).toEqual(["pending", "pending"]);
  });

  it("returns invalid status errors in omg response shape", async () => {
    const result = await handleApprovalsList({ status: "weird" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("INVALID_STATUS");
  });

  it("returns all approvals without filters", async () => {
    const cwd = await createTempWorkspace();
    await writeApproval(cwd, { id: "apr_pending_1" });
    await writeApproval(cwd, { id: "apr_pending_2" });
    await writeApproval(cwd, {
      id: "apr_approved_1",
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await withCwd(cwd, () => handleApprovalsList({}));
    const approvals = result.data?.approvals as ApprovalRequest[];

    expect(result.ok).toBe(true);
    expect(approvals).toHaveLength(3);
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-approvals-"));
  tempDirs.push(dir);
  return dir;
}

async function writeApproval(
  cwd: string,
  overrides: Partial<ApprovalRequest>,
): Promise<ApprovalRequest> {
  const now = new Date();
  const approval: ApprovalRequest = {
    id: "apr_test",
    action: "deploy.cloud-run",
    argsHash: "hash",
    projectId: "demo-project",
    environment: "prod",
    requestedBy: "agent",
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60 * 60_000).toISOString(),
    status: "pending",
    approvedBy: null,
    approvedAt: null,
    reason: null,
    ...overrides,
  };

  await saveApproval(cwd, approval);
  return approval;
}

async function withCwd<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const originalCwd = process.cwd;
  process.cwd = (() => cwd) as typeof process.cwd;

  try {
    return await fn();
  } finally {
    process.cwd = originalCwd;
  }
}
