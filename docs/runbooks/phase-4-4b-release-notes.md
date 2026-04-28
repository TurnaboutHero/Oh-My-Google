# Phase 4 / 4B Release Notes

Date: 2026-04-24

## Summary

Phase 4 and Phase 4B are complete.

Phase 4 added read-only resource audit surfaces for Firestore, Cloud Storage, and Cloud SQL. Phase 4B added the downstream MCP gateway so `omg` can register external MCP servers, discover tool metadata, and call only explicitly allowlisted read-only downstream tools through the same safety model.

## Delivered

- `omg firestore audit --project <id>` and MCP `omg.firestore.audit`
- `omg storage audit --project <id>` and MCP `omg.storage.audit`
- `omg sql audit --project <id>` and MCP `omg.sql.audit`
- `.omg/mcp.yaml` downstream MCP registry
- `omg mcp gateway audit`
- `omg mcp gateway audit --discover`
- `omg mcp gateway call --server <id> --tool <name> --args-json "{}"`
- MCP `omg.mcp.gateway.audit`
- MCP `omg.mcp.gateway.call`
- MCP server registry coverage for all then-current 23 tools
- Real `mcp start` stdio tool discovery coverage for all then-current 23 tools
- Real stdio downstream MCP fixture coverage for discovery, allowlisted read calls, and denied destructive tools

## Safety Decisions

- Firestore, Cloud Storage, and Cloud SQL surfaces remain read-only.
- Firestore document reads/writes, database lifecycle, export/import, Storage object access, bucket mutations, SQL connections, SQL instance lifecycle, and backup/export/import workflows remain deferred.
- Downstream MCP write and lifecycle proxying is not implemented.
- Raw `downstream-mcp` remains deny-by-default.
- `downstream-mcp-readonly` is the only executable downstream MCP adapter.
- Downstream tool calls require a Trust Profile and log every call attempt to `.omg/decisions.log.jsonl`.
- `.omg/mcp.yaml` rejects stored env value maps; use `envAllowlist`.

## Verification

Local verification expected before release:

```bash
npm run typecheck
npm run build
npx vitest run
git diff --check
```

Targeted automated coverage added in this release:

- `tests/mcp-server-tools.test.ts` locked the exact then-current 23-tool MCP registry for this release.
- `tests/mcp-server-tools.test.ts` launches the MCP server command through a real MCP SDK stdio client and verifies tool discovery.
- `tests/downstream-mcp-stdio.test.ts` launches a real MCP SDK stdio fixture and verifies discovery, read-only call routing, and denial before destructive tool execution.

Live Google Cloud validation was not run for this release note. Live read-only resource audits and external downstream MCP gateway smoke still require an explicit project/account target and approval.

## Phase Commits

- `a7ff30a` - Complete Phase 4 resource audits
- `2f972e7` - Complete downstream MCP gateway phase
