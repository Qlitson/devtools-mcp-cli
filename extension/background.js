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

async function sendTask(tabId, clickInfo = {}) {
  const target =
    (await chrome.tabs.sendMessage(tabId, { type: "devtools:getTarget" }).catch(() => null)) ||
    (await getTargetByInjectedScript(tabId));

  const html = target?.html || "";
  if (!html) {
    await toastInPage(
      tabId,
      "未捕获到目标元素。请在页面内容区域右键元素后，再点“发送到 Claude CLI”。",
    );
    return;
  }

  const promptText = await showPromptModal(tabId, "输入你的修改指令：");
  if (!promptText) return;

  try {
    await fetch(`${DEVTOOLS_HTTP_BASE}/from-devtools`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dom: html,
        prompt: promptText,
        url: target?.url || "",
        selector: target?.selector || "",
        clickInfo,
      }),
    });
    await toastInPage(tabId, "已发送到本地服务");
  } catch (e) {
    await toastInPage(tabId, "请先启动本地 server");
  }
}

async function showPromptModal(tabId, title) {
  const response = await chrome.tabs
    .sendMessage(tabId, { type: "devtools:showPromptModal", title })
    .catch(() => null);
  return response?.text || "";
}

async function toastInPage(tabId, message) {
  await chrome.tabs
    .sendMessage(tabId, { type: "devtools:toast", message })
    .catch(() => null);
}

async function getTargetByInjectedScript(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const target = document.activeElement;
      return {
        html: target?.outerHTML || "",
        url: location.href,
        selector: "",
        reason: "injected_fallback",
      };
    },
  });
  return result?.result || null;
}
