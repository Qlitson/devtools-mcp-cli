const express = require("express");
const {
  setLastTask,
  appendDiagnostic,
  isEmptyDevToolsTask,
  setBrowserTestSteps,
  popBrowserTestSteps,
} = require("./state");

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
const HTTP_PORT = Number.parseInt(process.env.DEVTOOLS_HTTP_PORT || "55667", 10);

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
  res.json({ ok: true });
});

app.get("/get-browser-test-steps", async (req, res) => {
  const steps = await popBrowserTestSteps();
  res.json(steps || []);
});

app.post("/browser-test-result", (req, res) => {
  console.log("📊 测试结果：", req.body);
  res.json({ ok: true });
});

async function start() {
  const httpServer = await new Promise((resolve, reject) => {
    const server = app.listen(HTTP_PORT, HTTP_HOST);
    server.once("error", (err) => reject(err));
    server.once("listening", () => resolve(server));
  });

  const addr = httpServer.address();
  console.log("HTTP bridge 已启动:", addr);
  console.log(`服务地址: http://${HTTP_HOST}:${HTTP_PORT}`);

  httpServer.on("error", (err) => {
    console.error("HTTP 服务运行异常，进程即将退出:", err);
    process.exit(1);
  });
}

start().catch((err) => {
  console.error("HTTP 服务启动失败:", err);
  process.exit(1);
});
