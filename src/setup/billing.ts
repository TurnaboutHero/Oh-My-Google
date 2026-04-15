/**
 * 빌링 계정 연결.
 *
 * TODO(codex):
 * - listBillingAccounts(): Promise<{id, displayName, open}[]>
 * - linkBilling(projectId, billingAccountId): Promise<void>
 * - getBillingStatus(projectId): Promise<{linked: boolean, billingAccountId?: string}>
 * 빌링 없으면 NO_BILLING 에러 (recoverable: false).
 */

export interface BillingAccount {
  id: string;
  displayName: string;
  open: boolean;
}

export async function listBillingAccounts(): Promise<BillingAccount[]> {
  throw new Error("Not implemented");
}

export async function linkBilling(_projectId: string, _billingAccountId: string): Promise<void> {
  throw new Error("Not implemented");
}

export async function getBillingStatus(_projectId: string): Promise<{ linked: boolean; billingAccountId?: string }> {
  throw new Error("Not implemented");
}
