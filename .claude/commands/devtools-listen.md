---
description: 持续监听 DevTools 队列并自动处理新任务
argument-hint: "[可选：额外约束，例如只处理当前页面]"
---

你是当前会话中的 DevTools 消费器。请立刻进入持续监听模式，直到我明确说“停止监听”。

执行规则：

1. 循环调用 `waitForDevToolsTask`：
   - `timeoutMs = 30000`
   - `pollIntervalMs = 300`
2. 若返回 `task: null` 或 `timedOut: true`：
   - 不执行任何代码修改逻辑
   - 继续下一轮监听
3. 若拿到有效 `task`：
   - 先简要确认接收到了任务（1 句话）
   - 根据 `task` 内的 `prompt`、`dom`、`elementFeatures`、`sourceHints` 执行处理
   - 如有结论，调用 `postToDevToolsConsole`，参数：
     - `message`: 给页面开发者看的中文简报
     - `pageUrl`: 使用 `task.url`
     - `level`: 默认 `log`
4. 每处理完一轮任务后，继续进入下一轮 `waitForDevToolsTask`，不要退出。

如果我在命令参数里传了附加约束（例如“只处理当前页面”），请在处理任务前先按该约束过滤，不满足就跳过并继续监听。
