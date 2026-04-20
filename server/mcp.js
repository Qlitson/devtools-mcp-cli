const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const z = require("zod");
const {
  popLastTask,
  tryPopLastTask,
  clearDevToolsBridgeQueues,
  appendMcpConsoleLine,
  getStateFilePath,
} = require("./state");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

mcpServer.registerTool(
  "waitForDevToolsTask",
  {
    description:
      "Block until a DevTools task arrives or timeout. Long-poll style; consumes the task when found.",
    inputSchema: z.object({
      timeoutMs: z
        .number()
        .int()
        .min(100)
        .max(120_000)
        .optional()
        .describe("Max wait in ms (100–120000). Default 30000."),
      pollIntervalMs: z
        .number()
        .int()
        .min(50)
        .max(2000)
        .optional()
        .describe("Poll interval in ms (50–2000). Default 300."),
    }),
    outputSchema: z.object({
      task: z.unknown().nullable(),
      timedOut: z.boolean(),
      waitedMs: z.number(),
    }),
  },
  async ({ timeoutMs = 30_000, pollIntervalMs = 300 }) => {
    const deadline = Date.now() + timeoutMs;
    let waitedMs = 0;

    while (Date.now() < deadline) {
      const task = await tryPopLastTask();
      if (task != null) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(task, null, 2),
            },
          ],
          structuredContent: {
            task,
            timedOut: false,
            waitedMs,
          },
        };
      }
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;
      const step = Math.min(pollIntervalMs, remaining);
      await sleep(step);
      waitedMs += step;
    }

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ task: null, timedOut: true, waitedMs }, null, 2),
        },
      ],
      structuredContent: {
        task: null,
        timedOut: true,
        waitedMs,
      },
    };
  },
);

mcpServer.registerTool(
  "postToDevToolsConsole",
  {
    description:
      "Push text to the inspected page's DevTools Console (via extension polling). Chat replies do not appear in the browser automatically—call this with a short summary of your answer or fix so the developer sees it in the page console. Optional level: log | warn | error | info.",
    inputSchema: z.object({
      message: z
        .string()
        .min(1)
        .max(100_000)
        .describe("Text to print in the browser page console under [Claude]."),
      pageUrl: z
        .string()
        .min(1)
        .max(4000)
        .describe("Exact page URL to receive this console line."),
      level: z
        .enum(["log", "warn", "error", "info"])
        .optional()
        .describe("Console method; default log."),
    }),
    outputSchema: z.object({
      ok: z.literal(true),
      queued: z.number().int(),
    }),
  },
  async ({ message, pageUrl, level = "log" }) => {
    await appendMcpConsoleLine({ text: message, targetUrl: pageUrl, level });
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: true, queued: 1 }, null, 2),
        },
      ],
      structuredContent: {
        ok: true,
        queued: 1,
      },
    };
  },
);

mcpServer.registerTool(
  "clearDevToolsBridge",
  {
    description:
      "Optional recovery: clears lastTask and pending browser test steps when the queue looks stuck. Normal workflows do not need this—pending steps are cleared automatically when the extension POSTs /browser-test-result.",
    inputSchema: z.object({}),
    outputSchema: z.object({
      ok: z.literal(true),
    }),
  },
  async () => {
    await clearDevToolsBridgeQueues();
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ ok: true }, null, 2),
        },
      ],
      structuredContent: {
        ok: true,
      },
    };
  },
);

async function start() {
  console.log("状态文件（MCP 与此文件读写同一队列）:", getStateFilePath());
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

start().catch((err) => {
  console.error("MCP 服务启动失败:", err);
  process.exit(1);
});
