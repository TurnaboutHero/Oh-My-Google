import type { PermissionCheck, TrustProfile } from "../types/trust.js";
import { getLevel } from "./levels.js";

export interface CheckOptions {
  yes?: boolean;
  jsonMode?: boolean;
}

export function checkPermission(
  action: string,
  profile: TrustProfile,
  opts: CheckOptions = {},
): PermissionCheck {
  const level = getLevel(action);
  const trustAction = profile.rules[level];

  if (trustAction === "auto") {
    return { allowed: true, action: trustAction };
  }

  if (trustAction === "deny") {
    return {
      allowed: false,
      action: trustAction,
      reason: `Trust profile denies ${action}.`,
    };
  }

  if (trustAction === "require_confirm") {
    if (opts.jsonMode && !opts.yes) {
      return {
        allowed: false,
        action: trustAction,
        reason: `Trust profile requires --yes for ${action} in JSON mode.`,
      };
    }

    return { allowed: true, action: trustAction };
  }

  return {
    allowed: false,
    action: trustAction,
    reason: `Trust profile requires manual approval for ${action}.`,
  };
}

export { getLevel };
