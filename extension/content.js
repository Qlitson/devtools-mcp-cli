const DEVTOOLS_HTTP_BASE = "http://127.0.0.1:55666";
const STORAGE_POLL_ENABLED_KEY = "devtoolsPollStepsEnabled";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "devtools:consoleLog") {
    const label = msg.label || "[DevTools MCP]";
    if (msg.payload !== undefined) console.log(label, msg.payload);
    else console.log(label);
    sendResponse({ ok: true });
    return;
  }

  if (msg?.type === "devtools:showPromptModal") {
    (async () => {
      const title = msg.title || "输入内容";
      const out = await showSendTaskModal(title);
      if (!out.cancelled) {
        try {
          await savePollEnabled(out.pollEnabled);
          await applyPollEnabled(out.pollEnabled);
        } catch (_) {
          /* ignore */
        }
      }
      sendResponse({ text: out.cancelled ? "" : out.text });
    })();
    return true;
  }

  if (msg?.type === "devtools:toast") {
    showToast(msg.message || "");
    sendResponse({ ok: true });
    return;
  }
});

function logOutgoingToServer(label, body) {
  const payload =
    body && typeof body === "object"
      ? {
          ...body,
          dom:
            typeof body.dom === "string" && body.dom.length > 800
              ? `${body.dom.slice(0, 800)}…（共 ${body.dom.length} 字符，已截断）`
              : body.dom,
        }
      : body;
  console.log("[DevTools MCP]", label, payload);
}

function mountDevToolsUiStyles() {
  if (document.getElementById("devtools-mcp-ui-styles")) return;
  const style = document.createElement("style");
  style.id = "devtools-mcp-ui-styles";
  style.textContent = `
    .devtools-mcp-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;background:#111;color:#fff;padding:10px 14px;border-radius:10px;font-size:13px;max-width:min(560px,calc(100% - 32px));box-shadow:0 10px 30px rgba(0,0,0,.35);opacity:0;transition:opacity .18s ease}
    .devtools-mcp-toast.show{opacity:1}
    .devtools-mcp-modal{position:fixed;inset:0;z-index:2147483647;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.45);backdrop-filter:saturate(1.2) blur(2px);font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
    .devtools-mcp-modal-panel{width:min(440px,calc(100vw - 40px));max-height:min(520px,calc(100vh - 40px));overflow:auto;background:#1a1a1a;color:#eee;border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.5);border:1px solid rgba(255,255,255,.08)}
    .devtools-mcp-modal-body{padding:18px 18px 0}
    .devtools-mcp-modal-body label{display:block;font-size:12px;color:#9ca3af;margin-bottom:6px}
    .devtools-mcp-modal-body textarea{width:100%;min-height:100px;box-sizing:border-box;padding:10px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#111;color:#eee;font-size:14px;line-height:1.45;resize:vertical}
    .devtools-mcp-modal-body textarea:focus{outline:none;border-color:rgba(99,102,241,.65);box-shadow:0 0 0 2px rgba(99,102,241,.2)}
    .devtools-mcp-toggle-row{display:flex;align-items:flex-start;gap:10px;margin-top:16px;padding:12px;border-radius:8px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.06)}
    .devtools-mcp-toggle-row input{flex-shrink:0;width:18px;height:18px;margin-top:2px;accent-color:#6366f1;cursor:pointer}
    .devtools-mcp-toggle-row span{font-size:13px;line-height:1.45;color:#d1d5db}
    .devtools-mcp-toggle-row strong{color:#f3f4f6;display:block;margin-bottom:2px;font-size:13px}
    .devtools-mcp-modal-actions{display:flex;justify-content:flex-end;gap:10px;padding:16px 18px 18px}
    .devtools-mcp-modal-actions button{font-size:14px;padding:8px 16px;border-radius:8px;cursor:pointer;border:1px solid transparent}
    .devtools-mcp-btn-secondary{background:transparent;color:#d1d5db;border-color:rgba(255,255,255,.15)}
    .devtools-mcp-btn-secondary:hover{background:rgba(255,255,255,.06)}
    .devtools-mcp-btn-primary{background:#6366f1;color:#fff;border-color:#6366f1}
    .devtools-mcp-btn-primary:hover{filter:brightness(1.06)}
  `;
  document.documentElement.appendChild(style);
}

/**
 * @param {string} title
 * @returns {Promise<{ text: string, pollEnabled: boolean, cancelled: boolean }>}
 */
function showSendTaskModal(title) {
  return loadPollEnabled().then((initialPoll) => {
    return new Promise((resolve) => {
      mountDevToolsUiStyles();
      document.getElementById("devtools-mcp-modal-root")?.remove();

      const root = document.createElement("div");
      root.id = "devtools-mcp-modal-root";
      root.className = "devtools-mcp-modal";
      root.setAttribute("role", "presentation");

      const panel = document.createElement("div");
      panel.className = "devtools-mcp-modal-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");

      const body = document.createElement("div");
      body.className = "devtools-mcp-modal-body";

      const labPrompt = document.createElement("label");
      labPrompt.htmlFor = "devtools-mcp-prompt-input";
      labPrompt.textContent = "修改指令";

      const ta = document.createElement("textarea");
      ta.id = "devtools-mcp-prompt-input";
      ta.rows = 4;
      ta.placeholder = "描述你希望 AI 如何修改当前选中的 DOM…";

      const toggleRow = document.createElement("div");
      toggleRow.className = "devtools-mcp-toggle-row";

      const pollCb = document.createElement("input");
      pollCb.type = "checkbox";
      pollCb.checked = initialPoll === true;
      pollCb.id = "devtools-mcp-poll-toggle";

      const toggleText = document.createElement("span");
      const strong = document.createElement("strong");
      strong.textContent = "Claude → 浏览器";
      toggleText.appendChild(strong);
      toggleText.appendChild(
        document.createTextNode(
          " 开启后扩展会轮询本地服务并自动执行 AI 下发的页面操作步骤（测试/回放）。",
        ),
      );

      toggleRow.appendChild(pollCb);
      toggleRow.appendChild(toggleText);

      body.appendChild(labPrompt);
      body.appendChild(ta);
      body.appendChild(toggleRow);

      const actions = document.createElement("div");
      actions.className = "devtools-mcp-modal-actions";

      const btnCancel = document.createElement("button");
      btnCancel.type = "button";
      btnCancel.className = "devtools-mcp-btn-secondary";
      btnCancel.textContent = "取消";

      const btnOk = document.createElement("button");
      btnOk.type = "button";
      btnOk.className = "devtools-mcp-btn-primary";
      btnOk.textContent = "确定";

      actions.appendChild(btnCancel);
      actions.appendChild(btnOk);

      panel.appendChild(body);
      panel.appendChild(actions);
      root.appendChild(panel);
      document.documentElement.appendChild(root);

      function cleanup() {
        root.remove();
        document.removeEventListener("keydown", onKey, true);
      }

      function finish(cancelled) {
        cleanup();
        resolve({
          text: cancelled ? "" : ta.value.trim(),
          pollEnabled: !!pollCb.checked,
          cancelled,
        });
      }

      function onKey(e) {
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          finish(true);
        }
      }

      document.addEventListener("keydown", onKey, true);

      root.addEventListener("click", (e) => {
        if (e.target === root) finish(true);
      });
      panel.addEventListener("click", (e) => e.stopPropagation());

      btnCancel.addEventListener("click", () => finish(true));
      btnOk.addEventListener("click", () => finish(false));

      requestAnimationFrame(() => {
        ta.focus();
      });
    });
  });
}

async function loadPollEnabled() {
  const data = await chrome.storage.local.get(STORAGE_POLL_ENABLED_KEY);
  if (typeof data[STORAGE_POLL_ENABLED_KEY] === "boolean")
    return data[STORAGE_POLL_ENABLED_KEY];
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

// 监听页面错误
window.addEventListener("error", (e) => {
  const body = {
    type: "page_error",
    message: e.message,
    filename: e.filename,
    line: e.lineno,
    col: e.colno,
    stack: e.error?.stack,
    url: location.href,
  };
  logOutgoingToServer("上报 page_error → /from-devtools", body);
  fetch(`${DEVTOOLS_HTTP_BASE}/from-devtools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => {});
});

window.addEventListener("unhandledrejection", (e) => {
  const body = {
    type: "unhandled_rejection",
    message: String(e.reason?.message || e.reason || "unknown"),
    stack: e.reason?.stack,
    url: location.href,
  };
  logOutgoingToServer("上报 unhandledrejection → /from-devtools", body);
  fetch(`${DEVTOOLS_HTTP_BASE}/from-devtools`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
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
        if (step.action === "click") {
          const el = document.querySelector(step.selector);
          el?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
          el?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          el?.click();
          el?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        } else if (step.action === "fill") {
          const el = document.querySelector(step.selector);
          if (el) {
            el.focus?.();
            el.value = step.value || "";
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (step.action === "check") {
          const el = document.querySelector(step.selector);
          if (el) {
            el.checked = true;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (step.action === "uncheck") {
          const el = document.querySelector(step.selector);
          if (el) {
            el.checked = false;
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
          }
        } else if (step.action === "focus") {
          document.querySelector(step.selector)?.focus();
        } else if (step.action === "navigate") {
          window.location.href = step.url;
        }
        results.push({ ...step, success: true });
      } catch (e) {
        results.push({ ...step, success: false, error: e.message });
      }
    }

    console.log("[DevTools MCP] Claude→浏览器 执行结果", results);

    await fetch(`${DEVTOOLS_HTTP_BASE}/browser-test-result`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ results }),
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
  if (!Object.prototype.hasOwnProperty.call(changes, STORAGE_POLL_ENABLED_KEY))
    return;
  const next = changes[STORAGE_POLL_ENABLED_KEY].newValue;
  if (typeof next === "boolean") applyPollEnabled(next);
});
