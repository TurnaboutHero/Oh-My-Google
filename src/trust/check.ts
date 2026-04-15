/**
 * 실행 전 권한 게이트.
 * 모든 side-effect 동작 전에 반드시 호출.
 *
 * TODO(codex):
 * - checkPermission(action, profile): PermissionCheck
 * - require_confirm: JSON 모드에서 flags.yes 없으면 block
 * - require_approval: 추가 prompt + 감사 로그
 */

import type { PermissionCheck, TrustProfile } from "../types/trust.js";
import { getLevel } from "./levels.js";

export interface CheckOptions {
  yes?: boolean;       // --yes 플래그
  jsonMode?: boolean;  // --output json 여부
}

export function checkPermission(
  action: string,
  profile: TrustProfile,
  opts: CheckOptions = {},
): PermissionCheck {
  const level = getLevel(action);
  const trustAction = profile.rules[level];

  if (trustAction === "deny") {
    return {
      allowed: false,
      action: trustAction,
      reason: `Action ${action} is denied by the trust profile.`,
    };
  }

  if (trustAction === "auto") {
    return {
      allowed: true,
      action: trustAction,
    };
  }

  if (!opts.yes) {
    const reason =
      trustAction === "require_approval"
        ? `Action ${action} requires approval. Re-run with --yes.`
        : opts.jsonMode
          ? `Action ${action} requires confirmation in JSON mode. Re-run with --yes.`
          : `Action ${action} requires confirmation. Re-run with --yes.`;

    return {
      allowed: false,
      action: trustAction,
      reason,
    };
  }

  return {
    allowed: true,
    action: trustAction,
  };
}

export { getLevel };
