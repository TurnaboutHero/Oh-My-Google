import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashArgs } from "../src/approval/hash.js";
import {
  createApproval,
  listApprovals,
  loadApproval,
  saveApproval,
} from "../src/approval/queue.js";
import type { ApprovalRequest } from "../src/approval/types.js";

describe("approval queue", () => {
  it("round-trips an approval through createApproval and loadApproval", async () => {
    const cwd = await tempDir();

    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: { service: "api", region: "asia-northeast3" },
      projectId: "demo-project",
      environment: "staging",
      requestedBy: "agent",
    });

    await expect(loadApproval(cwd, approval.id)).resolves.toEqual(approval);
  });

  it("uses requestedBy and ttlMinutes when creating an approval", async () => {
    const cwd = await tempDir();

    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: { service: "api" },
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "owner@example.com",
      ttlMinutes: 30,
    });

    expect(approval.requestedBy).toBe("owner@example.com");
    expect(minutesBetween(approval.requestedAt, approval.expiresAt)).toBeCloseTo(30, 3);
  });

  it("defaults approval TTL to 60 minutes", async () => {
    const cwd = await tempDir();

    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: { service: "api" },
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
    });

    expect(minutesBetween(approval.requestedAt, approval.expiresAt)).toBeCloseTo(60, 3);
  });

  it("creates approval ids with the expected UTC timestamp format", async () => {
    const cwd = await tempDir();

    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: {},
      projectId: "demo-project",
      environment: "staging",
      requestedBy: "agent",
    });

    expect(approval.id).toMatch(/^apr_\d{8}_\d{6}_[0-9a-f]{6}$/);
  });

  it("returns an empty list when the approval directory does not exist", async () => {
    const cwd = await tempDir();

    await expect(listApprovals(cwd)).resolves.toEqual([]);
  });

  it("filters approvals by status", async () => {
    const cwd = await tempDir();
    const first = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: { service: "api-1" },
      projectId: "demo-project",
      environment: "staging",
      requestedBy: "agent",
    });
    const second = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: { service: "api-2" },
      projectId: "demo-project",
      environment: "staging",
      requestedBy: "agent",
    });
    const approved: ApprovalRequest = {
      ...(await createApproval(cwd, {
        action: "deploy.cloud-run",
        args: { service: "api-3" },
        projectId: "demo-project",
        environment: "staging",
        requestedBy: "agent",
      })),
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
      reason: "ship it",
    };
    await saveApproval(cwd, approved);

    await expect(listApprovals(cwd, { status: "pending" })).resolves.toEqual([
      second,
      first,
    ]);
  });
});

describe("approval args hashing", () => {
  it("returns the same hash for objects with different key order", () => {
    expect(hashArgs({ a: 1, b: 2 })).toBe(hashArgs({ b: 2, a: 1 }));
  });

  it("returns different hashes when array order changes", () => {
    expect(hashArgs({ values: [1, 2] })).not.toBe(hashArgs({ values: [2, 1] }));
  });

  it("returns the same hash for nested objects with different key order", () => {
    expect(hashArgs({ x: { a: 1, b: 2 } })).toBe(
      hashArgs({ x: { b: 2, a: 1 } }),
    );
  });
});

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "omg-approval-"));
}

function minutesBetween(start: string, end: string): number {
  return (new Date(end).getTime() - new Date(start).getTime()) / 60_000;
}
