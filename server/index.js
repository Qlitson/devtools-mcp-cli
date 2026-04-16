console.warn(
  "[devtools-mcp-cli] `server/index.js` 已拆分。请改用 `node server/mcp.js` (Claude MCP) 和 `node server/http.js` (浏览器桥接)。",
);

require("./mcp");
