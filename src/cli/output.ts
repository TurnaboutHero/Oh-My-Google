/**
 * Agent-first output module.
 *
 * omg의 핵심 차별점: 모든 출력이 에이전트가 파싱할 수 있는 구조화된 형태.
 * --output json 이면 JSON, 아니면 사람이 읽기 좋은 텍스트.
 */

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

/**
 * Print success output.
 * JSON mode: structured object for agent parsing.
 * Human mode: readable text with checkmarks.
 */
export function success(command: string, message: string, data?: Record<string, unknown>, next?: string[]) {
  if (currentFormat === "json") {
    const output: OmgOutput = { ok: true, command, data, next };
    console.log(JSON.stringify(output));
  } else {
    console.log(`✓ ${message}`);
    if (next?.length) {
      console.log("\nNext steps:");
      for (const step of next) {
        console.log(`  → ${step}`);
      }
    }
  }
}

/**
 * Print error output.
 * JSON mode: structured error for agent to match on code.
 * Human mode: readable error with hint.
 */
export function fail(command: string, code: string, message: string, recoverable: boolean, hint?: string) {
  if (currentFormat === "json") {
    const output: OmgOutput = {
      ok: false,
      command,
      error: { code, message, recoverable, hint },
    };
    console.log(JSON.stringify(output));
  } else {
    console.error(`✗ ${message}`);
    if (hint) {
      console.error(`  Hint: ${hint}`);
    }
  }
}

/**
 * Print info/status output.
 */
export function info(command: string, data: Record<string, unknown>) {
  if (currentFormat === "json") {
    console.log(JSON.stringify({ ok: true, command, data }));
  } else {
    for (const [key, value] of Object.entries(data)) {
      const icon = value === false || value === null ? "✗" : value === true ? "✓" : "·";
      console.log(`  ${icon} ${key}: ${value}`);
    }
  }
}
