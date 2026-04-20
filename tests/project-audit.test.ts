import { describe, expect, it } from "vitest";
import {
  auditProject,
  buildCleanupPlan,
  deleteProject,
  readProjectLifecycle,
  type ProjectAuditExecutor,
} from "../src/connectors/project-audit.js";
import * as projectAuditConnector from "../src/connectors/project-audit.js";

describe("project audit connector", () => {
  it("classifies unknown folder-backed projects without owner role as do-not-touch", async () => {
    const executor = fixtures({
      describe: {
        projectId: "quadratic-signifier-fmd0t",
        lifecycleState: "ACTIVE",
        parent: { type: "folder", id: "752156789244" },
      },
      billing: { billingEnabled: true, billingAccountName: "billingAccounts/014BB7-734838-D1BD80" },
      iamError: "caller does not have permission",
      servicesError: "Permission denied to list services",
      serviceAccounts: [
        {
          email: "express-mode@quadratic-signifier-fmd0t.iam.gserviceaccount.com",
          displayName: "",
        },
      ],
    });

    const audit = await auditProject("quadratic-signifier-fmd0t", executor);

    expect(audit.risk).toBe("do_not_touch");
    expect(audit.signals).toContain("Project belongs to folder 752156789244.");
    expect(audit.signals).toContain("Caller does not have IAM policy visibility.");
    expect(audit.signals).toContain("Billing is enabled.");
    expect(audit.signals).toContain("Service account present: express-mode@quadratic-signifier-fmd0t.iam.gserviceaccount.com");
    expect(audit.recommendedAction).toBe("Do not modify this project until ownership and billing responsibility are confirmed.");
  });

  it("classifies owner projects with disabled billing and no runtime surfaces as review-only", async () => {
    const executor = fixtures({
      describe: {
        projectId: "gen-lang-client-0379078037",
        name: "Gemini Project",
        lifecycleState: "ACTIVE",
      },
      billing: { billingEnabled: false, billingAccountName: "" },
      roles: ["roles/owner"],
      services: ["generativelanguage.googleapis.com"],
    });

    const audit = await auditProject("gen-lang-client-0379078037", executor);

    expect(audit.risk).toBe("review");
    expect(audit.enabledServices).toEqual(["generativelanguage.googleapis.com"]);
    expect(audit.recommendedAction).toBe("Review in Google Cloud Console before cleanup; no automated deletion is available.");
  });

  it("builds a dry-run cleanup plan and never includes destructive commands", async () => {
    const audit = await auditProject("citric-optics-380903", fixtures({
      describe: {
        projectId: "citric-optics-380903",
        name: "My Project 83385",
        lifecycleState: "ACTIVE",
      },
      billing: { billingEnabled: false, billingAccountName: "" },
      roles: ["roles/owner"],
      services: ["bigquery.googleapis.com", "gmail.googleapis.com"],
    }));

    const plan = buildCleanupPlan(audit);

    expect(plan.dryRun).toBe(true);
    expect(plan.allowedToExecute).toBe(false);
    expect(plan.steps).toContain("Review project ownership and enabled APIs in Google Cloud Console.");
    expect(JSON.stringify(plan)).not.toContain("projects delete");
    expect(JSON.stringify(plan)).not.toContain("services disable");
  });

  it("deletes a project and verifies delete requested state", async () => {
    const calls: string[][] = [];
    const executor: ProjectAuditExecutor = async (args) => {
      calls.push(args);
      if (args[0] === "projects" && args[1] === "delete") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "projects" && args[1] === "describe") {
        return {
          stdout: JSON.stringify({
            projectId: "citric-optics-380903",
            lifecycleState: "DELETE_REQUESTED",
          }),
          stderr: "",
        };
      }
      return { stdout: "{}", stderr: "" };
    };

    const result = await deleteProject("citric-optics-380903", executor);

    expect(calls[0]).toEqual(["projects", "delete", "citric-optics-380903", "--quiet"]);
    expect(result).toEqual({
      projectId: "citric-optics-380903",
      lifecycleState: "DELETE_REQUESTED",
    });
  });

  it("undeletes a project and verifies active state", async () => {
    const connector = projectAuditConnector as unknown as {
      undeleteProject?: (
        projectId: string,
        executor: ProjectAuditExecutor,
      ) => Promise<{ projectId: string; lifecycleState: string }>;
    };
    expect(connector.undeleteProject).toBeTypeOf("function");

    const calls: string[][] = [];
    const executor: ProjectAuditExecutor = async (args) => {
      calls.push(args);
      if (args[0] === "projects" && args[1] === "undelete") {
        return { stdout: "", stderr: "" };
      }
      if (args[0] === "projects" && args[1] === "describe") {
        return {
          stdout: JSON.stringify({
            projectId: "citric-optics-380903",
            lifecycleState: "ACTIVE",
          }),
          stderr: "",
        };
      }
      return { stdout: "{}", stderr: "" };
    };

    const result = await connector.undeleteProject!("citric-optics-380903", executor);

    expect(calls[0]).toEqual(["projects", "undelete", "citric-optics-380903", "--quiet"]);
    expect(result).toEqual({
      projectId: "citric-optics-380903",
      lifecycleState: "ACTIVE",
    });
  });

  it("maps project permission failures to a stable access-denied code", async () => {
    const executor: ProjectAuditExecutor = async () => {
      throw Object.assign(new Error("permission denied"), {
        stderr: "does not have permission to access projects instance",
        exitCode: 1,
      });
    };

    await expect(readProjectLifecycle("citric-optics-380903", executor)).rejects.toMatchObject({
      code: "PROJECT_ACCESS_DENIED",
      recoverable: true,
    });
  });
});

function fixtures(input: {
  describe: Record<string, unknown>;
  billing: Record<string, unknown>;
  roles?: string[];
  services?: string[];
  serviceAccounts?: Array<Record<string, unknown>>;
  iamError?: string;
  servicesError?: string;
}): ProjectAuditExecutor {
  return async (args) => {
    const key = args.slice(0, 3).join(" ");
    if (args[0] === "projects" && args[1] === "describe") {
      return { stdout: JSON.stringify(input.describe), stderr: "" };
    }
    if (key === "billing projects describe") {
      return { stdout: JSON.stringify(input.billing), stderr: "" };
    }
    if (args[0] === "projects" && args[1] === "get-iam-policy") {
      if (input.iamError) {
        throw Object.assign(new Error(input.iamError), { stderr: input.iamError, exitCode: 1 });
      }
      return {
        stdout: JSON.stringify((input.roles ?? []).map((role) => ({ bindings: { role } }))),
        stderr: "",
      };
    }
    if (key === "services list --enabled") {
      if (input.servicesError) {
        throw Object.assign(new Error(input.servicesError), { stderr: input.servicesError, exitCode: 1 });
      }
      return {
        stdout: JSON.stringify((input.services ?? []).map((name) => ({ config: { name } }))),
        stderr: "",
      };
    }
    if (key === "iam service-accounts list") {
      return { stdout: JSON.stringify(input.serviceAccounts ?? []), stderr: "" };
    }
    return { stdout: "[]", stderr: "" };
  };
}
