import { Command } from "commander";
import { startMcpServer } from "../../mcp/server.js";

export const mcpCommand = new Command("mcp").description("Run the omg MCP server");

mcpCommand
  .command("start")
  .description("Start the MCP server over stdio")
  .action(async () => {
    await startMcpServer({ transport: "stdio" });
  });
