import { runDoctor } from "../../cli/doctor.js";
import type { OmgResponse } from "./types.js";

export const doctorTool = {
  name: "omg.doctor",
  description: "Diagnose connection and configuration status.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
};

export async function handleDoctor(_args: unknown): Promise<OmgResponse> {
  try {
    const result = await runDoctor(process.cwd());
    return {
      ok: result.ok,
      command: "doctor",
      data: { checks: result.checks },
      next: result.next,
    };
  } catch (error) {
    return {
      ok: false,
      command: "doctor",
      error: {
        code: "DOCTOR_FAILED",
        message: error instanceof Error ? error.message : "Unknown doctor error.",
        recoverable: true,
      },
    };
  }
}
