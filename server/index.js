const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const express = require("express");
const z = require("zod");

const app = express();
app.use(express.json());

let lastTask = null;
let browserTestSteps = null;

// 1. 初始化 MCP Server（必须带 name/version）
const mcpServer = new McpServer({
  name: "DevToolsMCP",
  version: "1.0.0",
});

// 2. 注册工具：获取 DevTools 指令
mcpServer.registerTool(
  "getDevToolsTask",
  {
    description: "Fetch the latest task sent from the DevTools bridge.",
    inputSchema: z.object({}), // 无参数
    outputSchema: z.object({
      task: z.unknown().nullable(),
    }),
  },
  async () => {
    const task = lastTask;
    lastTask = null;

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

// 3. 浏览器接口（不变）
app.post("/from-devtools", (req, res) => {
  lastTask = req.body;
  console.log("✅ 收到 DevTools 指令");
  res.json({ ok: true });
});

app.post("/set-browser-test-steps", (req, res) => {
  browserTestSteps = req.body.steps;
  console.log("📥 已收到浏览器测试步骤");
  res.json({ ok: true });
});

app.get("/get-browser-test-steps", (req, res) => {
  const steps = browserTestSteps;
  browserTestSteps = null;
  res.json(steps || []);
});

app.post("/browser-test-result", (req, res) => {
  console.log("📊 测试结果：", req.body);
  res.json({ ok: true });
});

// 4. 同时启动 Express + MCP Stdio
async function start() {
  // 启动 HTTP
  app.listen(55555, () => {
    console.log("服务已启动: http://localhost:55555");
  });

  // 启动 MCP Stdio 传输
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

start().catch(console.error);
