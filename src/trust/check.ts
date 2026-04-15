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
  _action: string,
  _profile: TrustProfile,
  _opts: CheckOptions = {},
): PermissionCheck {
  throw new Error("Not implemented");
}

export { getLevel };
