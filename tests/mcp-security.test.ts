import { describe, expect, it, vi } from "vitest";
import { handleSecurityAudit } from "../src/mcp/tools/security.js";

vi.mock("../src/cli/commands/security.js", () => ({
  runSecurityAudit: vi.fn(async () => ({
    ok: true,
    data: {
      projectId: "demo-project",
      sections: {
        project: { ok: true, risk: "low", signals: [], summary: {} },
        iam: { ok: true, risk: "low", signals: [], summary: {} },
        budget: { ok: true, risk: "configured", signals: [], summary: {} },
      },
      signals: [],
      risk: "low",
      recommendedAction: "No broad security posture risk signals were detected.",
    },
    next: [],
  })),
}));

describe("omg.security MCP tools", () => {
  it("returns security audit output", async () => {
    const result = await handleSecurityAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("security:audit");
    expect(result.data?.risk).toBe("low");
  });

  it("rejects unknown arguments", async () => {
    const result = await handleSecurityAudit({ project: "demo-project", nope: true });

    expect(result.ok).toBe(false);
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
