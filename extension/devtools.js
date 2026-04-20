/**
 * DevTools 扩展页：通过 chrome.devtools.inspectedWindow.eval 读取 Elements 面板
 * 当前选中节点 $0（官方说明 eval 上下文包含控制台 API，可使用 $0）。
 * 另外在 Elements 的 onSelectionChanged 时缓存快照，供「即时 $0 读不到」时回退。
 * @see https://developer.chrome.com/docs/extensions/reference/api/devtools/inspectedWindow
 */

const PORT_NAME = "devtools-mcp-bridge";
const SNAPSHOT_MAX_AGE_MS = 120_000;

/** @type {{ ok: boolean, elementFeatures: object, url: string, ts: number, sourceHints?: unknown[] } | null} */
let lastSelectionSnapshot = null;

/**
 * 在页面主世界执行：只收集「元素特征」与源码线索，不传整段 DOM 文本。
 * 说明：Source Map 只映射「打包 JS 行列 → 源码行列」，无法从任意 DOM 反查文件；
 * 开发模式下 React / Vue2 / Vue3 会在内部结构里挂源码路径（不等同于解析 .map 文件）。
 */
function buildDollar0EvalExpression() {
  return `(function () {
  try {
    var el = typeof $0 !== "undefined" ? $0 : null;
    if (!el || el.nodeType !== 1) {
      return { ok: false, reason: "no_$0" };
    }
    var sourceHints = [];
    (function collectReactDebugSource(dom) {
      var keys = Object.keys(dom);
      var i, k, fiber, depth, src, tname;
      for (i = 0; i < keys.length; i++) {
        k = keys[i];
        if (k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0) {
          fiber = dom[k];
          depth = 0;
          while (fiber && depth < 48) {
            src = fiber._debugSource;
            if (src && src.fileName) {
              tname = "";
              try {
                if (fiber.type) {
                  if (typeof fiber.type === "function" && fiber.type.name) {
                    tname = String(fiber.type.name);
                  } else if (typeof fiber.type === "string") {
                    tname = fiber.type;
                  }
                }
              } catch (ignored) {}
              sourceHints.push({
                kind: "react_debugSource",
                componentName: tname,
                fileName: String(src.fileName),
                lineNumber: Number(src.lineNumber) || 0,
                columnNumber: Number(src.columnNumber) || 0,
              });
              return;
            }
            fiber = fiber.return;
            depth++;
          }
          return;
        }
      }
    })(el);
    (function collectVue3SfcFile(dom) {
      try {
        var vm = dom.__vueParentComponent;
        if (!vm) return;
        var def = vm.type;
        var file = def && def.__file;
        if (file) {
          sourceHints.push({
            kind: "vue_sfc",
            fileName: String(file),
            componentName: def.name ? String(def.name) : "",
          });
        }
      } catch (ignored) {}
    })(el);
    (function collectVue2SfcFile(dom) {
      try {
        var cur = dom;
        var depth = 0;
        while (cur && depth < 60) {
          var vm = cur.__vue__;
          if (vm) {
            var walk = vm;
            var w = 0;
            while (walk && w < 40) {
              var opt = walk.$options;
              var file = opt && opt.__file;
              if (file) {
                var cname = "";
                if (opt.name) cname = String(opt.name);
                else if (opt._componentTag) cname = String(opt._componentTag);
                sourceHints.push({
                  kind: "vue2_sfc",
                  fileName: String(file),
                  componentName: cname,
                });
                return;
              }
              walk = walk.$parent;
              w++;
            }
          }
          cur = cur.parentElement;
          depth++;
        }
      } catch (ignored) {}
    })(el);
    var text = "";
    try { text = String(el.innerText || el.textContent || "").replace(/\\s+/g, " ").trim(); } catch (ignored) {}
    if (text.length > 200) text = text.slice(0, 200);
    var attrs = {};
    try {
      var attrList = ["type", "name", "role", "aria-label", "title", "placeholder", "value", "href", "src"];
      var ai, an, av;
      for (ai = 0; ai < attrList.length; ai++) {
        an = attrList[ai];
        av = el.getAttribute && el.getAttribute(an);
        if (av != null && av !== "") attrs[an] = String(av).slice(0, 300);
      }
    } catch (ignored) {}
    return {
      ok: true,
      elementFeatures: {
        tag: String(el.tagName || "").toLowerCase(),
        id: el.id ? String(el.id).slice(0, 200) : "",
        className: el.className ? String(el.className).slice(0, 400) : "",
        text: text,
        attrs: attrs
      },
      url: String(location.href || ""),
      selector: "",
      source: "devtools_$0",
      sourceHints: sourceHints,
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
  if (!result || !result.ok || !result.elementFeatures) return;
  lastSelectionSnapshot = {
    ok: true,
    elementFeatures: result.elementFeatures,
    url: typeof result.url === "string" ? result.url : "",
    ts: Date.now(),
    sourceHints: Array.isArray(result.sourceHints) ? result.sourceHints : [],
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

    if (normalized.ok && normalized.elementFeatures) {
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
    snap.elementFeatures &&
    Date.now() - snap.ts < SNAPSHOT_MAX_AGE_MS
  ) {
    replySelection(requestId, {
      ok: true,
      elementFeatures: snap.elementFeatures,
      url: snap.url || "",
      selector: "",
      source: "devtools_$0_snapshot",
      sourceHints: Array.isArray(snap.sourceHints) ? snap.sourceHints : [],
    });
    return;
  }
  replySelection(requestId, {
    ok: false,
    reason: liveReason || "no_$0",
  });
}
