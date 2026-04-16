const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");
const { popLastTask } = require("./state");

const mcpServer = new McpServer({
  name: "DevToolsMCP",
  version: "1.0.0",
});

mcpServer.registerTool(
  "getDevToolsTask",
  {
    description: "Fetch the latest task sent from the DevTools bridge.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      task: z.unknown().nullable(),
    }),
  },
  async () => {
    const task = await popLastTask();
    return {
      content: [
        {
          type: "text",
          text: task ? JSON.stringify(task, null, 2) : "null",
        },
      ],
      structuredContent: {
        task,
      },
    };
  },
);

async function start() {
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

start().catch((err) => {
  console.error("MCP 服务启动失败:", err);
  process.exit(1);
});
