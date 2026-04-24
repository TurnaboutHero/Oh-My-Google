import { describe, expect, it, vi } from "vitest";
import { handleIamAudit } from "../src/mcp/tools/iam.js";

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
});
