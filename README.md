# DevTools MCP CLI
Bidirectional DevTools bridge for Claude CLI: send prompts to AI & replay Playwright actions in browser.

One-stop workflow: debug → auto fix → auto test → auto verify.

Supports two integrations: **Channels push** (`server/channel.js`, default `127.0.0.1:55666`) and **HTTP bridge + MCP polling** (`server/http.js`, default `127.0.0.1:55667` + `server/mcp.js`).

---

# DevTools MCP CLI（中文版）
DevTools ↔ 本地服务 ↔ Claude CLI 双向打通
页面发指令给 AI，AI 下发操作到浏览器自动执行
支持 Playwright 风格操作在真实浏览器中回放

## ✨ 功能特性
- 在 Chrome DevTools 的 Elements 中选中节点（`$0`），再通过右键菜单唤起输入框，一键发送需求给 Claude CLI
- 自动监听页面报错，上传给 AI 自动分析修复
- AI 可将 Playwright E2E 用例转为操作步骤，浏览器直接执行
- 支持 click / fill / check / navigate 等标准操作
- 执行结果自动回传 AI，形成调试→修复→测试闭环

## 🧱 架构（两种模式，二选一）
本仓库同时支持：

| 模式 | 浏览器扩展连接 | Claude Code 侧 | 适合人群 |
| --- | --- | --- | --- |
| **A. Channel 推送（推荐，若可用）** | `http://127.0.0.1:55666`（`server/channel.js` 内置 HTTP） | `server/channel.js` 通过 `notifications/claude/channel` 推送事件到会话 | 想要“事件驱动”，减少工具轮询 |
| **B. HTTP Bridge + MCP 拉取（兼容性最好）** | `http://127.0.0.1:55667`（`server/http.js`） | `server/mcp.js` 提供 `getDevToolsTask` / `waitForDevToolsTask` 从 `server/.runtime/state.json` 取任务 | 外部模型/API 计费、或组织禁用 Channels |

补充：
- `channel.js` 在推送的同时也会写入 `server/.runtime/state.json`，因此 **A 模式也可以并行使用 `mcp.js` 的工具**做队列消费/调试。
- **不要同时**让 `channel.js` 与 `http.js` 监听同一个端口（默认分别是 `55666` / `55667`）。

## 🚀 快速开始（macOS）
### 1. 安装依赖
cd server
npm install

### 2. 配置 Claude Code MCP（推荐：项目级 `.mcp.json`）
至少配置工具 MCP（模式 B 必需；模式 A 也建议保留，便于调试/拉取）：

```bash
claude mcp add --scope project --transport stdio devtools -- node /绝对路径/devtools-mcp-cli/server/mcp.js
```

如果你要走 **模式 A（Channel）**，再额外添加 channel MCP：

```bash
claude mcp add --scope project --transport stdio devtools-channel -- node /绝对路径/devtools-mcp-cli/server/channel.js
```

重要：`.mcp.json` 里通常包含你本机的绝对路径，**开源仓库不要提交它**。建议把它当作本地文件（本仓库已在 `.gitignore` 忽略了 `.mcp.json`）。

也可以复制 `.mcp.json.example`，改成你本机路径后保存为 `.mcp.json`。

### 3. 选择一种使用方式

#### 模式 A：Channel 推送（事件进会话）
前置说明（很重要）：

- Channels 属于 **research preview**，并且与你的 **Claude Code 登录/计费路径**强相关。官方文档对 Channels 的前置与限制有集中说明：[Push events into a running session with channels](https://code.claude.com/docs/en/channels.md)。
- 如果你看到启动提示类似 **`Channels are not currently available`**，且 `--dangerously-load-development-channels` 被 **ignored**：通常表示 **当前会话环境不支持 Channels**（常见是外部模型/API 计费形态、或组织策略禁用等）。此时请改用 **模式 B**。

自定义 channel 在预览期通常还需要 `--dangerously-load-development-channels`（详见：[Channels reference](https://code.claude.com/docs/en/channels-reference.md)）。

示例（同时加载 channel + 工具 MCP；`server:` 名字必须与你 `.mcp.json` 里的 key 一致）：

```bash
claude --dangerously-load-development-channels server:devtools-channel server:devtools
```

注意：**不要**再手动 `node server/channel.js` 起第二个进程（会端口冲突）。Claude Code 会 spawn 这个子进程并拉起其中的 HTTP 监听。

在 Claude Code 完成与该子进程的 stdio 连接之前，部分写请求可能会短暂返回 `503 channel_not_ready`（重试即可）。健康检查：

`http://127.0.0.1:55666/channel-health`

#### 模式 B：HTTP Bridge + MCP 拉取（兼容性最好）

非 Channels 时，浏览器只和 **HTTP bridge** 说话；Claude 通过 **MCP 子进程**（`server/mcp.js`）读写同一份 `server/.runtime/state.json` 里的队列。需要 **两个东西同时就绪**：本机 HTTP + 已连接 MCP 的 Claude 会话。

1. **先起 HTTP bridge**（扩展 `POST /from-devtools` 写到这里，默认 `127.0.0.1:55667`）：

```bash
cd server
npm run start:http
```

2. **再「激活」Claude Code（加载本仓库的 MCP）**  
   - 在**已配置好**上一节「2. 配置 Claude Code MCP」里那条 `claude mcp add ... server/mcp.js` 的项目目录打开终端（或确保 **project** 作用域的 MCP 指向本仓库的 `mcp.js`）。  
   - 普通启动即可，**不要**加 `--dangerously-load-development-channels`（模式 B 与 Channels 无关）：

```bash
claude
```

   - 进入会话后，确认工具列表里能看到 **`getDevToolsTask`** / **`waitForDevToolsTask`**（说明 `mcp.js` 已由 Claude Code 拉起并连上）。若看不到，检查当前目录是否是该 MCP 所在项目、或 `claude mcp list` 是否包含 `devtools`。

3. **让 Claude 真正开始消费队列**（否则扩展写入的任务会一直积在 `state.json`）：在对话里明确要求它**反复或阻塞式**调用 MCP，例如：

   - 单次查看：`请调用 getDevToolsTask，若有任务则根据其中的 dom / prompt 处理。`  
   - 持续拉取（更贴近「激活监听」）：`请在一个循环里多次调用 waitForDevToolsTask（例如 timeout 30s、间隔 300ms），直到取到来自浏览器的任务再回复我；之后若我继续在网页里发送，请继续用同样方式拉取。`  
   - **收尾**：每处理完一轮浏览器相关任务（含分析 `dom`、调用 `/set-browser-test-steps`、阅读执行结果等）后，调用 MCP 工具 **`clearDevToolsBridge`**，清空 `lastTask` 与待执行步骤队列，避免下次 `getDevToolsTask` / `waitForDevToolsTask` 读到陈旧数据。

   也可把上述约定写进项目根 **`CLAUDE.md`** 或 **Cursor/Claude 项目规则**，这样每次开会话不必手动重复说明。

4. **同步扩展端口**：本仓库扩展默认连接 `55666`（为模式 A 预留）。走模式 B 时，请把扩展里的 `55666` 改为 `55667`（或自行统一端口并同时改 `server/http.js` / 扩展 / manifest）。

说明：一般**不需要**再单独终端跑 `npm run start:mcp`——Claude Code 启动会话时会自动 spawn `mcp.js`。仅在你想脱离 Claude、单独调试 MCP 时才手动跑 `start:mcp`。

### 4. 安装 Chrome 扩展
1. 打开 chrome://extensions/
2. 开启开发者模式
3. 加载已解压扩展程序 → 选择 extension 文件夹

### 5. 开始使用
- **模式 A**：保持按 `--dangerously-load-development-channels ...` 启动的会话打开；网页右键发送到 Claude。
- **模式 B**：保持 `npm run start:http` 运行；在本仓库目录用 `claude` 激活会话并确认已加载 `devtools` MCP；按上节说明让模型调用 `waitForDevToolsTask`/`getDevToolsTask` 消费队列；网页右键发送到本地队列。

（可选）让 AI 读取 Playwright 用例并下发到浏览器执行。

## 🤖 AI 自动执行 Playwright 用例
让 Claude 读取你的 .spec.js 测试用例，提取操作步骤后调用：
/set-browser-test-steps

浏览器插件可按需执行 AI 下发的页面操作（**Claude → 浏览器方向默认关闭**；右键发送时在页面内弹窗中填写指令，并在同一弹窗内切换「Claude → 浏览器」开关；开启后扩展才会向本地服务拉取并执行步骤）：
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
