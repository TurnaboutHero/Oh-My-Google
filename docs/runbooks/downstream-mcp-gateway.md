# Downstream MCP Gateway Runbook

Phase 4B adds a narrow downstream MCP gateway. It lets `omg` register external MCP servers, audit their declared tools, discover tool metadata, and proxy only explicitly allowlisted read-only tools through the same safety layer.

This is not a generic raw MCP escape hatch. Unknown tools, unallowlisted tools, disabled servers, destructive tool metadata, and non-read declarations are denied.

## Registry

Downstream servers are registered in `.omg/mcp.yaml`:

```yaml
version: 1
servers:
  - id: google
    transport: stdio
    command: node
    args: ["tools/google-mcp-server.js"]
    envAllowlist: ["PATH"]
    tools:
      - name: projects.list
        mode: read
        resource: projects
```

Rules:

- Use `envAllowlist`; do not store secret values in `.omg/mcp.yaml`.
- `tools[].mode: read` is the only executable mode in Phase 4B.
- `write` and `lifecycle` declarations are recorded for review but blocked until a verifier exists.
- Discovery starts the registered MCP server and calls `tools/list`; it does not call downstream tools.

## CLI

Audit the registry without connecting to downstream servers:

```bash
omg --output json mcp gateway audit
```

Discover registered downstream tool metadata:

```bash
omg --output json mcp gateway audit --discover
```

Call an allowlisted read-only tool:

```bash
omg --output json mcp gateway call --server google --tool projects.list --args-json "{}"
```

## MCP Tools

Equivalent `omg` MCP tools:

- `omg.mcp.gateway.audit`
- `omg.mcp.gateway.call`

Examples:

```json
{ "tool": "omg.mcp.gateway.audit", "arguments": { "discover": true } }
```

```json
{
  "tool": "omg.mcp.gateway.call",
  "arguments": {
    "server": "google",
    "tool": "projects.list",
    "arguments": {}
  }
}
```

## Safety Behavior

- `downstream.mcp.discover` is L0 read-only.
- `downstream.mcp.read` is L0 read-only.
- The raw `downstream-mcp` adapter remains deny-by-default.
- Only the `downstream-mcp-readonly` adapter is executable.
- `omg.mcp.gateway.call` requires `.omg/trust.yaml` so Trust Profile policy still applies.
- Every downstream tool call attempt writes a decision log event under `.omg/decisions.log.jsonl`.
- Decision logging records server id, tool name, and argument keys, not raw argument payloads.
- Mutation-looking tool names or `destructiveHint` metadata are denied even if the registry mistakenly marks the tool as read.

## Output Shape

Audit:

```json
{
  "ok": true,
  "command": "mcp:gateway:audit",
  "data": {
    "found": true,
    "discovery": true,
    "servers": [
      {
        "id": "google",
        "enabled": true,
        "declaredToolCount": 1,
        "discoveredToolCount": 1,
        "tools": [
          {
            "name": "projects.list",
            "declared": true,
            "discovered": true,
            "mode": "read",
            "executable": true,
            "reason": "Tool is allowlisted for read-only proxying.",
            "mutationSignals": []
          }
        ]
      }
    ],
    "risk": "low"
  }
}
```

Denied call:

```json
{
  "ok": false,
  "command": "mcp:gateway:call",
  "error": {
    "code": "DOWNSTREAM_MCP_TOOL_DENIED",
    "message": "Downstream MCP tool is not allowlisted: google.projects.delete.",
    "recoverable": false
  }
}
```
