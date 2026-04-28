import { describe, expect, it } from "vitest";
import { planAgentIam } from "../src/iam/agent-plan.js";
import type { IamAudit } from "../src/connectors/iam-audit.js";

describe("agent IAM plan", () => {
  it("plans separated auditor, deployer, and secret admin identities", () => {
    const plan = planAgentIam(auditFixture({
      serviceAccounts: [
        {
          email: "omg-agent-auditor@demo-project.iam.gserviceaccount.com",
          displayName: "omg read-only auditor",
        },
      ],
      bindings: [
        {
          role: "roles/viewer",
          members: ["serviceAccount:omg-agent-auditor@demo-project.iam.gserviceaccount.com"],
          memberCount: 1,
          public: false,
          primitive: false,
        },
      ],
    }));

    expect(plan.status).toBe("review");
    expect(plan.blocked).toBe(false);
    expect(plan.principals.map((principal) => principal.key)).toEqual([
      "auditor",
      "deployer",
      "secret-admin",
    ]);
    expect(plan.principals[0]).toMatchObject({
      key: "auditor",
      serviceAccountExists: true,
      email: "omg-agent-auditor@demo-project.iam.gserviceaccount.com",
    });
    expect(plan.principals[0].grants).toEqual(expect.arrayContaining([
      expect.objectContaining({
        role: "roles/viewer",
        status: "present",
      }),
      expect.objectContaining({
        role: "roles/iam.securityReviewer",
        status: "missing",
      }),
    ]));
    expect(plan.principals[1]).toMatchObject({
      key: "deployer",
      serviceAccountExists: false,
    });
    expect(plan.manualActions.map((action) => action.category)).toContain("runtime-service-account-user");
  });

  it("blocks bootstrap planning when IAM policy visibility is unsafe", () => {
    const plan = planAgentIam(auditFixture({
      risk: "high",
      inaccessible: ["iam policy"],
      findings: [
        {
          severity: "high",
          reason: "Caller does not have IAM policy visibility.",
        },
      ],
    }));

    expect(plan.status).toBe("blocked");
    expect(plan.blockers).toContain("IAM policy is not visible; cannot compare proposed grants against current bindings.");
    expect(plan.next).toEqual(["omg iam audit --project demo-project"]);
  });

  it("validates agent IAM prefixes before generating service account IDs", () => {
    expect(() => planAgentIam(auditFixture({}), { prefix: "BAD_PREFIX" }))
      .toThrow("Agent IAM prefix must be 3-17 lowercase letters, numbers, or hyphens.");
  });
});

function auditFixture(input: Partial<IamAudit>): IamAudit {
  return {
    projectId: "demo-project",
    bindings: [],
    serviceAccounts: [],
    findings: [],
    inaccessible: [],
    signals: [],
    risk: "low",
    recommendedAction: "No broad IAM risk signals were detected.",
    ...input,
  };
}
