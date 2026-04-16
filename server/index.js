const { McpServer } = require("@modelcontextprotocol/sdk/server/mcp.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const express = require("express");
const z = require("zod");

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

const HTTP_HOST = process.env.DEVTOOLS_HTTP_HOST || "127.0.0.1";
const HTTP_PORT = Number.parseInt(process.env.DEVTOOLS_HTTP_PORT || "55666", 10);

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
  // 先确保 HTTP 真正监听成功；失败时直接抛错终止进程。
  const httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(HTTP_PORT, HTTP_HOST);
    server.once("error", (err) => {
      reject(err);
    });
    server.once("listening", () => {
      resolve(server);
    });
  });

  const addr = httpServer.address();
  console.log("服务已启动:", addr);
  console.log(`服务地址: http://${HTTP_HOST}:${HTTP_PORT}`);

  httpServer.on("error", (err) => {
    console.error("HTTP 服务运行异常，进程即将退出:", err);
    process.exit(1);
  });

  // 启动 MCP Stdio 传输
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

start().catch((err) => {
  console.error("服务启动失败:", err);
  process.exit(1);
});
