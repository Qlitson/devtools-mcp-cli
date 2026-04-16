console.warn(
  "[devtools-mcp-cli] `server/index.js` 已拆分。请改用 `node server/mcp.js`（工具 MCP）、`node server/channel.js`（Channel + 插件 HTTP，推荐），或 `node server/http.js`（仅 HTTP 桥接，默认端口 55667）。",
);

require("./mcp");
