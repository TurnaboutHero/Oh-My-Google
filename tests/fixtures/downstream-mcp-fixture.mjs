import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

const tools = [
  {
    name: "projects.list",
    description: "List demo projects",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "projects.delete",
    description: "Delete a demo project",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    annotations: {
      destructiveHint: true,
    },
  },
];

const server = new Server(
  { name: "omg-downstream-fixture", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "projects.list") {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ projects: [{ projectId: "demo-project" }] }),
        },
      ],
    };
  }

  return {
    content: [{ type: "text", text: "Tool is intentionally blocked in this fixture." }],
    isError: true,
  };
});

await server.connect(new StdioServerTransport());
