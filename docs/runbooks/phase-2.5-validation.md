# Phase 2.5 Validation Record

Date: 2026-04-18

## Local Verification

- `npm run typecheck`: passed
- `npm run build`: passed
- `npx vitest run`: passed, 19 test files and 76 tests

## MCP Client Smoke

- Client surface: Codex MCP configuration
- Server registered as: `oh-my-google`
- Command: `node D:\<repo-root>\bin\omg mcp start`
- Tools discovered:
  - `omg.approvals.list`
  - `omg.approve`
  - `omg.deploy`
  - `omg.doctor`
  - `omg.init`
  - `omg.link`
  - `omg.reject`
- `omg.doctor` tool call returned JSON text parseable from `content[0].text`.

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

- Disposable GCP project `omg-e2e-260418-193712` was deleted after validation.
- Local fixture directory was removed after evidence was recorded here.
