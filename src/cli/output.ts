export type OutputFormat = "human" | "json";

let currentFormat: OutputFormat = "human";

export function setOutputFormat(format: OutputFormat) {
  currentFormat = format;
}

export function getOutputFormat(): OutputFormat {
  return currentFormat;
}

export interface OmgOutput {
  ok: boolean;
  command: string;
  data?: Record<string, unknown>;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    hint?: string;
  };
  next?: string[];
}

export function success(
  command: string,
  message: string,
  data?: Record<string, unknown>,
  next?: string[],
) {
  if (currentFormat === "json") {
    const output: OmgOutput = { ok: true, command, data, next };
    console.log(JSON.stringify(output));
    return;
  }

  console.log(`✓ ${message}`);
  printData(data);
  printNext(next);
}

export function fail(
  command: string,
  code: string,
  message: string,
  recoverable: boolean,
  hint?: string,
  data?: Record<string, unknown>,
  next?: string[],
) {
  if (currentFormat === "json") {
    const output: OmgOutput = {
      ok: false,
      command,
      data,
      error: { code, message, recoverable, hint },
      next,
    };
    console.log(JSON.stringify(output));
    return;
  }

  console.error(`✗ ${message}`);
  if (hint) {
    console.error(`Hint: ${hint}`);
  }
  printNext(next);
}

export function info(command: string, data: Record<string, unknown>) {
  if (currentFormat === "json") {
    console.log(JSON.stringify({ ok: true, command, data }));
    return;
  }

  printData(data);
}

function printData(data?: Record<string, unknown>) {
  if (!data || Object.keys(data).length === 0) {
    return;
  }

  console.log("");
  for (const [key, value] of Object.entries(data)) {
    console.log(`${key}: ${formatValue(value)}`);
  }
}

function printNext(next?: string[]) {
  if (!next?.length) {
    return;
  }

  console.log("");
  console.log("Next:");
  for (const step of next) {
    console.log(`- ${step}`);
  }
}

function formatValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (
    typeof value === "number"
    || typeof value === "boolean"
    || value === null
    || value === undefined
  ) {
    return String(value);
  }

  return JSON.stringify(value);
}
