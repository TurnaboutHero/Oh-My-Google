import crypto from "node:crypto";

export function normalizeArgs(args: Record<string, unknown>): string {
  return JSON.stringify(sortValue(args));
}

export function hashArgs(args: Record<string, unknown>): string {
  return crypto.createHash("sha256").update(normalizeArgs(args)).digest("hex");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }

  if (!isPlainObject(value)) {
    return value;
  }

  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortValue(value[key])]),
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}
