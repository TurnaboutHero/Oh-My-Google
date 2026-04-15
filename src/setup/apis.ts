/**
 * Service API 활성화.
 *
 * TODO(codex):
 * - enableApis(projectId, apiNames[]): 배치 활성화 (gcloud services enable)
 * - listEnabledApis(projectId): 현재 활성 목록
 * - DEFAULT_APIS: 기본 세트 상수
 */

export const DEFAULT_APIS = [
  "cloudbuild.googleapis.com",
  "run.googleapis.com",
  "artifactregistry.googleapis.com",
  "firebasehosting.googleapis.com",
  "firestore.googleapis.com",
  "secretmanager.googleapis.com",
  "iam.googleapis.com",
  "serviceusage.googleapis.com",
];

export async function enableApis(_projectId: string, _apiNames: string[]): Promise<void> {
  throw new Error("Not implemented");
}

export async function listEnabledApis(_projectId: string): Promise<string[]> {
  throw new Error("Not implemented");
}
