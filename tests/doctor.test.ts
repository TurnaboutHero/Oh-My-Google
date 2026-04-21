import { describe, expect, it, vi } from "vitest";

const doctorFixtures = vi.hoisted(() => ({
  status: {
    projectId: null as string | null,
    adcConfigured: true,
    adcAccount: "adc@example.com" as string | null,
    gcloudAccount: "cli@example.com" as string | null,
    gcp: true,
  },
}));

vi.mock("../src/auth/auth-manager.js", () => ({
  AuthManager: class {
    async status() {
      return doctorFixtures.status;
    }
  },
}));

vi.mock("../src/system/cli-runner.js", () => ({
  execCliFileSync: vi.fn((command: string) => {
    if (command === "firebase") {
      return "13.0.0\n";
    }
    if (command === "gcloud") {
      return "Google Cloud SDK 500.0.0\n";
    }
    return "";
  }),
}));

describe("doctor command", () => {
  it("reports a warning when gcloud and ADC accounts differ", async () => {
    const { runDoctor } = await import("../src/cli/doctor.js");

    const result = await runDoctor(process.cwd());

    expect(result.checks.gcloudAccount).toEqual({
      ok: true,
      detail: "cli@example.com",
    });
    expect(result.checks.adcAccount).toEqual({
      ok: true,
      detail: "adc@example.com",
    });
    expect(result.checks.accountContext).toEqual({
      ok: false,
      detail: "gcloud account cli@example.com differs from ADC account adc@example.com",
    });
    expect(result.next).toContain("align gcloud and ADC accounts or use explicit account expectations");
  });

  it("reports account context as aligned when gcloud and ADC accounts match", async () => {
    doctorFixtures.status = {
      ...doctorFixtures.status,
      adcAccount: "same@example.com",
      gcloudAccount: "same@example.com",
    };
    const { runDoctor } = await import("../src/cli/doctor.js");

    const result = await runDoctor(process.cwd());

    expect(result.checks.accountContext).toEqual({
      ok: true,
      detail: "gcloud and ADC accounts match",
    });
  });
});
