import { describe, expect, it } from "vitest";
import {
  classifyCommand,
  classifySurfaceCommand,
  type CommandName,
} from "../src/safety/commands.js";

describe("command-level operation intent mapping", () => {
  it("maps init to the setup actions it can perform", () => {
    const plan = classifyCommand("init", { projectId: "demo-project" });

    expect(plan.command).toBe("init");
    expect(plan.intents.map((intent) => intent.id)).toEqual([
      "billing.audit",
      "billing.link",
      "apis.enable",
      "iam.role.grant",
    ]);
    expect(plan.intents.every((intent) => intent.projectId === "demo-project")).toBe(true);
    expect(plan.intents.filter((intent) => intent.requiresBudget).map((intent) => intent.id))
      .toEqual(["billing.link", "apis.enable"]);
  });

  it("maps secret delete as a destructive dry-run-capable command intent", () => {
    const plan = classifyCommand("secret:delete", {
      projectId: "demo-project",
      resource: "secret/API_KEY",
    });

    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0]).toMatchObject({
      id: "secret.delete",
      service: "secret-manager",
      action: "lifecycle",
      trustLevel: "L3",
      destructive: true,
      supportsDryRun: true,
      postVerify: true,
    });
  });

  it("maps budget enable-api as an explicit bootstrap exception", () => {
    const plan = classifyCommand("budget:enable-api", { projectId: "demo-project" });

    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0]).toMatchObject({
      id: "budget.enable-api",
      service: "service-usage",
      action: "write",
      trustLevel: "L1",
      requiresBudget: false,
      supportsDryRun: true,
    });
    expect(plan.notes).toContain("Budget API enablement is a bootstrap exception for budget visibility.");
  });

  it("maps IAM audit as a read-only command intent", () => {
    const plan = classifyCommand("iam:audit", { projectId: "demo-project" });

    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0]).toMatchObject({
      id: "iam.audit",
      service: "iam",
      action: "read",
      trustLevel: "L0",
      requiresBudget: false,
    });
  });

  it("maps security audit as a read-only command intent", () => {
    const plan = classifyCommand("security:audit", { projectId: "demo-project" });

    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0]).toMatchObject({
      id: "security.audit",
      service: "security",
      action: "read",
      trustLevel: "L0",
      requiresBudget: false,
    });
  });

  it("maps Firestore audit as a read-only command intent", () => {
    const plan = classifyCommand("firestore:audit", { projectId: "demo-project" });

    expect(plan.intents).toHaveLength(1);
    expect(plan.intents[0]).toMatchObject({
      id: "firestore.audit",
      service: "firestore",
      action: "read",
      trustLevel: "L0",
      requiresBudget: false,
    });
  });

  it("normalizes equivalent CLI and MCP surfaces to the same command plan", () => {
    expect(
      classifySurfaceCommand("cli", "deploy", {
        projectId: "demo-project",
        deployTarget: "cloud-run",
      }),
    ).toEqual(
      classifySurfaceCommand("mcp", "omg.deploy", {
        projectId: "demo-project",
        deployTarget: "cloud-run",
      }),
    );

    expect(
      classifySurfaceCommand("cli", "secret:set", {
        projectId: "demo-project",
        resource: "secret/API_KEY",
      }),
    ).toEqual(
      classifySurfaceCommand("mcp", "omg.secret.set", {
        projectId: "demo-project",
        resource: "secret/API_KEY",
      }),
    );

    expect(
      classifySurfaceCommand("cli", "iam:audit", {
        projectId: "demo-project",
      }),
    ).toEqual(
      classifySurfaceCommand("mcp", "omg.iam.audit", {
        projectId: "demo-project",
      }),
    );

    expect(
      classifySurfaceCommand("cli", "security:audit", {
        projectId: "demo-project",
      }),
    ).toEqual(
      classifySurfaceCommand("mcp", "omg.security.audit", {
        projectId: "demo-project",
      }),
    );

    expect(
      classifySurfaceCommand("cli", "firestore:audit", {
        projectId: "demo-project",
      }),
    ).toEqual(
      classifySurfaceCommand("mcp", "omg.firestore.audit", {
        projectId: "demo-project",
      }),
    );
  });

  it("keeps every cost-bearing command intent budget-gated", () => {
    const scenarios: Array<{
      command: CommandName;
      context?: Parameters<typeof classifyCommand>[1];
    }> = [
      { command: "auth:context" },
      { command: "auth:list" },
      { command: "budget:audit", context: { projectId: "demo-project" } },
      { command: "budget:enable-api", context: { projectId: "demo-project" } },
      { command: "deploy", context: { projectId: "demo-project", deployTarget: "cloud-run" } },
      { command: "deploy", context: { projectId: "demo-project", deployTarget: "firebase-hosting" } },
      { command: "doctor" },
      { command: "firebase:deploy", context: { projectId: "demo-project" } },
      { command: "firestore:audit", context: { projectId: "demo-project" } },
      { command: "iam:audit", context: { projectId: "demo-project" } },
      { command: "init", context: { projectId: "demo-project" } },
      { command: "link" },
      { command: "project:audit", context: { projectId: "demo-project" } },
      { command: "project:cleanup", context: { projectId: "demo-project" } },
      { command: "project:delete", context: { projectId: "demo-project" } },
      { command: "project:undelete", context: { projectId: "demo-project" } },
      { command: "secret:list", context: { projectId: "demo-project" } },
      { command: "secret:set", context: { projectId: "demo-project", resource: "secret/API_KEY" } },
      { command: "secret:delete", context: { projectId: "demo-project", resource: "secret/API_KEY" } },
      { command: "security:audit", context: { projectId: "demo-project" } },
    ];

    for (const scenario of scenarios) {
      const plan = classifyCommand(scenario.command, scenario.context ?? {});
      for (const intent of plan.intents) {
        if (intent.costBearing) {
          expect(intent.requiresBudget, `${scenario.command}:${intent.id} must require budget guard`)
            .toBe(true);
        }
      }
    }
  });
});
