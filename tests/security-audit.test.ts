import { describe, expect, it } from "vitest";
import { auditSecurity } from "../src/connectors/security-audit.js";
import type { BillingGuardAudit } from "../src/connectors/billing-audit.js";
import type { IamAudit } from "../src/connectors/iam-audit.js";
import type { ProjectAudit } from "../src/connectors/project-audit.js";
import { OmgError } from "../src/types/errors.js";

describe("security audit connector", () => {
  it("combines project, IAM, and budget audit signals into a high-risk posture", async () => {
    const audit = await auditSecurity("demo-project", {
      projectAudit: async () => ({
        ...baseProjectAudit(),
        risk: "review",
        signals: ["Billing is enabled."],
      }),
      iamAudit: async () => ({
        ...baseIamAudit(),
        risk: "high",
        findings: [
          {
            severity: "high",
            reason: "Public principal has an IAM binding.",
            role: "roles/viewer",
            member: "allUsers",
          },
        ],
        signals: ["Public principal has an IAM binding. Role: roles/viewer. Member: allUsers."],
      }),
      budgetAudit: async () => baseBudgetAudit(),
    });

    expect(audit.risk).toBe("high");
    expect(audit.sections.project.risk).toBe("review");
    expect(audit.sections.iam.summary?.highFindingCount).toBe(1);
    expect(audit.signals).toContain("Project: Billing is enabled.");
    expect(audit.signals).toContain("IAM: Public principal has an IAM binding. Role: roles/viewer. Member: allUsers.");
  });

  it("treats missing budgets and section errors as review posture", async () => {
    const audit = await auditSecurity("demo-project", {
      projectAudit: async () => baseProjectAudit(),
      iamAudit: async () => baseIamAudit(),
      budgetAudit: async () => {
        throw new OmgError("Billing information could not be accessed.", "NO_BILLING", true);
      },
    });

    expect(audit.risk).toBe("review");
    expect(audit.sections.budget.ok).toBe(false);
    expect(audit.sections.budget.error).toEqual({
      code: "NO_BILLING",
      message: "Billing information could not be accessed.",
      recoverable: true,
    });
    expect(audit.signals).toContain("Budget: Audit section failed: NO_BILLING.");
  });

  it("stays low when all read-only sections are low risk", async () => {
    const audit = await auditSecurity("demo-project", {
      projectAudit: async () => baseProjectAudit(),
      iamAudit: async () => baseIamAudit(),
      budgetAudit: async () => ({
        ...baseBudgetAudit(),
        risk: "billing_disabled",
        signals: ["Billing is disabled."],
      }),
    });

    expect(audit.risk).toBe("low");
    expect(audit.recommendedAction).toBe("No broad security posture risk signals were detected.");
  });

  it("requires a valid project ID", async () => {
    await expect(auditSecurity("BAD_PROJECT")).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });
});

function baseProjectAudit(): ProjectAudit {
  return {
    projectId: "demo-project",
    lifecycleState: "ACTIVE",
    billingEnabled: false,
    callerRoles: ["roles/owner"],
    enabledServices: [],
    serviceAccounts: [],
    inaccessible: [],
    signals: [],
    risk: "low",
    recommendedAction: "Review in Google Cloud Console before cleanup; no automated deletion is available.",
  };
}

function baseIamAudit(): IamAudit {
  return {
    projectId: "demo-project",
    bindings: [],
    serviceAccounts: [],
    findings: [],
    inaccessible: [],
    signals: [],
    risk: "low",
    recommendedAction: "No broad IAM risk signals were detected.",
  };
}

function baseBudgetAudit(): BillingGuardAudit {
  return {
    projectId: "demo-project",
    billingEnabled: true,
    billingAccountId: "ABC-123",
    budgets: [
      {
        name: "billingAccounts/ABC-123/budgets/budget-1",
        displayName: "Monthly cap",
        thresholdPercents: [0.5, 0.9, 1],
      },
    ],
    signals: ["Budget configured: Monthly cap."],
    risk: "configured",
    recommendedAction: "Budget guard is configured for this billing account.",
  };
}
