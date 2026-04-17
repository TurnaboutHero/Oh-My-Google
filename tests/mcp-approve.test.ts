import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadApproval, saveApproval } from "../src/approval/queue.js";
import type { ApprovalRequest } from "../src/approval/types.js";
import { handleApprove } from "../src/mcp/tools/approve.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("omg.approve MCP tool", () => {
  it("approves a pending approval", async () => {
    const cwd = await createTempWorkspace();
    const approval = await writeApproval(cwd, { id: "apr_pending" });

    const result = await withCwd(cwd, () =>
      handleApprove({ approvalId: approval.id, approver: "custom@test" }),
    );
    const stored = await loadApproval(cwd, approval.id);

    expect(result.ok).toBe(true);
    expect(result.data?.status).toBe("approved");
    expect(result.data?.approvedBy).toBe("custom@test");
    expect(result.next).toContain(`omg deploy --approval ${approval.id}`);
    expect(stored?.status).toBe("approved");
  });

  it("returns not found for a missing approval", async () => {
    const cwd = await createTempWorkspace();

    const result = await withCwd(cwd, () => handleApprove({ approvalId: "apr_missing" }));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_NOT_FOUND");
  });

  it("returns finalized status for already approved approvals", async () => {
    const cwd = await createTempWorkspace();
    const approval = await writeApproval(cwd, {
      id: "apr_approved",
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await withCwd(cwd, () => handleApprove({ approvalId: approval.id }));

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_ALREADY_FINALIZED");
    expect(result.data?.status).toBe("approved");
  });

  it("expires pending approvals that are past their expiration", async () => {
    const cwd = await createTempWorkspace();
    const approval = await writeApproval(cwd, {
      id: "apr_expired",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const result = await withCwd(cwd, () => handleApprove({ approvalId: approval.id }));
    const stored = await loadApproval(cwd, approval.id);

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_EXPIRED");
    expect(stored?.status).toBe("expired");
  });

  it("rejects missing approvalId", async () => {
    const result = await handleApprove({});

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("rejects non-string approvalId", async () => {
    const result = await handleApprove({ approvalId: 123 });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});

async function createTempWorkspace(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omg-mcp-approve-"));
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
