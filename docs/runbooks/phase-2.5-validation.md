# Phase 2.5 Validation Record

Date: 2026-04-18

## Local Verification

- `npm run typecheck`: passed
- `npm run build`: passed
- `npx vitest run`: passed, 19 test files and 76 tests

## MCP Client Smoke

- Client surface: Codex MCP configuration
- Server registered as: `oh-my-google`
- Command from repo root: `node bin/omg mcp start`
- Tools discovered at the time of the 2026-04-18 Phase 2.5 smoke:
  - `omg.approvals.list`
  - `omg.approve`
  - `omg.deploy`
  - `omg.doctor`
  - `omg.init`
  - `omg.link`
  - `omg.reject`
- `omg.doctor` tool call returned JSON text parseable from `content[0].text`.

The MCP surface has since expanded. See [mcp-client-smoke.md](./mcp-client-smoke.md) for the current expected tool list.

## GCP E2E Smoke

- Fixture: `spa-plus-api` disposable test app
- Project: `omg-e2e-260418-193712`
- Region: `asia-northeast3`
- Billing account: linked during `omg init`
- Commands:
  - `omg init`: passed
  - `omg link`: passed, detected `spa-plus-api`
  - `omg deploy --dry-run`: passed
  - `omg deploy --yes`: passed after Firebase resources were added to the test project
  - `omg doctor`: passed after `.firebaserc` linked the fixture to the Firebase project

Returned deploy URLs during validation:

- Backend: `https://omg-e2e-api-whemcjtvea-du.a.run.app`
- Frontend: `https://omg-e2e-260418-193712.web.app`

Smoke checks:

- Backend `/api/health` returned `{"ok":true,"service":"omg-e2e"}`.
- Frontend returned HTTP 200 and contained `omg e2e fixture`.

## Findings

- Windows `gcloud` and `firebase` shims need command resolution before Node child processes can execute them reliably.
- Fresh GCP projects need Firebase resources and a Hosting site before `firebase deploy --only hosting` can complete.
- `omg doctor` expects `.firebaserc` when `firebase.json` is present.

## Cleanup

- Disposable GCP project `omg-e2e-260418-193712` was deleted after validation through a project delete request.
- Follow-up check on 2026-04-30 showed the project still visible to `gcloud projects describe` with lifecycle state `DELETE_REQUESTED`, billing disabled, and no matching active Firebase project in `firebase projects:list --json`.
- Treat `DELETE_REQUESTED` as cleanup evidence, not as proof that the project has fully disappeared from all Google/Firebase consoles.
- Local fixture directory was removed after evidence was recorded here.

## Follow-Up Verification: 2026-04-20

- `npm run typecheck`: passed
- `npm run build`: passed
- `npx vitest run`: passed, 32 test files and 156 tests
- Later live smoke covered project delete/undelete/delete-again and budget-guarded Secret Manager create/delete. See the project cleanup, budget guard, and secret admin runbooks for those records.
