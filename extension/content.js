const DEVTOOLS_HTTP_BASE = "http://127.0.0.1:55666";
const STORAGE_POLL_ENABLED_KEY = "devtoolsPollStepsEnabled";
let lastContextTarget = null;
let lastPointerTarget = null;
let lastPointer = null;

document.addEventListener("mousedown", (e) => {
  lastPointerTarget = e.target;
  lastPointer = { x: e.clientX, y: e.clientY };
});

document.addEventListener("contextmenu", (e) => {
  lastContextTarget = e.target;
  lastPointer = { x: e.clientX, y: e.clientY };
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "devtools:getTarget") {
    const el = resolveCapturedElement();
    sendResponse({
      html: el?.outerHTML || "",
      url: location.href,
      selector: el ? buildSelector(el) : "",
      reason: el ? "captured" : "none",
    });
    return;
  }

  if (msg?.type === "devtools:showPromptModal") {
    showPromptModalUI(msg.title || "输入内容")
      .then((text) => sendResponse({ text }))
      .catch(() => sendResponse({ text: "" }));
    return true;
  }

  if (msg?.type === "devtools:toast") {
    showToast(msg.message || "");
    sendResponse({ ok: true });
    return;
  }
});

function resolveCapturedElement() {
  if (lastContextTarget instanceof Element) return lastContextTarget;
  if (lastPointerTarget instanceof Element) return lastPointerTarget;
  if (lastPointer) {
    const pointed = document.elementFromPoint(lastPointer.x, lastPointer.y);
    if (pointed instanceof Element) return pointed;
  }
  if (document.activeElement instanceof Element && document.activeElement !== document.body) {
    return document.activeElement;
  }
  return null;
}

function buildSelector(el) {
  if (!(el instanceof Element)) return "";
  if (el.id) return `#${cssEscape(el.id)}`;

  const parts = [];
  let node = el;
  while (node && node.nodeType === 1 && parts.length < 6) {
    let part = node.tagName.toLowerCase();
    const className = (node.getAttribute("class") || "").trim();
    if (className) {
      const cls = className.split(/\s+/).filter(Boolean).slice(0, 2);
      if (cls.length) part += "." + cls.map(cssEscape).join(".");
    }
    const parent = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c) => c.tagName === node.tagName,
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(node) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    if (node.tagName.toLowerCase() === "html") break;
    node = node.parentElement;
  }
  return parts.join(" > ");
}

function cssEscape(value) {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\\$&");
}

function mountDevToolsUiStyles() {
  if (document.getElementById("devtools-mcp-ui-styles")) return;
  const style = document.createElement("style");
  style.id = "devtools-mcp-ui-styles";
  style.textContent = `
    .devtools-mcp-overlay{position:fixed;inset:0;background:rgba(0,0,0,.45);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif}
    .devtools-mcp-modal{width:min(560px,100%);background:#fff;color:#111;border-radius:12px;box-shadow:0 18px 60px rgba(0,0,0,.35);overflow:hidden}
    .devtools-mcp-modal header{padding:14px 16px;border-bottom:1px solid #eee;font-weight:600;font-size:14px}
    .devtools-mcp-modal main{padding:14px 16px}
    .devtools-mcp-modal footer{padding:12px 16px;border-top:1px solid #eee;display:flex;gap:10px;justify-content:flex-end;align-items:center;flex-wrap:wrap}
    .devtools-mcp-row{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:10px 0 12px}
    .devtools-mcp-row label{font-size:13px;color:#333}
    .devtools-mcp-switch{position:relative;width:44px;height:24px;flex:0 0 auto}
    .devtools-mcp-switch input{opacity:0;width:0;height:0}
    .devtools-mcp-slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#cfd6df;transition:.2s;border-radius:999px}
    .devtools-mcp-slider:before{position:absolute;content:"";height:18px;width:18px;left:3px;top:3px;background:#fff;transition:.2s;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.2)}
    .devtools-mcp-switch input:checked + .devtools-mcp-slider{background:#2b6cff}
    .devtools-mcp-switch input:checked + .devtools-mcp-slider:before{transform:translateX(20px)}
    .devtools-mcp-hint{font-size:12px;color:#666;line-height:1.4}
    .devtools-mcp-textarea{width:100%;min-height:120px;resize:vertical;padding:10px 12px;border:1px solid #d7d7d7;border-radius:10px;font-size:13px;line-height:1.45;outline:none}
    .devtools-mcp-textarea:focus{border-color:#2b6cff;box-shadow:0 0 0 3px rgba(43,108,255,.15)}
    .devtools-mcp-btn{border:0;border-radius:10px;padding:9px 14px;font-size:13px;cursor:pointer}
    .devtools-mcp-btn.secondary{background:#f2f4f7;color:#111}
    .devtools-mcp-btn.primary{background:#2b6cff;color:#fff}
    .devtools-mcp-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;background:#111;color:#fff;padding:10px 14px;border-radius:10px;font-size:13px;max-width:min(560px,calc(100% - 32px));box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:0;transition:opacity .18s ease}
    .devtools-mcp-toast.show{opacity:1}
  `;
  document.documentElement.appendChild(style);
}

async function loadPollEnabled() {
  const data = await chrome.storage.local.get(STORAGE_POLL_ENABLED_KEY);
  if (typeof data[STORAGE_POLL_ENABLED_KEY] === "boolean") return data[STORAGE_POLL_ENABLED_KEY];
  return false;
}

async function savePollEnabled(enabled) {
  await chrome.storage.local.set({ [STORAGE_POLL_ENABLED_KEY]: !!enabled });
}

function showToast(message) {
  mountDevToolsUiStyles();
  const el = document.createElement("div");
  el.className = "devtools-mcp-toast";
  el.textContent = message;
  document.documentElement.appendChild(el);
  requestAnimationFrame(() => el.classList.add("show"));
  setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => el.remove(), 200);
  }, 2200);
}

function showPromptModalUI(title) {
  mountDevToolsUiStyles();

  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "devtools-mcp-overlay";

    const modal = document.createElement("div");
    modal.className = "devtools-mcp-modal";

    const header = document.createElement("header");
    header.textContent = title;

    const main = document.createElement("main");
    const textarea = document.createElement("textarea");
    textarea.className = "devtools-mcp-textarea";
    textarea.placeholder = "例如：把这个按钮改成禁用态，并补充埋点…";

    const row = document.createElement("div");
    row.className = "devtools-mcp-row";

    const label = document.createElement("label");
    label.textContent = "是否开启 Claude 到浏览器方向的通信";

    const swWrap = document.createElement("label");
    swWrap.className = "devtools-mcp-switch";
    const swInput = document.createElement("input");
    swInput.type = "checkbox";
    const swSlider = document.createElement("span");
    swSlider.className = "devtools-mcp-slider";
    swWrap.appendChild(swInput);
    swWrap.appendChild(swSlider);

    row.appendChild(label);
    row.appendChild(swWrap);

    const hint = document.createElement("div");
    hint.className = "devtools-mcp-hint";
    hint.textContent =
      "关闭时不会向本地服务拉取待执行步骤，Claude 无法通过本路径驱动当前页。需要 AI 下发点击、填写等操作到浏览器时再打开；默认关闭以减少后台请求。";

    main.appendChild(textarea);
    main.appendChild(row);
    main.appendChild(hint);

    const footer = document.createElement("footer");
    const cancel = document.createElement("button");
    cancel.className = "devtools-mcp-btn secondary";
    cancel.type = "button";
    cancel.textContent = "取消";

    const ok = document.createElement("button");
    ok.className = "devtools-mcp-btn primary";
    ok.type = "button";
    ok.textContent = "发送";

    footer.appendChild(cancel);
    footer.appendChild(ok);

    modal.appendChild(header);
    modal.appendChild(main);
    modal.appendChild(footer);
    overlay.appendChild(modal);
    document.documentElement.appendChild(overlay);

    const close = (value) => {
      overlay.remove();
      resolve(value);
    };

    const onKey = (e) => {
      if (e.key === "Escape") close("");
    };

    loadPollEnabled().then((enabled) => {
      swInput.checked = !!enabled;
    });

    swInput.addEventListener("change", async () => {
      await savePollEnabled(swInput.checked);
      await applyPollEnabled(swInput.checked);
    });

    cancel.addEventListener("click", () => close(""));
    ok.addEventListener("click", () => close(textarea.value.trim()));
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close("");
    });

    window.addEventListener("keydown", onKey);

    setTimeout(() => textarea.focus(), 0);

    overlay.addEventListener(
      "remove",
      () => {
        window.removeEventListener("keydown", onKey);
      },
      { once: true },
    );
  });
}

// 监听页面错误
window.addEventListener('error', (e) => {
  fetch(`${DEVTOOLS_HTTP_BASE}/from-devtools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'page_error',
      message: e.message,
      filename: e.filename,
      line: e.lineno,
      col: e.colno,
      stack: e.error?.stack,
      url: location.href
    })
  }).catch(() => {});
});

window.addEventListener('unhandledrejection', (e) => {
  fetch(`${DEVTOOLS_HTTP_BASE}/from-devtools`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'unhandled_rejection',
      message: String(e.reason?.message || e.reason || 'unknown'),
      stack: e.reason?.stack,
      url: location.href
    })
  }).catch(() => {});
});

// Claude → 浏览器：轮询并执行 AI 下发的测试步骤（由浮层开关控制）
const POLL_INTERVAL_ACTIVE_MS = 8000;
const POLL_INTERVAL_HIDDEN_MS = 30000;
const POLL_BACKOFF_MAX_MS = 120000;
const POLL_IDLE_SLOW_AFTER = 8;
const POLL_IDLE_SLOW_FACTOR = 3;
const POLL_IDLE_MAX_MS = 120000;
let pollTimer = null;
let isPolling = false;
let failureCount = 0;
let emptyPollStreak = 0;
let pollStepsEnabled = false;

async function applyPollEnabled(enabled) {
  pollStepsEnabled = !!enabled;
  if (!pollStepsEnabled) {
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = null;
    isPolling = false;
    failureCount = 0;
    emptyPollStreak = 0;
    return;
  }
  scheduleNextPoll(300);
}

function getBaseInterval() {
  if (!navigator.onLine) return POLL_INTERVAL_HIDDEN_MS;
  return document.hidden ? POLL_INTERVAL_HIDDEN_MS : POLL_INTERVAL_ACTIVE_MS;
}

function getNextPollDelay({ hadSteps } = { hadSteps: false }) {
  const base = getBaseInterval();
  if (failureCount > 0) {
    const backoff = base * Math.pow(2, failureCount);
    return Math.min(backoff, POLL_BACKOFF_MAX_MS);
  }
  if (!hadSteps && emptyPollStreak >= POLL_IDLE_SLOW_AFTER) {
    const slowed = base * POLL_IDLE_SLOW_FACTOR;
    return Math.min(slowed, POLL_IDLE_MAX_MS);
  }
  return base;
}

function scheduleNextPoll(delay = getNextPollDelay()) {
  if (!pollStepsEnabled) return;
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = setTimeout(runPollLoop, delay);
}

async function pollAndRunTestSteps() {
  try {
    const res = await fetch(`${DEVTOOLS_HTTP_BASE}/get-browser-test-steps`);
    if (!res.ok) {
      throw new Error(`poll_failed_${res.status}`);
    }
    const steps = await res.json();
    if (!steps || steps.length === 0) return false;

    const results = [];
    for (const step of steps) {
      try {
        if (step.action === 'click') {
          const el = document.querySelector(step.selector);
          el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          el?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          el?.click();
          el?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        } else if (step.action === 'fill') {
          const el = document.querySelector(step.selector);
          if (el) {
            el.focus?.();
            el.value = step.value || '';
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (step.action === 'check') {
          const el = document.querySelector(step.selector);
          if (el) {
            el.checked = true;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (step.action === 'uncheck') {
          const el = document.querySelector(step.selector);
          if (el) {
            el.checked = false;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (step.action === 'focus') {
          document.querySelector(step.selector)?.focus();
        } else if (step.action === 'navigate') {
          window.location.href = step.url;
        }
        results.push({ ...step, success: true });
      } catch (e) {
        results.push({ ...step, success: false, error: e.message });
      }
    }

    console.log("[DevTools MCP] Claude→浏览器 执行结果", results);

    await fetch(`${DEVTOOLS_HTTP_BASE}/browser-test-result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results })
    });
    return true;
  } catch (err) {
    throw err;
  }
}

async function runPollLoop() {
  if (!pollStepsEnabled) return;
  if (isPolling) return;
  if (!navigator.onLine) {
    scheduleNextPoll(POLL_INTERVAL_HIDDEN_MS);
    return;
  }

  isPolling = true;
  try {
    const hadSteps = await pollAndRunTestSteps();
    failureCount = 0;
    if (hadSteps) {
      emptyPollStreak = 0;
    } else {
      emptyPollStreak += 1;
    }
    scheduleNextPoll(getNextPollDelay({ hadSteps }));
  } catch (err) {
    failureCount += 1;
    emptyPollStreak += 1;
    scheduleNextPoll(getNextPollDelay({ hadSteps: false }));
  } finally {
    isPolling = false;
  }
}

document.addEventListener("visibilitychange", () => {
  if (!pollStepsEnabled) return;
  scheduleNextPoll(getNextPollDelay());
});

window.addEventListener("online", () => {
  if (!pollStepsEnabled) return;
  failureCount = 0;
  scheduleNextPoll(300);
});

window.addEventListener("offline", () => {
  if (!pollStepsEnabled) return;
  scheduleNextPoll(POLL_INTERVAL_HIDDEN_MS);
});

loadPollEnabled()
  .then((enabled) => applyPollEnabled(enabled))
  .catch(() => applyPollEnabled(false));

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") return;
  if (!Object.prototype.hasOwnProperty.call(changes, STORAGE_POLL_ENABLED_KEY)) return;
  const next = changes[STORAGE_POLL_ENABLED_KEY].newValue;
  if (typeof next === "boolean") applyPollEnabled(next);
});
