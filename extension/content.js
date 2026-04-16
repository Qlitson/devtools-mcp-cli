let pressTimer;
let targetEl;

const DEVTOOLS_HTTP_BASE = "http://127.0.0.1:55555";

document.addEventListener("mousedown", startPress);
document.addEventListener("touchstart", startPress);
document.addEventListener("mouseup", clearPress);
document.addEventListener("touchend", clearPress);
document.addEventListener("mouseleave", clearPress);
document.addEventListener("touchmove", clearPress);

function startPress(e) {
  clearPress();
  targetEl = e.target;
  pressTimer = setTimeout(() => {
    window.__devtoolsMcpLastTarget = targetEl;
    chrome.runtime.sendMessage({ type: "longPress" });
  }, 600);
}

function clearPress() {
  clearTimeout(pressTimer);
}

document.addEventListener("contextmenu", (e) => {
  window.__devtoolsMcpLastTarget = e.target;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== "devtools:getTarget") return;
  const el = window.__devtoolsMcpLastTarget;
  sendResponse({
    html: el?.outerHTML || "",
    url: location.href,
    selector: el ? buildSelector(el) : "",
  });
});

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
async function pollAndRunTestSteps() {
  try {
    const res = await fetch(`${DEVTOOLS_HTTP_BASE}/get-browser-test-steps`);
    const steps = await res.json();
    if (!steps || steps.length === 0) return;

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
  } catch (err) {}
}

setInterval(pollAndRunTestSteps, 1500);
