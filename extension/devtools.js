/**
 * DevTools 扩展页：通过 chrome.devtools.inspectedWindow.eval 读取 Elements 面板
 * 当前选中节点 $0（官方说明 eval 上下文包含控制台 API，可使用 $0）。
 * 另外在 Elements 的 onSelectionChanged 时缓存快照，供「即时 $0 读不到」时回退。
 * @see https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow
 */

const PORT_NAME = "devtools-mcp-bridge";
const SNAPSHOT_MAX_AGE_MS = 120_000;

/** @type {{ ok: boolean, html: string, url: string, ts: number } | null} */
let lastSelectionSnapshot = null;

function buildDollar0EvalExpression() {
  return `(function () {
  try {
    var el = typeof $0 !== "undefined" ? $0 : null;
    if (!el || el.nodeType !== 1) {
      return { ok: false, reason: "no_$0" };
    }
    return {
      ok: true,
      html: el.outerHTML,
      url: String(location.href || ""),
      selector: "",
      source: "devtools_$0",
    };
  } catch (e) {
    return { ok: false, reason: String(e && e.message ? e.message : e) };
  }
})()`;
}

function evalDollar0(callback) {
  chrome.devtools.inspectedWindow.eval(buildDollar0EvalExpression(), callback);
}

function rememberSnapshotFromResult(result) {
  if (!result || !result.ok || typeof result.html !== "string" || !result.html) return;
  lastSelectionSnapshot = {
    ok: true,
    html: result.html,
    url: typeof result.url === "string" ? result.url : "",
    ts: Date.now(),
  };
}

function refreshSelectionSnapshot() {
  evalDollar0((result, exceptionInfo) => {
    if (chrome.runtime.lastError) return;
    if (exceptionInfo && (exceptionInfo.isException || exceptionInfo.isError)) return;
    rememberSnapshotFromResult(result);
  });
}

if (chrome.devtools?.panels?.elements?.onSelectionChanged) {
  chrome.devtools.panels.elements.onSelectionChanged.addListener(() => {
    refreshSelectionSnapshot();
  });
}
refreshSelectionSnapshot();

const tabId = chrome.devtools.inspectedWindow.tabId;

/** @type {chrome.runtime.Port | null} */
let bridgePort = null;

/**
 * MV3 service worker 休眠会断开 Port，background 里 devtoolsPortsByTab 也会被清空；
 * 不重连时「发送到 Claude CLI」会拿不到 $0，只能误用页面右键坐标。
 */
function replySelection(requestId, result) {
  if (!bridgePort) return;
  try {
    bridgePort.postMessage({
      type: "elements_selection_result",
      id: requestId,
      result,
    });
  } catch (_) {
    /* port 可能已失效 */
  }
}

function onGetElementsSelectionMessage(msg) {
  if (msg?.type !== "get_elements_selection" || msg.id == null) return;

  evalDollar0((result, exceptionInfo) => {
    if (chrome.runtime.lastError) {
      tryFallbackSnapshot(msg.id, String(chrome.runtime.lastError.message));
      return;
    }
    if (exceptionInfo && (exceptionInfo.isError || exceptionInfo.isException)) {
      tryFallbackSnapshot(
        msg.id,
        exceptionInfo.description || "eval_exception",
      );
      return;
    }
    const normalized =
      result && typeof result === "object"
        ? result
        : { ok: false, reason: "bad_eval_result" };

    if (normalized.ok && normalized.html) {
      rememberSnapshotFromResult(normalized);
      replySelection(msg.id, normalized);
      return;
    }

    tryFallbackSnapshot(msg.id, normalized.reason || "no_$0");
  });
}

function connectBridge() {
  bridgePort = chrome.runtime.connect({ name: PORT_NAME });
  bridgePort.postMessage({ type: "devtools_register", tabId });
  bridgePort.onMessage.addListener(onGetElementsSelectionMessage);
  bridgePort.onDisconnect.addListener(() => {
    bridgePort = null;
    setTimeout(connectBridge, 300);
  });
}

connectBridge();

function tryFallbackSnapshot(requestId, liveReason) {
  const snap = lastSelectionSnapshot;
  if (
    snap &&
    snap.ok &&
    snap.html &&
    Date.now() - snap.ts < SNAPSHOT_MAX_AGE_MS
  ) {
    replySelection(requestId, {
      ok: true,
      html: snap.html,
      url: snap.url || "",
      selector: "",
      source: "devtools_$0_snapshot",
    });
    return;
  }
  replySelection(requestId, {
    ok: false,
    reason: liveReason || "no_$0",
  });
}
