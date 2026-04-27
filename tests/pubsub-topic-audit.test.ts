import { describe, expect, it } from "vitest";
import { auditPubsubTopic, type PubsubTopicAuditExecutor } from "../src/connectors/pubsub-topic-audit.js";

describe("Pub/Sub topic audit connector", () => {
  it("reports low risk when topic and Publisher binding are visible", async () => {
    const calls: string[][] = [];
    const audit = await auditPubsubTopic("projects/demo-project/topics/budget-alerts", async (args) => {
      calls.push(args);
      if (args[0] === "pubsub" && args[1] === "topics" && args[2] === "describe") {
        return { stdout: JSON.stringify({ name: "projects/demo-project/topics/budget-alerts" }), stderr: "" };
      }
      if (args[0] === "pubsub" && args[1] === "topics" && args[2] === "get-iam-policy") {
        return {
          stdout: JSON.stringify({
            bindings: [
              {
                role: "roles/pubsub.publisher",
                members: ["serviceAccount:billing-budget-alert@system.gserviceaccount.com"],
              },
            ],
          }),
          stderr: "",
        };
      }
      return { stdout: "{}", stderr: "" };
    });

    expect(calls).toEqual([
      ["pubsub", "topics", "describe", "budget-alerts", "--project=demo-project", "--format=json"],
      ["pubsub", "topics", "get-iam-policy", "budget-alerts", "--project=demo-project", "--format=json"],
    ]);
    expect(audit).toMatchObject({
      projectId: "demo-project",
      topicId: "budget-alerts",
      name: "projects/demo-project/topics/budget-alerts",
      topicStatus: "visible",
      iamStatus: "visible",
      publisherBindingStatus: "present",
      publisherMembers: ["serviceAccount:billing-budget-alert@system.gserviceaccount.com"],
      risk: "low",
    });
  });

  it("reports missing_topic when the topic is not found", async () => {
    const audit = await auditPubsubTopic("projects/demo-project/topics/missing-topic", fixtures({
      describeError: "Resource not found",
    }));

    expect(audit).toMatchObject({
      topicStatus: "missing",
      iamStatus: "not_checked",
      publisherBindingStatus: "not_checked",
      risk: "missing_topic",
    });
  });

  it("reports missing_publisher when topic IAM has no Publisher binding", async () => {
    const audit = await auditPubsubTopic("projects/demo-project/topics/budget-alerts", fixtures({
      policy: {
        bindings: [
          { role: "roles/pubsub.viewer", members: ["user:owner@example.com"] },
        ],
      },
    }));

    expect(audit).toMatchObject({
      topicStatus: "visible",
      iamStatus: "visible",
      publisherBindingStatus: "missing",
      publisherMembers: [],
      risk: "missing_publisher",
    });
  });

  it("keeps topic audit usable when topic IAM is inaccessible", async () => {
    const audit = await auditPubsubTopic("projects/demo-project/topics/budget-alerts", fixtures({
      iamError: "permission denied",
    }));

    expect(audit).toMatchObject({
      topicStatus: "visible",
      iamStatus: "inaccessible",
      risk: "review",
      inaccessible: ["pubsub topic iam:projects/demo-project/topics/budget-alerts"],
    });
  });

  it("requires a full Pub/Sub topic resource name", async () => {
    await expect(auditPubsubTopic("budget-alerts", fixtures({})))
      .rejects
      .toMatchObject({ code: "VALIDATION_ERROR" });
  });
});

function fixtures(input: {
  describeError?: string;
  iamError?: string;
  policy?: Record<string, unknown>;
}): PubsubTopicAuditExecutor {
  return async (args) => {
    if (args[0] === "pubsub" && args[1] === "topics" && args[2] === "describe") {
      if (input.describeError) {
        throw Object.assign(new Error(input.describeError), {
          stderr: input.describeError,
          exitCode: 1,
        });
      }
      return { stdout: JSON.stringify({ name: "projects/demo-project/topics/budget-alerts" }), stderr: "" };
    }
    if (args[0] === "pubsub" && args[1] === "topics" && args[2] === "get-iam-policy") {
      if (input.iamError) {
        throw Object.assign(new Error(input.iamError), {
          stderr: input.iamError,
          exitCode: 1,
        });
      }
      return { stdout: JSON.stringify(input.policy ?? { bindings: [] }), stderr: "" };
    }
    return { stdout: "{}", stderr: "" };
  };
}
