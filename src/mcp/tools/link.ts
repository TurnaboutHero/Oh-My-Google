import { runLink, type RunLinkInput } from "../../cli/commands/link.js";
import type { OmgResponse } from "./types.js";

export const linkTool = {
  name: "omg.link",
  description: "Detect the repository and create .omg/project.yaml plan.",
  inputSchema: {
    type: "object",
    properties: {
      region: { type: "string" },
      service: { type: "string" },
      site: { type: "string" },
    },
    additionalProperties: false,
  },
};

export async function handleLink(args: unknown): Promise<OmgResponse> {
  const parsed = parseArgs(args);
  if (!parsed.ok) {
    return parsed.response;
  }

  const outcome = await runLink({
    cwd: process.cwd(),
    ...parsed.args,
  });

  if (outcome.ok) {
    return {
      ok: true,
      command: "link",
      data: { plan: outcome.data.plan },
      next: outcome.next,
    };
  }

  return {
    ok: false,
    command: "link",
    data: outcome.error.data,
    error: {
      code: outcome.error.code,
      message: outcome.error.message,
      recoverable: outcome.error.recoverable,
      hint: outcome.error.hint,
    },
  };
}

function parseArgs(
  args: unknown,
):
  | { ok: true; args: Omit<RunLinkInput, "cwd"> }
  | { ok: false; response: OmgResponse } {
  if (!isRecord(args)) {
    return validationError("Arguments must be an object.");
  }

  for (const key of Object.keys(args)) {
    if (key !== "region" && key !== "service" && key !== "site") {
      return validationError(`Unknown argument: ${key}.`);
    }
  }

  if (args.region !== undefined && typeof args.region !== "string") {
    return validationError("region must be a string.");
  }
  if (args.service !== undefined && typeof args.service !== "string") {
    return validationError("service must be a string.");
  }
  if (args.site !== undefined && typeof args.site !== "string") {
    return validationError("site must be a string.");
  }

  return {
    ok: true,
    args: {
      region: args.region,
      service: args.service,
      site: args.site,
    },
  };
}

function validationError(message: string): { ok: false; response: OmgResponse } {
  return {
    ok: false,
    response: {
      ok: false,
      command: "link",
      error: { code: "VALIDATION_ERROR", message, recoverable: true },
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
