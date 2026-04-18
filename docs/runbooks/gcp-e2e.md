# GCP E2E Runbook

Purpose: verify the real Google path for `omg init -> omg link -> omg deploy -> omg doctor`.

Use a disposable test project. Do not run this against production until Phase 2.5 is complete.

## Prerequisites

- Node.js 20+
- `gcloud` installed and authenticated
- `firebase` CLI installed and authenticated when testing Firebase Hosting
- A billing account that can be linked to a disposable project
- A small deployable fixture repo or app

## Recommended Fixture

Use a minimal `spa-plus-api` repo:

- `Dockerfile` for a small HTTP API exposing `/api/health`
- `package.json` with a deterministic frontend build command
- `firebase.json` for Hosting

## Steps

1. Install and build omg:

```bash
npm install
npm run build
```

2. Initialize a disposable project:

```bash
node bin/omg --output json init \
  --project <test-project-id> \
  --billing <billing-account-id> \
  --environment dev \
  --region asia-northeast3 \
  --yes
```

3. Add Firebase resources to the disposable GCP project:

```bash
firebase projects:addfirebase <test-project-id> --non-interactive
```

4. Link the fixture repo to the Firebase project:

```bash
cat > .firebaserc <<'JSON'
{
  "projects": {
    "default": "<test-project-id>"
  }
}
JSON
```

5. Link the fixture repo:

```bash
node bin/omg --output json link
```

6. Dry-run the deployment:

```bash
node bin/omg --output json deploy --dry-run
```

7. Execute the deployment:

```bash
node bin/omg --output json deploy --yes
```

8. Diagnose the final state:

```bash
node bin/omg --output json doctor
```

## Pass Criteria

- `init` creates `.omg/trust.yaml` and `~/.omg/config.json`.
- `firebase projects:addfirebase` creates Firebase resources and the default Hosting site.
- `.firebaserc` links the fixture to the Firebase project.
- `link` creates `.omg/project.yaml`.
- `deploy --dry-run` returns the planned deployment order.
- `deploy --yes` returns deployed URLs.
- `.omg/decisions.log.jsonl` records the run.
- `.omg/handoff.md` records URLs, pending work, risks, rollback state, and next steps.
- `doctor` returns structured checks.

## Cleanup

After the run, remove disposable resources from the Google Cloud console or with `gcloud`.
Do not rely on rollback as project cleanup.

## Failure Triage

- If `init` fails, inspect `gcloud auth`, billing permissions, and API enable permissions.
- If `link` fails, inspect detected stack and `.omg/project.yaml` creation.
- If `deploy` fails, inspect `.omg/decisions.log.jsonl`, `.omg/handoff.md`, Cloud Run logs, and Firebase Hosting logs.
