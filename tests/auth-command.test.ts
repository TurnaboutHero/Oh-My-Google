import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runAuthContext,
  runAuthCreate,
  runAuthList,
  runAuthProject,
  runAuthSwitch,
} from "../src/cli/auth.js";

const authFixtures = vi.hoisted(() => ({
  context: {
    activeConfiguration: "default",
    gcloudAccount: "default@example.com" as string | null,
    projectId: "default-project" as string | null,
    adcAccount: null as string | null,
    configurations: [
      {
        name: "default",
        isActive: true,
        account: "default@example.com",
        project: "default-project",
      },
      {
        name: "main",
        isActive: false,
        account: "main@example.com",
        project: "main-project",
      },
    ],
    accountContext: {
      ok: false,
      detail: "requires both gcloud and ADC accounts",
    },
  },
  projects: [] as Array<{ projectId: string; name: string }>,
  accounts: [
    { email: "default@example.com", active: false },
    { email: "main@example.com", active: true },
  ],
}));

vi.mock("../src/auth/gcloud-context.js", () => ({
  getGcloudContext: vi.fn(async () => authFixtures.context),
  activateGcloudConfiguration: vi.fn(async () => undefined),
  createGcloudConfiguration: vi.fn(async (configuration: string) => {
    void configuration;
  }),
  setGcloudConfigurationValue: vi.fn(async (key: string, value: string) => {
    void key;
    void value;
  }),
  runGcloudAuthLogin: vi.fn(async (account?: string) => {
    void account;
  }),
  runGcloudAdcLogin: vi.fn(async () => undefined),
  listGcloudProjects: vi.fn(async () => authFixtures.projects),
  listGcloudAuthAccounts: vi.fn(async () => authFixtures.accounts),
}));

afterEach(() => {
  vi.clearAllMocks();
  authFixtures.context = {
    activeConfiguration: "default",
    gcloudAccount: "default@example.com",
    projectId: "default-project",
    adcAccount: null,
    configurations: [
      {
        name: "default",
        isActive: true,
        account: "default@example.com",
        project: "default-project",
      },
      {
        name: "main",
        isActive: false,
        account: "main@example.com",
        project: "main-project",
      },
    ],
    accountContext: {
      ok: false,
      detail: "requires both gcloud and ADC accounts",
    },
  };
  authFixtures.projects = [];
  authFixtures.accounts = [
    { email: "default@example.com", active: false },
    { email: "main@example.com", active: true },
  ];
});

describe("auth command core", () => {
  it("returns the current gcloud account context", async () => {
    const result = await runAuthContext();

    expect(result.ok).toBe(true);
    expect(result.data.activeConfiguration).toBe("default");
    expect(result.data.gcloudAccount).toBe("default@example.com");
    expect(result.data.configurations).toHaveLength(2);
    expect(result.next).toContain("gcloud auth application-default login");
  });

  it("lists credentialed accounts and configurations", async () => {
    const result = await runAuthList();

    expect(result.ok).toBe(true);
    expect(result.command).toBe("auth:list");
    expect(result.data.accounts).toEqual(authFixtures.accounts);
    expect(result.data.configurations).toHaveLength(2);
    expect(result.data.adcAccount).toBeNull();
  });

  it("switches gcloud configuration and returns the new context", async () => {
    const gcloudContext = await import("../src/auth/gcloud-context.js");

    const result = await runAuthSwitch({ configuration: "main" });

    expect(result.ok).toBe(true);
    expect(gcloudContext.activateGcloudConfiguration).toHaveBeenCalledWith("main");
    expect(result.command).toBe("auth:switch");
    expect(result.next).toContain("gcloud auth application-default login");
  });

  it("can align ADC after switching gcloud configuration", async () => {
    const gcloudContext = await import("../src/auth/gcloud-context.js");

    const result = await runAuthSwitch({ configuration: "main", alignAdc: true });

    expect(result.ok).toBe(true);
    expect(gcloudContext.activateGcloudConfiguration).toHaveBeenCalledWith("main");
    expect(gcloudContext.runGcloudAdcLogin).toHaveBeenCalled();
  });

  it("creates a gcloud configuration with account and project", async () => {
    const gcloudContext = await import("../src/auth/gcloud-context.js");

    const result = await runAuthCreate({
      configuration: "main",
      account: "main@example.com",
      projectId: "main-project",
    });

    expect(result.ok).toBe(true);
    expect(gcloudContext.createGcloudConfiguration).toHaveBeenCalledWith("main");
    expect(gcloudContext.setGcloudConfigurationValue).toHaveBeenCalledWith("account", "main@example.com");
    expect(gcloudContext.setGcloudConfigurationValue).toHaveBeenCalledWith("project", "main-project");
    expect(gcloudContext.runGcloudAuthLogin).not.toHaveBeenCalled();
    expect(gcloudContext.runGcloudAdcLogin).not.toHaveBeenCalled();
    expect(result.command).toBe("auth:create");
  });

  it("can login and align ADC while creating a configuration", async () => {
    const gcloudContext = await import("../src/auth/gcloud-context.js");

    const result = await runAuthCreate({
      configuration: "main",
      account: "main@example.com",
      projectId: "main-project",
      login: true,
      alignAdc: true,
    });

    expect(result.ok).toBe(true);
    expect(gcloudContext.runGcloudAuthLogin).toHaveBeenCalledWith("main@example.com");
    expect(gcloudContext.runGcloudAdcLogin).toHaveBeenCalled();
  });

  it("detects account and project after browser login when omitted", async () => {
    authFixtures.context = {
      ...authFixtures.context,
      gcloudAccount: "detected@example.com",
      projectId: "detected-project",
    };
    const gcloudContext = await import("../src/auth/gcloud-context.js");

    const result = await runAuthCreate({
      configuration: "detected",
      login: true,
    });

    expect(result.ok).toBe(true);
    expect(gcloudContext.runGcloudAuthLogin).toHaveBeenCalledWith(undefined);
    expect(gcloudContext.setGcloudConfigurationValue).toHaveBeenCalledWith("account", "detected@example.com");
    expect(gcloudContext.setGcloudConfigurationValue).toHaveBeenCalledWith("project", "detected-project");
  });

  it("uses the only visible project after login when no active project exists", async () => {
    authFixtures.context = {
      ...authFixtures.context,
      gcloudAccount: "detected@example.com",
      projectId: null,
    };
    authFixtures.projects = [{ projectId: "solo-project", name: "Solo Project" }];
    const gcloudContext = await import("../src/auth/gcloud-context.js");

    const result = await runAuthCreate({
      configuration: "detected",
      login: true,
    });

    expect(result.ok).toBe(true);
    expect(gcloudContext.setGcloudConfigurationValue).toHaveBeenCalledWith("project", "solo-project");
  });

  it("ignores invalid detected project values and falls back to the only visible project", async () => {
    authFixtures.context = {
      ...authFixtures.context,
      gcloudAccount: "detected@example.com",
      projectId: "C:\\Temp\\tmpfile",
    };
    authFixtures.projects = [{ projectId: "real-project", name: "Real Project" }];
    const gcloudContext = await import("../src/auth/gcloud-context.js");

    const result = await runAuthCreate({
      configuration: "detected",
      login: true,
    });

    expect(result.ok).toBe(true);
    expect(gcloudContext.setGcloudConfigurationValue).toHaveBeenCalledWith("project", "real-project");
  });

  it("sets an explicit project on the active configuration", async () => {
    const gcloudContext = await import("../src/auth/gcloud-context.js");

    const result = await runAuthProject({
      projectId: "<live-validation-project>",
      interactive: false,
    });

    expect(result.ok).toBe(true);
    expect(gcloudContext.setGcloudConfigurationValue).toHaveBeenCalledWith("project", "<live-validation-project>");
    expect(result.command).toBe("auth:project");
  });

  it("requires a project in non-interactive mode when multiple projects are visible", async () => {
    authFixtures.projects = [
      { projectId: "one-project", name: "One" },
      { projectId: "two-project", name: "Two" },
    ];

    const result = await runAuthProject({
      interactive: false,
    });

    expect(result.ok).toBe(false);
    expect(result.ok ? undefined : result.error.code).toBe("PROJECT_SELECTION_REQUIRED");
    expect(result.ok ? undefined : result.error.data?.projects).toEqual([
      { projectId: "one-project", name: "One" },
      { projectId: "two-project", name: "Two" },
    ]);
  });
});
