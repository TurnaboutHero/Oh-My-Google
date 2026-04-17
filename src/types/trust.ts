/**
 * Trust Profile — init에서 1회 설정, 이후 runtime 자동 판단 기준.
 * 에이전트 자체 판단 금지. profile이 결정.
 */

export type TrustLevel = "L0" | "L1" | "L2" | "L3";

export type TrustAction =
  | "auto"           // 자동 실행
  | "require_confirm" // JSON 모드 --yes 필수, 사람 모드 y/N
  | "require_approval" // 추가 승인 게이트 (프로덕션)
  | "deny";          // 실행 거부

export type Environment = "local" | "dev" | "staging" | "prod";

export interface TrustRule {
  level: TrustLevel;
  action: TrustAction;
}

export interface TrustProfile {
  version: 1;
  projectId: string;
  environment: Environment;
  budgetCapUsdMonthly?: number;
  allowedServices: string[]; // ex: ["cloud-run", "firebase-hosting", "firestore"]
  allowedRegions: string[];  // ex: ["asia-northeast3"]
  deny?: string[];            // ex: ["project.delete", "iam.role.*.owner"]
  rules: {
    L0: TrustAction; // 읽기, 조회
    L1: TrustAction; // 배포, 설정 변경
    L2: TrustAction; // IAM, 빌링, 프로덕션
    L3: TrustAction; // 데이터 삭제, 계정 삭제
  };
  createdAt: string;
  updatedAt: string;
}

export interface PermissionCheck {
  allowed: boolean;
  action: TrustAction;
  reason?: string;
  reasonCode?:
    | "DENIED"
    | "REQUIRES_CONFIRM"
    | "APPROVAL_REQUIRED"
    | "APPROVAL_NOT_FOUND"
    | "APPROVAL_EXPIRED"
    | "APPROVAL_NOT_APPROVED"
    | "APPROVAL_MISMATCH"
    | "APPROVAL_CONSUMED";
  approvalId?: string;
  deniedBy?: string;
}
