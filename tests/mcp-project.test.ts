import { describe, expect, it, vi } from "vitest";
import { handleProjectAudit, handleProjectCleanup } from "../src/mcp/tools/project.js";

vi.mock("../src/connectors/project-audit.js", () => ({
  auditProject: vi.fn(async (projectId: string) => ({
    projectId,
    lifecycleState: "DELETE_REQUESTED",
    risk: projectId === "quadratic-signifier-fmd0t" ? "do_not_touch" : "review",
    callerRoles: ["roles/owner"],
    billingEnabled: false,
    signals: ["Billing is enabled."],
    recommendedAction: "Do not modify this project until ownership and billing responsibility are confirmed.",
  })),
  buildCleanupPlan: vi.fn((audit: { projectId: string; risk: string }) => ({
    projectId: audit.projectId,
    dryRun: true,
    allowedToExecute: false,
    risk: audit.risk,
    steps: ["Review project ownership and enabled APIs in Google Cloud Console."],
    next: ["No automated cleanup command is available."],
  })),
  deleteProject: vi.fn(async (projectId: string) => ({
    projectId,
    lifecycleState: "DELETE_REQUESTED",
  })),
  readProjectLifecycle: vi.fn(async (projectId: string) => ({
    projectId,
    lifecycleState: "DELETE_REQUESTED",
  })),
  undeleteProject: vi.fn(async (projectId: string) => ({
    projectId,
    lifecycleState: "ACTIVE",
  })),
  readActiveGcloudAccount: vi.fn(async () => "owner@example.com"),
}));

describe("omg.project MCP tools", () => {
  it("returns project audit output", async () => {
    const result = await handleProjectAudit({ project: "quadratic-signifier-fmd0t" });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("project:audit");
    expect(result.data?.risk).toBe("do_not_touch");
  });

  it("returns dry-run cleanup plan only", async () => {
    const result = await handleProjectCleanup({ project: "citric-optics-380903", dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("project:cleanup");
    expect(result.data?.allowedToExecute).toBe(false);
  });

  it("rejects cleanup calls without dryRun", async () => {
    const result = await handleProjectCleanup({ project: "citric-optics-380903" });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("returns validation errors for unknown arguments", async () => {
    const result = await handleProjectAudit({ project: "citric-optics-380903", nope: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("requires approval for project deletion", async () => {
    const { handleProjectDelete } = await import("../src/mcp/tools/project.js");

    const result = await handleProjectDelete({
      project: "citric-optics-380903",
      expectAccount: "owner@example.com",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_REQUIRED");
    expect(result.data?.approvalId).toBeDefined();
    expect(result.data?.expectedAccount).toBe("owner@example.com");
  });

  it("blocks project deletion when expected account does not match active account", async () => {
    const { handleProjectDelete } = await import("../src/mcp/tools/project.js");

    const result = await handleProjectDelete({
      project: "citric-optics-380903",
      expectAccount: "other@example.com",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ACCOUNT_MISMATCH");
  });

  it("requires approval for project undeletion", async () => {
    const projectTools = await import("../src/mcp/tools/project.js") as unknown as {
      handleProjectUndelete?: (args: unknown) => Promise<{
        ok: boolean;
        error?: { code: string };
        data?: Record<string, unknown>;
      }>;
    };
    expect(projectTools.handleProjectUndelete).toBeTypeOf("function");

    const result = await projectTools.handleProjectUndelete!({
      project: "citric-optics-380903",
      expectAccount: "owner@example.com",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("APPROVAL_REQUIRED");
    expect(result.data?.approvalId).toBeDefined();
    expect(result.data?.expectedAccount).toBe("owner@example.com");
  });

  it("blocks project undeletion when expected account does not match active account", async () => {
    const projectTools = await import("../src/mcp/tools/project.js") as unknown as {
      handleProjectUndelete?: (args: unknown) => Promise<{
        ok: boolean;
        error?: { code: string };
      }>;
    };
    expect(projectTools.handleProjectUndelete).toBeTypeOf("function");

    const result = await projectTools.handleProjectUndelete!({
      project: "citric-optics-380903",
      expectAccount: "other@example.com",
    });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("ACCOUNT_MISMATCH");
  });
});
