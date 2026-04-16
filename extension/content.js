const DEVTOOLS_HTTP_BASE = "http://127.0.0.1:55666";
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
  if (msg?.type !== "devtools:getTarget") return;
  const el = resolveCapturedElement();
  sendResponse({
    html: el?.outerHTML || "",
    url: location.href,
    selector: el ? buildSelector(el) : "",
    reason: el ? "captured" : "none",
  });
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

// 轮询执行 AI 下发的测试步骤
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
  scheduleNextPoll(getNextPollDelay());
});

window.addEventListener("online", () => {
  failureCount = 0;
  scheduleNextPoll(300);
});

window.addEventListener("offline", () => {
  scheduleNextPoll(POLL_INTERVAL_HIDDEN_MS);
});

runPollLoop();
