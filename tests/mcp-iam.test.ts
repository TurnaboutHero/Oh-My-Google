import { describe, expect, it, vi } from "vitest";
import {
  handleIamAudit,
  handleIamBootstrap,
  handleIamPlan,
} from "../src/mcp/tools/iam.js";

vi.mock("../src/cli/commands/iam.js", () => ({
  runIamAudit: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      bindings: [],
      serviceAccounts: [],
      findings: [],
      inaccessible: [],
      signals: [],
      risk: "low",
      recommendedAction: "No broad IAM risk signals were detected.",
    },
    next: [],
  })),
  runIamPlan: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      status: "review",
      principals: [{ key: "auditor" }],
    },
    next: ["omg iam bootstrap --project demo-project --dry-run"],
  })),
  runIamBootstrap: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      dryRun: true,
      liveMutation: false,
      status: "review",
    },
    next: ["Review manual IAM grant actions."],
  })),
}));

describe("omg.iam MCP tools", () => {
  it("returns IAM audit output", async () => {
    const result = await handleIamAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("iam:audit");
    expect(result.data?.risk).toBe("low");
  });

  it("rejects unknown arguments", async () => {
    const result = await handleIamAudit({ project: "demo-project", nope: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });

  it("returns IAM plan output", async () => {
    const result = await handleIamPlan({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("iam:plan");
    expect(result.data?.status).toBe("review");
  });

  it("returns IAM bootstrap dry-run output", async () => {
    const result = await handleIamBootstrap({ project: "demo-project", dryRun: true });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("iam:bootstrap");
    expect(result.data?.liveMutation).toBe(false);
  });
});
