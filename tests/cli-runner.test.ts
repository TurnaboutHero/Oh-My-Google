import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveCliCommand } from "../src/system/cli-runner.js";

describe("resolveCliCommand", () => {
  it("wraps Windows PowerShell shims so Node child_process can execute them", () => {
    const resolved = resolveCliCommand("gcloud", {
      platform: "win32",
      pathValue: ["C:\\Google\\Cloud SDK\\bin"].join(path.delimiter),
      pathExt: ".COM;.EXE;.BAT;.CMD",
      fileExists: (candidate) => candidate.endsWith("gcloud.ps1"),
    });

    expect(resolved.command).toBe("powershell.exe");
    expect(resolved.argsPrefix).toEqual([
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      "C:\\Google\\Cloud SDK\\bin\\gcloud.ps1",
    ]);
  });

  it("wraps cmd shims on Windows", () => {
    const resolved = resolveCliCommand("firebase", {
      platform: "win32",
      pathValue: ["C:\\Users\\me\\AppData\\Roaming\\npm"].join(path.delimiter),
      pathExt: ".COM;.EXE;.BAT;.CMD",
      fileExists: (candidate) => candidate.endsWith("firebase.cmd"),
    });

    expect(resolved.command).toBe("cmd.exe");
    expect(resolved.argsPrefix).toEqual([
      "/d",
      "/s",
      "/c",
      "call",
      "C:\\Users\\me\\AppData\\Roaming\\npm\\firebase.cmd",
    ]);
  });
});
