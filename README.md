# DevTools MCP CLI
Bidirectional DevTools bridge for Claude CLI: send prompts to AI & replay Playwright actions in browser.

One-stop workflow: debug → auto fix → auto test → auto verify.

---

# DevTools MCP CLI（中文版）
DevTools ↔ 本地服务 ↔ Claude CLI 双向打通
页面发指令给 AI，AI 下发操作到浏览器自动执行
支持 Playwright 风格操作在真实浏览器中回放

## ✨ 功能特性
- 右键 / 长按页面元素，一键发送需求给 Claude CLI
- 自动监听页面报错，上传给 AI 自动分析修复
- AI 可将 Playwright E2E 用例转为操作步骤，浏览器直接执行
- 支持 click / fill / check / navigate 等标准操作
- 执行结果自动回传 AI，形成调试→修复→测试闭环

## 🧱 架构
Chrome 扩展 ←→ 本地 Node 服务 ←→ Claude CLI (MCP)

## 🚀 快速开始（macOS）
### 1. 安装依赖
cd server
npm install

### 2. 配置 Claude Code MCP（推荐：项目级 `.mcp.json`）
推荐用命令行配置（会在项目根目录生成/更新 `.mcp.json`）：

```bash
claude mcp add --scope project --transport stdio devtools -- node /绝对路径/devtools-mcp-cli/server/index.js
```

重要：`.mcp.json` 里通常包含你本机的绝对路径，**开源仓库不要提交它**。建议把它当作本地文件（本仓库已在 `.gitignore` 忽略了 `.mcp.json`）。

也可以复制 `.mcp.json.example`，改成你本机路径后保存为 `.mcp.json`：

```json
{
  "mcpServers": {
    "devtools": {
      "command": "node",
      "args": ["/绝对路径/devtools-mcp-cli/server/index.js"]
    }
  }
}
```

提示：这个 MCP server 进程会同时启动 HTTP 服务（默认 `http://127.0.0.1:55666`），所以**不要再单独**运行 `node server/index.js`，否则会端口冲突。

### 3. 安装 Chrome 扩展
1. 打开 chrome://extensions/
2. 开启开发者模式
3. 加载已解压扩展程序 → 选择 extension 文件夹

### 4. 开始使用
1. 终端运行：claude
2. 对 Claude 说：持续调用 getDevToolsTask，有指令自动修改代码
3. 页面右键元素 → 发送到 Claude CLI
4. 或让 AI 读取 Playwright 用例并下发到浏览器执行

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
