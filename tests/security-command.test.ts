import { describe, expect, it, vi } from "vitest";
import { runSecurityAudit } from "../src/cli/commands/security.js";

vi.mock("../src/connectors/security-audit.js", () => ({
  auditSecurity: vi.fn(async (projectId: string) => ({
    projectId,
    sections: {
      project: { ok: true, risk: "low", signals: [], summary: {} },
      iam: { ok: true, risk: "review", signals: ["Primitive role present."], summary: { findingCount: 1 } },
      budget: { ok: true, risk: "configured", signals: ["Budget configured."], summary: { budgetCount: 1 } },
    },
    signals: ["IAM: Primitive role present.", "Budget: Budget configured."],
    risk: "review",
    recommendedAction: "Review security audit findings before adding new live operations.",
  })),
}));

describe("security command", () => {
  it("runs a read-only security audit", async () => {
    const result = await runSecurityAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.risk : undefined).toBe("review");
    expect(result.ok ? result.next : undefined).toContain(
      "Review security audit findings before adding new live operations.",
    );
  });

  it("requires a project id", async () => {
    const result = await runSecurityAudit({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("VALIDATION_ERROR");
  });
});
