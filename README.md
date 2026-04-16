# DevTools MCP CLI
Bidirectional DevTools bridge for Claude CLI: send prompts to AI & replay Playwright actions in browser.

One-stop workflow: debug → auto fix → auto test → auto verify.

---

# DevTools MCP CLI（中文版）
DevTools ↔ 本地服务 ↔ Claude CLI 双向打通
页面发指令给 AI，AI 下发操作到浏览器自动执行
支持 Playwright 风格操作在真实浏览器中回放

## ✨ 功能特性
- 右键页面元素，一键发送需求给 Claude CLI
- 自动监听页面报错，上传给 AI 自动分析修复
- AI 可将 Playwright E2E 用例转为操作步骤，浏览器直接执行
- 支持 click / fill / check / navigate 等标准操作
- 执行结果自动回传 AI，形成调试→修复→测试闭环

## 🧱 架构
Chrome 扩展 ←→ `server/channel.js`（本机 HTTP，默认 `127.0.0.1:55666`）
`server/channel.js` → Claude Code（**Channel 推送**：`notifications/claude/channel`）

工具侧（可选，用于拉取/长轮询任务队列）：
Claude Code (MCP) ←→ `server/mcp.js`（`getDevToolsTask` / `waitForDevToolsTask`）

说明：
- **推荐**：用 Channel 推送后，Claude 不必高频轮询工具也能“收到事件”。
- `channel.js` 仍会写入 `server/.runtime/state.json`，因此你依然可以用 `mcp.js` 的工具做队列消费/调试。

## 🚀 快速开始（macOS）
### 1. 安装依赖
cd server
npm install

### 2. 配置 Claude Code MCP（推荐：项目级 `.mcp.json`）
你需要 **两个 MCP server 条目**（名字可自定义，但下文 `--dangerously-load-development-channels` 要与这里一致）：

```bash
claude mcp add --scope project --transport stdio devtools -- node /绝对路径/devtools-mcp-cli/server/mcp.js
claude mcp add --scope project --transport stdio devtools-channel -- node /绝对路径/devtools-mcp-cli/server/channel.js
```

重要：`.mcp.json` 里通常包含你本机的绝对路径，**开源仓库不要提交它**。建议把它当作本地文件（本仓库已在 `.gitignore` 忽略了 `.mcp.json`）。

也可以复制 `.mcp.json.example`，改成你本机路径后保存为 `.mcp.json`。

### 3. 用 Channel 启动 Claude Code（自定义 channel 需要 development flag）
Channels 属于 research preview；自建 channel 在预览期通常需要 `--dangerously-load-development-channels`（详见官方文档：[Channels reference](https://code.claude.com/docs/en/channels-reference.md)）。

示例（同时加载 channel + 工具 MCP）：

```bash
claude --dangerously-load-development-channels server:devtools-channel server:devtools
```

注意：**不要**再手动 `node server/channel.js` 起第二个进程（会端口冲突）。Claude Code 会 spawn 这个子进程并拉起其中的 HTTP 监听。

在 Claude Code 完成与该子进程的 stdio 连接之前，插件请求可能会短暂返回 `503 channel_not_ready`（重试即可）。

### 4. 安装 Chrome 扩展
1. 打开 chrome://extensions/
2. 开启开发者模式
3. 加载已解压扩展程序 → 选择 extension 文件夹

### 5. 开始使用
1. 按上一节用 `--dangerously-load-development-channels ...` 启动 `claude` 并保持会话打开
2. 页面右键元素 → 发送到 Claude CLI（事件会以 channel 形式进入会话）
3. （可选）如果你仍希望走“队列拉取”，可以让 Claude 调用 `waitForDevToolsTask` / `getDevToolsTask`
4. 或让 AI 读取 Playwright 用例并下发到浏览器执行

### 兼容：仅 HTTP 桥接（不走 Channel）
如果你暂时不想启用 channels，可以单独跑旧版 HTTP bridge（默认端口 **55667**，避免与 channel 的 **55666** 冲突）：

```bash
cd server
npm run start:http
```

同时你需要把扩展里的 `55666` 改成 `55667`（或设置环境变量 `DEVTOOLS_HTTP_PORT` 并同步扩展）。

## 🤖 AI 自动执行 Playwright 用例
让 Claude 读取你的 .spec.js 测试用例，提取操作步骤后调用：
/set-browser-test-steps

浏览器插件会自动轮询并执行：
- click
- fill
- check
- uncheck
- focus
- navigate

执行结果自动回传，AI 可自动分析、自动修复代码或用例。

## 📌 支持操作列表
- click(selector)
- fill(selector, value)
- check(selector)
- uncheck(selector)
- focus(selector)
- navigate(url)

## 📄 开源协议
MIT

---

GitHub 仓库简介：
Bidirectional DevTools bridge for Claude CLI: send prompts to AI & replay Playwright actions in browser.

GitHub Topics：
devtools,claude,claude-code,mcp,playwright,e2e,testing,automation,web-dev,chrome-extension
