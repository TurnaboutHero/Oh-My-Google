# MCP Client Smoke Runbook

Purpose: verify that a real MCP client can consume `omg mcp start`, list tools, and call at least one low-risk tool.

Scope note: this runbook covers the `omg` MCP server itself. It does not validate downstream Google/Firebase MCP servers behind `omg`; that gateway layer is not implemented yet.

## Prerequisites

- Node.js 20+
- Dependencies installed with `npm install`
- Project built with `npm run build`
- MCP client that supports stdio servers

## Server Command

```bash
node bin/omg mcp start
```

## Expected Tools

- `omg.doctor`
- `omg.auth.context`
- `omg.approvals.list`
- `omg.approve`
- `omg.reject`
- `omg.deploy`
- `omg.budget.audit`
- `omg.init`
- `omg.link`
- `omg.secret.list`
- `omg.secret.set`
- `omg.secret.delete`
- `omg.project.audit`
- `omg.project.cleanup`
- `omg.project.delete`
- `omg.project.undelete`

## Smoke Steps

1. Configure the MCP client to launch `node bin/omg mcp start` from the repo root.
2. Start the client and request tool discovery.
3. Confirm all expected tools are listed.
4. Call `omg.doctor` with `{}`.
5. Confirm the response is JSON text in the standard `{ok, command, data?, error?, next?}` shape.
6. If `.omg/approvals/` exists, call `omg.approvals.list` with `{}` and confirm it returns an approvals array.

## Pass Criteria

- Tool discovery succeeds.
- `omg.doctor` returns a structured response without crashing the MCP server.
- The client can parse `content[0].text` as JSON.

## Recordkeeping

After a manual smoke, record the result in the project handoff or the PR notes with:

- client name and version
- command used
- tools discovered
- tool call result summary
- failures or rough edges
