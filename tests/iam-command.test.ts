import { describe, expect, it, vi } from "vitest";
import {
  runIamAudit,
  runIamBootstrap,
  runIamPlan,
} from "../src/cli/commands/iam.js";

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

  it("plans separated agent IAM identities without applying grants", async () => {
    const result = await runIamPlan({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.ok ? result.data.status : undefined).toBe("review");
    expect(result.ok ? result.data.principals : undefined).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "auditor" }),
      expect.objectContaining({ key: "deployer" }),
      expect.objectContaining({ key: "secret-admin" }),
    ]));
    expect(result.ok ? result.next : undefined).toContain(
      "omg iam bootstrap --project demo-project --dry-run",
    );
  });

  it("keeps IAM bootstrap dry-run only", async () => {
    const withoutDryRun = await runIamBootstrap({ project: "demo-project" });

    expect(withoutDryRun.ok).toBe(false);
    expect(withoutDryRun.ok ? undefined : withoutDryRun.error.code).toBe("TRUST_REQUIRES_CONFIRM");

    const live = await runIamBootstrap({ project: "demo-project", yes: true });

    expect(live.ok).toBe(false);
    expect(live.ok ? undefined : live.error.code).toBe("IAM_BOOTSTRAP_LIVE_NOT_IMPLEMENTED");

    const dryRun = await runIamBootstrap({ project: "demo-project", dryRun: true });

    expect(dryRun.ok).toBe(true);
    expect(dryRun.ok ? dryRun.data.dryRun : undefined).toBe(true);
    expect(dryRun.ok ? dryRun.data.liveMutation : undefined).toBe(false);
  });
});
