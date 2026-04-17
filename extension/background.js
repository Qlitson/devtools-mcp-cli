chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "sendToCLI",
    title: "发送到 Claude CLI",
    contexts: ["all"],
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "sendToCLI") return;
  if (!tab?.id) return;
  await sendTask(tab.id, info);
});

const DEVTOOLS_HTTP_BASE = "http://127.0.0.1:55666";

const DEVTOOLS_PORT_NAME = "devtools-mcp-bridge";
const devtoolsPortsByTab = new Map();
let elementsSelectionSeq = 0;
const elementsSelectionResolvers = new Map();

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== DEVTOOLS_PORT_NAME) return;
  let boundTabId = null;
  port.onMessage.addListener((msg) => {
    if (msg?.type === "devtools_register" && typeof msg.tabId === "number") {
      boundTabId = msg.tabId;
      devtoolsPortsByTab.set(msg.tabId, port);
      return;
    }
    if (msg?.type === "elements_selection_result" && msg.id != null) {
      const resolve = elementsSelectionResolvers.get(msg.id);
      if (resolve) {
        elementsSelectionResolvers.delete(msg.id);
        resolve(msg.result);
      }
    }
  });
  port.onDisconnect.addListener(() => {
    if (boundTabId != null) {
      const current = devtoolsPortsByTab.get(boundTabId);
      if (current === port) devtoolsPortsByTab.delete(boundTabId);
    }
  });
});

function requestElementsPanelSelection(tabId) {
  const port = devtoolsPortsByTab.get(tabId);
  if (!port) return Promise.resolve(null);
  const id = ++elementsSelectionSeq;
  return new Promise((resolve) => {
    elementsSelectionResolvers.set(id, resolve);
    try {
      port.postMessage({ type: "get_elements_selection", id });
    } catch (e) {
      elementsSelectionResolvers.delete(id);
      resolve(null);
      return;
    }
    setTimeout(() => {
      if (!elementsSelectionResolvers.has(id)) return;
      elementsSelectionResolvers.delete(id);
      resolve(null);
    }, 4000);
  });
}

async function getTargetFromElementsPanel(tabId) {
  const raw = await requestElementsPanelSelection(tabId);
  if (!raw || !raw.ok || typeof raw.html !== "string" || !raw.html) return null;
  return {
    html: raw.html,
    url: typeof raw.url === "string" ? raw.url : "",
    selector: typeof raw.selector === "string" ? raw.selector : "",
    reason: raw.source || "devtools_$0",
    sourceHints: Array.isArray(raw.sourceHints) ? raw.sourceHints : [],
  };
}

function tabMessageOptions(info) {
  if (!info || info.frameId === undefined || info.frameId === null) return {};
  return { frameId: info.frameId };
}

function truncateDomForLog(html, max = 800) {
  if (typeof html !== "string") return html;
  if (html.length <= max) return html;
  return `${html.slice(0, max)}…（共 ${html.length} 字符，已截断）`;
}

async function sendTask(tabId, clickInfo = {}) {
  const msgOpts = tabMessageOptions(clickInfo);
  // 右键菜单只负责唤起输入框；DOM 一律来自 DevTools Elements 当前选中节点 $0。
  const target = await getTargetFromElementsPanel(tabId);

  const html = target?.html || "";
  if (!html) {
    await toastInPage(
      tabId,
      "未捕获到目标。请先打开该标签页的 Chrome DevTools，在 Elements 面板中选中要修改的节点（$0），再点「发送到 Claude CLI」。若已打开 DevTools，请切换一下面板或刷新扩展后重试。",
      msgOpts,
    );
    return;
  }

  // DOM 仅来自 $0；弹窗只收集 prompt。
  const promptText = await showPromptModal(tabId, "输入你的修改指令：", msgOpts);
  if (!promptText) return;

  const body = {
    dom: html,
    prompt: promptText,
    url: target?.url || "",
    selector: target?.selector || "",
    sourceHints: target?.sourceHints || [],
    clickInfo,
  };
  const logPayload = { ...body, dom: truncateDomForLog(body.dom) };
  console.log("[DevTools MCP] 发送到本地服务", logPayload);
  await chrome.tabs
    .sendMessage(tabId, {
      type: "devtools:consoleLog",
      label: "[DevTools MCP] 发送到本地服务",
      payload: logPayload,
    }, msgOpts)
    .catch(() => null);

  try {
    await fetch(`${DEVTOOLS_HTTP_BASE}/from-devtools`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    await toastInPage(tabId, "已发送到本地服务", msgOpts);
  } catch (e) {
    await toastInPage(tabId, "请先启动本地 server", msgOpts);
  }
}

async function showPromptModal(tabId, title, msgOpts = {}) {
  const response = await chrome.tabs
    .sendMessage(tabId, { type: "devtools:showPromptModal", title }, msgOpts)
    .catch(() => null);
  return response?.text || "";
}

async function toastInPage(tabId, message, msgOpts = {}) {
  await chrome.tabs
    .sendMessage(tabId, { type: "devtools:toast", message }, msgOpts)
    .catch(() => null);
}
