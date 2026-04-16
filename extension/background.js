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
  await sendTask(tab.id);
});

chrome.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg.type === "longPress" && sender?.tab?.id) await sendTask(sender.tab.id);
});

async function sendTask(tabId) {
  const target =
    (await chrome.tabs.sendMessage(tabId, { type: "devtools:getTarget" }).catch(() => null)) ||
    (await getTargetByInjectedScript(tabId));

  const html = target?.html || "";
  if (!html) {
    await alertInPage(tabId, "请先右键元素，或长按元素后再发送");
    return;
  }

  const promptText = await promptInPage(tabId, "输入你的修改指令：");
  if (!promptText) return;

  try {
    await fetch("http://localhost:55555/from-devtools", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        dom: html,
        prompt: promptText,
        url: target?.url || "",
        selector: target?.selector || "",
      }),
    });
    await alertInPage(tabId, "已发送到本地服务");
  } catch (e) {
    await alertInPage(tabId, "请先启动本地 server");
  }
}

async function promptInPage(tabId, message) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: (msg) => window.prompt(msg) || "",
    args: [message],
  });
  return result?.result || "";
}

async function alertInPage(tabId, message) {
  await chrome.scripting.executeScript({
    target: { tabId },
    func: (msg) => window.alert(msg),
    args: [message],
  });
}

async function getTargetByInjectedScript(tabId) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const target = window.__devtoolsMcpLastTarget;
      return {
        html: target?.outerHTML || "",
        url: location.href,
        selector: "",
      };
    },
  });
  return result?.result || null;
}
