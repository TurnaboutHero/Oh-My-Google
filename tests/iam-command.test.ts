import { describe, expect, it, vi } from "vitest";
import { runIamAudit } from "../src/cli/commands/iam.js";

vi.mock("../src/connectors/iam-audit.js", () => ({
  auditIam: vi.fn(async (projectId: string) => ({
    projectId,
    bindings: [
      {
        role: "roles/owner",
        members: ["user:owner@example.com"],
        memberCount: 1,
        public: false,
        primitive: true,
      },
    ],
    serviceAccounts: [],
    findings: [
      {
        severity: "review",
        reason: "Primitive project role should be reviewed before adding IAM automation.",
        role: "roles/owner",
      },
    ],
    inaccessible: [],
    signals: ["Primitive project role should be reviewed before adding IAM automation. Role: roles/owner."],
    risk: "review",
    recommendedAction: "Review privileged IAM bindings and service accounts before adding IAM writes.",
  })),
}));

describe("iam command", () => {
  it("runs a read-only IAM audit", async () => {
    const result = await runIamAudit({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.risk : undefined).toBe("review");
    expect(result.ok ? result.next : undefined).toContain(
      "Review privileged IAM bindings before adding IAM write automation.",
    );
  });

  it("requires a project id", async () => {
    const result = await runIamAudit({});

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("VALIDATION_ERROR");
  });
});
