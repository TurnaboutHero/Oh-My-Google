import { describe, expect, it, vi } from "vitest";

const setupFixtures = vi.hoisted(() => ({
  context: {
    activeConfiguration: "default",
    gcloudAccount: "cli@example.com",
    projectId: "demo-project",
    adcAccount: null as string | null,
    configurations: [],
    accountContext: {
      ok: false,
      detail: "requires both gcloud and ADC accounts",
    },
  },
  doctor: {
    ok: true,
    checks: {},
    next: [] as string[],
  },
  commands: [] as string[][],
  savedConfig: null as unknown,
}));

vi.mock("../src/auth/gcloud-context.js", () => ({
  getGcloudContext: vi.fn(async () => setupFixtures.context),
  activateGcloudConfiguration: vi.fn(async (configuration: string) => {
    setupFixtures.commands.push(["activate", configuration]);
  }),
}));

vi.mock("../src/cli/doctor.js", () => ({
  runDoctor: vi.fn(async () => setupFixtures.doctor),
}));

vi.mock("../src/auth/auth-manager.js", () => ({
  AuthManager: {
    saveConfig: vi.fn(async (config: unknown) => {
      setupFixtures.savedConfig = config;
    }),
  },
}));

vi.mock("../src/system/cli-runner.js", () => ({
  execCliFile: vi.fn(async (command: string, args: string[]) => {
    setupFixtures.commands.push([command, ...args]);
    if (command === "gcloud" && args[0] === "--version") {
      return { stdout: "Google Cloud SDK 551.0.0\n", stderr: "" };
    }
    if (command === "firebase" && args[0] === "--version") {
      return { stdout: "13.0.0\n", stderr: "" };
    }
    return { stdout: "", stderr: "" };
  }),
}));

describe("setup command core", () => {
  it("aligns ADC when explicitly requested and runs doctor", async () => {
    const { runSetup } = await import("../src/cli/setup.js");

    const result = await runSetup({
      cwd: process.cwd(),
      projectId: "demo-project",
      alignAdc: true,
      interactive: false,
    });

    expect(result.ok).toBe(true);
    expect(setupFixtures.commands).toContainEqual([
      "gcloud",
      "auth",
      "application-default",
      "login",
    ]);
    expect(setupFixtures.savedConfig).toEqual({
      profile: {
        projectId: "demo-project",
        accountEmail: "cli@example.com",
      },
    });
    expect(result.ok ? result.data.doctor.ok : undefined).toBe(true);
  });

  it("switches configuration before resolving setup context", async () => {
    const { runSetup } = await import("../src/cli/setup.js");

    const result = await runSetup({
      cwd: process.cwd(),
      configuration: "main",
      projectId: "demo-project",
      interactive: false,
    });

    expect(result.ok).toBe(true);
    expect(setupFixtures.commands).toContainEqual(["activate", "main"]);
  });
});
