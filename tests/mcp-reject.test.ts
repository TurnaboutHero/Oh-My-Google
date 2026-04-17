import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadApproval, saveApproval } from "../src/approval/queue.js";
import type { ApprovalRequest } from "../src/approval/types.js";
import { handleReject } from "../src/mcp/tools/reject.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("omg.reject MCP tool", () => {
  it("rejects a pending approval", async () => {
    const cwd = await createTempWorkspace();
    const approval = await writeApproval(cwd, { id: "apr_reject" });

    const result = await withCwd(cwd, () =>
      handleReject({ approvalId: approval.id, reason: "not safe", rejecter: "custom@test" }),
    );
    const stored = await loadApproval(cwd, approval.id);

    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe("rejected");
    expect(stored?.status).toBe("rejected");
    expect(stored?.reason).toBe("not safe");
  });

  it("returns not found for a missing approval", async () => {
    const cwd = await createTempWorkspace();

    const result = await withCwd(cwd, () => handleReject({ approvalId: "apr_missing" }));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_NOT_FOUND");
  });

  it("returns finalized status for already rejected approvals", async () => {
    const cwd = await createTempWorkspace();
    const approval = await writeApproval(cwd, {
      id: "apr_rejected",
      status: "rejected",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
      reason: "no",
    });

    const result = await withCwd(cwd, () => handleReject({ approvalId: approval.id }));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_ALREADY_FINALIZED");
    expect(result.data?.status).toBe("rejected");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-reject-"));
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
