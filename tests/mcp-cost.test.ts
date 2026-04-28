import { describe, expect, it, vi } from "vitest";
import {
  handleCostLock,
  handleCostStatus,
  handleCostUnlock,
} from "../src/mcp/tools/cost.js";

vi.mock("../src/cli/commands/cost.js", () => ({
  runCostStatus: vi.fn(async () => ({
    ok: true,
    data: {
      locked: false,
      locks: [],
    },
    next: [],
  })),
  runCostLock: vi.fn(async () => ({
    ok: true,
    data: {
      locked: true,
      changed: true,
      lock: {
        projectId: "demo-project",
        reason: "budget alert",
      },
    },
    next: ["omg cost status --project demo-project"],
  })),
  runCostUnlock: vi.fn(async () => ({
    ok: false,
    error: {
      code: "TRUST_REQUIRES_CONFIRM",
      message: "Cost unlock requires explicit --yes.",
      recoverable: true,
      hint: "--yes",
      data: {
        projectId: "demo-project",
        localOnly: true,
      },
      next: ["omg cost unlock --project demo-project --yes"],
    },
  })),
}));

describe("omg.cost MCP tools", () => {
  it("returns cost lock status", async () => {
    const result = await handleCostStatus({ project: "demo-project" });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("cost:status");
    expect(result.data?.locked).toBe(false);
  });

  it("records local cost lock output", async () => {
    const result = await handleCostLock({
      project: "demo-project",
      reason: "budget alert",
      lockedBy: "agent",
    });

    expect(result.ok).toBe(true);
    expect(result.command).toBe("cost:lock");
    expect(result.data?.locked).toBe(true);
  });

  it("preserves unlock confirmation gate", async () => {
    const result = await handleCostUnlock({ project: "demo-project" });

    expect(result.ok).toBe(false);
    expect(result.command).toBe("cost:unlock");
    expect(result.error?.code).toBe("TRUST_REQUIRES_CONFIRM");
  });

  it("validates cost lock arguments", async () => {
    const result = await handleCostLock({ project: "demo-project" });

    expect(result.ok).toBe(false);
    expect(result.command).toBe("cost:lock");
    expect(result.error?.code).toBe("VALIDATION_ERROR");
  });
});
