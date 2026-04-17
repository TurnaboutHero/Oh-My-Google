import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hashArgs } from "../src/approval/hash.js";
import {
  createApproval,
  loadApproval,
  saveApproval,
} from "../src/approval/queue.js";
import { checkPermission } from "../src/trust/check.js";
import { generateDefaultProfile } from "../src/trust/profile.js";

describe("trust approval checks", () => {
  it("requires an approval id for require_approval actions", async () => {
    const cwd = await tempDir();
    const profile = generateDefaultProfile("demo-project", "prod");

    const result = await checkPermission("deploy.cloud-run", profile, { cwd });

    expect(result.allowed).toBe(false);
    expect(result.action).toBe("require_approval");
    expect(result.reasonCode).toBe("APPROVAL_REQUIRED");
  });

  it("rejects missing approval files", async () => {
    const cwd = await tempDir();
    const profile = generateDefaultProfile("demo-project", "prod");

    const result = await checkPermission("deploy.cloud-run", profile, {
      approvalId: "apr_missing",
      cwd,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("APPROVAL_NOT_FOUND");
    expect(result.approvalId).toBe("apr_missing");
  });

  it("rejects approvals that are not approved yet", async () => {
    const cwd = await tempDir();
    const profile = generateDefaultProfile("demo-project", "prod");
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: { service: "api" },
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
    });

    const result = await checkPermission("deploy.cloud-run", profile, {
      approvalId: approval.id,
      cwd,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("APPROVAL_NOT_APPROVED");
    expect(result.approvalId).toBe(approval.id);
  });

  it("rejects approvals for a different action", async () => {
    const cwd = await tempDir();
    const profile = generateDefaultProfile("demo-project", "prod");
    const approval = await createApproval(cwd, {
      action: "deploy.firebase-hosting",
      args: { service: "api" },
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
    });
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await checkPermission("deploy.cloud-run", profile, {
      approvalId: approval.id,
      cwd,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("APPROVAL_MISMATCH");
    expect(result.approvalId).toBe(approval.id);
  });

  it("rejects approvals with a different args hash", async () => {
    const cwd = await tempDir();
    const profile = generateDefaultProfile("demo-project", "prod");
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: { service: "api" },
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
    });
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await checkPermission("deploy.cloud-run", profile, {
      approvalId: approval.id,
      argsHash: hashArgs({ service: "worker" }),
      cwd,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("APPROVAL_MISMATCH");
    expect(result.approvalId).toBe(approval.id);
  });

  it("expires approved approvals after their expiry time", async () => {
    const cwd = await tempDir();
    const profile = generateDefaultProfile("demo-project", "prod");
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: { service: "api" },
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
      ttlMinutes: -1,
    });
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await checkPermission("deploy.cloud-run", profile, {
      approvalId: approval.id,
      cwd,
    });
    const saved = await loadApproval(cwd, approval.id);

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("APPROVAL_EXPIRED");
    expect(result.approvalId).toBe(approval.id);
    expect(saved?.status).toBe("expired");
  });

  it("consumes approved approvals when all checks pass", async () => {
    const cwd = await tempDir();
    const profile = generateDefaultProfile("demo-project", "prod");
    const args = { service: "api" };
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args,
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
    });
    await saveApproval(cwd, {
      ...approval,
      status: "approved",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await checkPermission("deploy.cloud-run", profile, {
      approvalId: approval.id,
      argsHash: hashArgs(args),
      cwd,
    });
    const saved = await loadApproval(cwd, approval.id);

    expect(result.allowed).toBe(true);
    expect(result.action).toBe("require_approval");
    expect(saved?.status).toBe("consumed");
  });

  it("rejects consumed approvals", async () => {
    const cwd = await tempDir();
    const profile = generateDefaultProfile("demo-project", "prod");
    const approval = await createApproval(cwd, {
      action: "deploy.cloud-run",
      args: { service: "api" },
      projectId: "demo-project",
      environment: "prod",
      requestedBy: "agent",
    });
    await saveApproval(cwd, {
      ...approval,
      status: "consumed",
      approvedBy: "owner@example.com",
      approvedAt: new Date().toISOString(),
    });

    const result = await checkPermission("deploy.cloud-run", profile, {
      approvalId: approval.id,
      cwd,
    });

    expect(result.allowed).toBe(false);
    expect(result.reasonCode).toBe("APPROVAL_CONSUMED");
    expect(result.approvalId).toBe(approval.id);
  });
});

async function tempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "omg-trust-approval-"));
}
