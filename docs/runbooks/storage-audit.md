# Cloud Storage Audit Runbook

This Phase 4 surface adds read-only Cloud Storage inspection. It does not create buckets, delete buckets, list objects, read objects, write objects, mutate IAM policy, or change lifecycle settings.

Commands:

- `omg storage audit --project <id>`
- MCP tool `omg.storage.audit`

## Audit

```bash
omg --output json storage audit --project my-project
```

MCP equivalent:

```json
{ "tool": "omg.storage.audit", "arguments": { "project": "my-project" } }
```

The audit gathers:

- visible Cloud Storage buckets
- bucket location, storage class, public access prevention, uniform bucket-level access, retention, versioning, and lifecycle rule counts when available
- bucket IAM bindings
- public bucket IAM principals
- inaccessible bucket IAM sections

Risk states:

- `low`: no Cloud Storage buckets were visible
- `review`: buckets, review posture signals, or partial audit failures were found
- `high`: a public principal has a bucket IAM binding

## Safety Notes

- Cloud Storage bucket/object/IAM/lifecycle write workflows are not implemented.
- Treat `risk: high` as a blocker before autonomous Storage-related live operations.
- Do not use raw downstream Cloud Storage MCP tools for object or IAM mutation unless they are routed through `omg` safety checks.
- Any future Storage live workflow must be classified as an `OperationIntent`; if cost-bearing, it must require budget guard.

## Output Shape

```json
{
  "ok": true,
  "command": "storage:audit",
  "data": {
    "projectId": "my-project",
    "buckets": [
      {
        "name": "public-assets",
        "url": "gs://public-assets",
        "location": "US",
        "storageClass": "STANDARD",
        "uniformBucketLevelAccess": false,
        "publicAccessPrevention": "inherited",
        "versioningEnabled": true,
        "lifecycleRuleCount": 1
      }
    ],
    "iamBindings": [
      {
        "bucket": "public-assets",
        "role": "roles/storage.objectViewer",
        "members": ["allUsers"],
        "memberCount": 1,
        "public": true
      }
    ],
    "findings": [
      {
        "severity": "high",
        "reason": "Public principal has a Cloud Storage bucket IAM binding.",
        "bucket": "public-assets",
        "role": "roles/storage.objectViewer",
        "member": "allUsers"
      }
    ],
    "inaccessible": [],
    "signals": [
      "1 Cloud Storage bucket(s) visible.",
      "Public access prevention is not enforced for Cloud Storage bucket public-assets.",
      "Uniform bucket-level access is disabled for Cloud Storage bucket public-assets.",
      "Public principal has a Cloud Storage bucket IAM binding. Bucket: public-assets. Role: roles/storage.objectViewer. Member: allUsers."
    ],
    "risk": "high",
    "recommendedAction": "Review public Cloud Storage IAM bindings before adding bucket, object, or lifecycle write workflows."
  },
  "next": [
    "Review public Cloud Storage IAM bindings before adding bucket, object, or lifecycle write workflows."
  ]
}
```
