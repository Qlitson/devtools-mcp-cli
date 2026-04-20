/**
 * DevTools → Claude Code：Channel（推送）入口
 *
 * - stdio：由 Claude Code spawn，用于声明 channel 能力并发送 notifications/claude/channel
 * - HTTP：本机监听，供浏览器扩展 POST（与官方 webhook channel 示例同思路）
 *
 * 官方参考：
 * https://code.claude.com/docs/en/channels-reference.md#example-build-a-webhook-receiver
 */

const express = require("express");
const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const {
  StdioServerTransport,
} = require("@modelcontextprotocol/sdk/server/stdio.js");
const {
  setLastTask,
  appendDiagnostic,
  isEmptyDevToolsTask,
  setBrowserTestSteps,
  popBrowserTestSteps,
  popAllMcpConsoleLines,
  getStateFilePath,
} = require("./state");

const HTTP_HOST = process.env.DEVTOOLS_CHANNEL_HTTP_HOST || "127.0.0.1";
const HTTP_PORT = Number.parseInt(
  process.env.DEVTOOLS_CHANNEL_HTTP_PORT || "55666",
  10,
);

const server = new Server(
  { name: "DevToolsChannel", version: "1.0.0" },
  {
    capabilities: {
      experimental: {
        "claude/channel": {},
      },
    },
    instructions:
      "浏览器 DevTools 桥接事件通过 channel 推送。内容通常是 JSON：包含 dom、prompt、url、selector、sourceHints（开发模式下 React / Vue2 `vue2_sfc` / Vue3 `vue_sfc` 等尽力提供的源码路径线索）、type 等字段。收到后请根据用户意图处理（分析 DOM、定位元素、修改代码等）。",
  },
);

// 允许发送 Claude Code channel 通知（SDK 默认 assert 未覆盖该 method）
const upstreamAssertNotificationCapability =
  server.assertNotificationCapability.bind(server);
server.assertNotificationCapability = function (method) {
  if (method === "notifications/claude/channel") {
    if (!server._capabilities?.experimental?.["claude/channel"]) {
      throw new Error("Server does not declare claude/channel capability");
    }
    return;
  }
  return upstreamAssertNotificationCapability(method);
};

const app = express();
let channelTransportReady = false;
let lastChannelPushError = null;
app.use(express.json({ limit: "2mb" }));
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

app.use((req, res, next) => {
  if (req.path === "/channel-health") return next();
  if (req.method === "GET" && req.path === "/get-browser-test-steps") return next();
  if (req.method === "GET" && req.path === "/get-mcp-console") return next();
  if (channelTransportReady) return next();
  res.status(503).json({ ok: false, error: "channel_not_ready" });
});

app.get("/channel-health", (_req, res) => {
  res.json({
    ok: true,
    channelTransportReady,
    lastChannelPushError,
  });
});

async function pushChannelEvent(content, meta) {
  try {
    await server.notification({
      method: "notifications/claude/channel",
      params: {
        content,
        meta,
      },
    });
    lastChannelPushError = null;
  } catch (err) {
    lastChannelPushError = String(err?.message || err);
    console.error("Channel 推送失败:", err);
  }
}

app.post("/from-devtools", async (req, res) => {
  const type = req.body?.type || "user_prompt";
  if (type === "page_error" || type === "unhandled_rejection") {
    await appendDiagnostic(req.body);
    console.log("⚠️ 收到页面诊断（已写入 diagnostics，未覆盖 lastTask）:", {
      type,
      url: req.body?.url || "",
      message: String(req.body?.message || "").slice(0, 200),
    });
  } else {
    if (isEmptyDevToolsTask(req.body)) {
      await setLastTask(null);
      res.json({ ok: true, skipped: true });
      return;
    }
    await setLastTask(req.body);
    const selector = req.body?.selector || "";
    const prompt = req.body?.prompt ? String(req.body.prompt).slice(0, 120) : "";
    const url = req.body?.url || "";
    console.log("✅ 收到 DevTools 指令:", {
      type,
      selector,
      url,
      promptPreview: prompt,
    });
  }

  const payload = JSON.stringify(req.body);
  await pushChannelEvent(payload, {
    path: "/from-devtools",
    method: "POST",
    type,
  });

  res.json({ ok: true });
});

app.post("/set-browser-test-steps", async (req, res) => {
  const steps = req.body?.steps;
  if (!Array.isArray(steps)) {
    res.status(400).json({ ok: false, error: "steps_must_be_array" });
    return;
  }
  await setBrowserTestSteps(steps);
  console.log(
    steps.length ? "📥 已收到浏览器测试步骤" : "📥 已清空浏览器测试步骤队列",
  );

  const payload = JSON.stringify(req.body ?? {});
  await pushChannelEvent(payload, {
    path: "/set-browser-test-steps",
    method: "POST",
  });

  res.json({ ok: true });
});

app.get("/get-browser-test-steps", async (req, res) => {
  const steps = await popBrowserTestSteps();
  res.json(steps || []);
});

app.get("/get-mcp-console", async (_req, res) => {
  const lines = await popAllMcpConsoleLines();
  res.json({ lines: lines || [] });
});

app.post("/browser-test-result", async (req, res) => {
  console.log("📊 测试结果：", req.body);
  await setBrowserTestSteps([]);

  const payload = JSON.stringify(req.body ?? {});
  await pushChannelEvent(payload, {
    path: "/browser-test-result",
    method: "POST",
  });

  res.json({ ok: true });
});

async function startHttp() {
  const httpServer = await new Promise((resolve, reject) => {
    const s = app.listen(HTTP_PORT, HTTP_HOST);
    s.once("error", reject);
    s.once("listening", () => resolve(s));
  });
  const addr = httpServer.address();
  console.log("Channel HTTP 已启动:", addr);
  console.log(`插件地址: http://${HTTP_HOST}:${HTTP_PORT}`);
  console.log("状态文件（与 MCP 共用）:", getStateFilePath());

  httpServer.on("error", (err) => {
    console.error("Channel HTTP 异常，进程退出:", err);
    process.exit(1);
  });
}

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  channelTransportReady = true;

  await startHttp();
}

main().catch((err) => {
  console.error("Channel 服务启动失败:", err);
  process.exit(1);
});
