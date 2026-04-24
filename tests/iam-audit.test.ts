import { describe, expect, it } from "vitest";
import { auditIam, type IamAuditExecutor } from "../src/connectors/iam-audit.js";

describe("IAM audit connector", () => {
  it("summarizes IAM policy bindings and classifies public access as high risk", async () => {
    const audit = await auditIam("demo-project", fixtures({
      policy: {
        bindings: [
          {
            role: "roles/viewer",
            members: ["allUsers"],
          },
          {
            role: "roles/owner",
            members: ["user:owner@example.com"],
          },
        ],
      },
      serviceAccounts: [
        {
          email: "worker@demo-project.iam.gserviceaccount.com",
          displayName: "worker",
          disabled: false,
          uniqueId: "123",
        },
      ],
    }));

    expect(audit.risk).toBe("high");
    expect(audit.bindings).toEqual([
      {
        role: "roles/owner",
        members: ["user:owner@example.com"],
        memberCount: 1,
        public: false,
        primitive: true,
      },
      {
        role: "roles/viewer",
        members: ["allUsers"],
        memberCount: 1,
        public: true,
        primitive: false,
      },
    ]);
    expect(audit.serviceAccounts).toEqual([
      {
        email: "worker@demo-project.iam.gserviceaccount.com",
        displayName: "worker",
        disabled: false,
        uniqueId: "123",
      },
    ]);
    expect(audit.findings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        severity: "high",
        reason: "Public principal has an IAM binding.",
        role: "roles/viewer",
        member: "allUsers",
      }),
      expect.objectContaining({
        severity: "review",
        reason: "Primitive project role should be reviewed before adding IAM automation.",
        role: "roles/owner",
      }),
    ]));
  });

  it("returns an audit with inaccessible policy signals instead of performing writes", async () => {
    const audit = await auditIam("demo-project", fixtures({
      policyError: "caller does not have permission",
      serviceAccounts: [],
    }));

    expect(audit.risk).toBe("high");
    expect(audit.inaccessible).toContain("iam policy");
    expect(audit.bindings).toEqual([]);
    expect(audit.signals).toContain("Caller does not have IAM policy visibility.");
  });

  it("requires a valid project ID", async () => {
    await expect(auditIam("BAD_PROJECT", fixtures({ policy: {}, serviceAccounts: [] })))
      .rejects
      .toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("maps auth failures to NO_AUTH", async () => {
    const executor: IamAuditExecutor = async () => {
      throw Object.assign(new Error("no active account"), {
        stderr: "No active account selected.",
        exitCode: 1,
      });
    };

    await expect(auditIam("demo-project", executor)).rejects.toMatchObject({
      code: "NO_AUTH",
      recoverable: false,
    });
  });
});

function fixtures(input: {
  policy?: Record<string, unknown>;
  serviceAccounts: Array<Record<string, unknown>>;
  policyError?: string;
  serviceAccountsError?: string;
}): IamAuditExecutor {
  return async (args) => {
    if (args[0] === "projects" && args[1] === "get-iam-policy") {
      if (input.policyError) {
        throw Object.assign(new Error(input.policyError), {
          stderr: input.policyError,
          exitCode: 1,
        });
      }
      return { stdout: JSON.stringify(input.policy ?? {}), stderr: "" };
    }
    if (args[0] === "iam" && args[1] === "service-accounts" && args[2] === "list") {
      if (input.serviceAccountsError) {
        throw Object.assign(new Error(input.serviceAccountsError), {
          stderr: input.serviceAccountsError,
          exitCode: 1,
        });
      }
      return { stdout: JSON.stringify(input.serviceAccounts), stderr: "" };
    }
    return { stdout: "{}", stderr: "" };
  };
}
