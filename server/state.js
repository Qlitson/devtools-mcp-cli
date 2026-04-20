const fs = require("fs/promises");
const path = require("path");

const RUNTIME_DIR = path.join(__dirname, ".runtime");
const STATE_FILE = path.join(RUNTIME_DIR, "state.json");

const EMPTY_STATE = {
  lastTask: null,
  browserTestSteps: [],
  diagnostics: [],
};
let stateWriteChain = Promise.resolve();

async function ensureRuntimeDir() {
  await fs.mkdir(RUNTIME_DIR, { recursive: true });
}

/**
 * 无有效 dom / prompt 的请求视为空任务：不写入队列、pop 时丢弃。
 * （page_error / unhandled_rejection 不应出现在 lastTask，若出现则不算空，便于排查。）
 */
function isEmptyDevToolsTask(task) {
  if (task == null) return true;
  if (typeof task !== "object" || Array.isArray(task)) return true;
  const type = task.type;
  if (type === "page_error" || type === "unhandled_rejection") return false;
  const prompt = typeof task.prompt === "string" ? task.prompt.trim() : "";
  const dom = typeof task.dom === "string" ? task.dom.trim() : "";
  return !prompt && !dom;
}

async function readState() {
  await ensureRuntimeDir();
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...EMPTY_STATE,
      ...parsed,
    };
  } catch (err) {
    if (err.code === "ENOENT") return { ...EMPTY_STATE };
    throw err;
  }
}

async function writeState(state) {
  await ensureRuntimeDir();
  const next = {
    ...EMPTY_STATE,
    ...state,
  };
  const tempFile = `${STATE_FILE}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempFile, JSON.stringify(next, null, 2), "utf8");
  await fs.rename(tempFile, STATE_FILE);
}

async function updateState(updater) {
  stateWriteChain = stateWriteChain.then(async () => {
    const current = await readState();
    const next = await updater(current);
    await writeState(next);
    return next;
  });
  return stateWriteChain;
}

async function setLastTask(task) {
  if (isEmptyDevToolsTask(task)) {
    await updateState((state) => ({
      ...state,
      lastTask: null,
    }));
    return;
  }
  await updateState((state) => ({
    ...state,
    lastTask: task,
  }));
}

/** 页面自动上报的错误/拒绝，不得覆盖 lastTask（否则会在用户点「发送」前后冲掉刚提交的 DOM） */
async function appendDiagnostic(entry) {
  const item = { ...entry, receivedAt: Date.now() };
  await updateState((state) => {
    const prev = Array.isArray(state.diagnostics) ? state.diagnostics : [];
    const next = [...prev, item].slice(-50);
    return {
      ...state,
      diagnostics: next,
    };
  });
}

async function popLastTask() {
  let task = null;
  await updateState((state) => {
    const raw = state.lastTask ?? null;
    if (raw != null && isEmptyDevToolsTask(raw)) {
      task = null;
      return {
        ...state,
        lastTask: null,
      };
    }
    task = raw;
    return {
      ...state,
      lastTask: null,
    };
  });
  return task;
}

/**
 * 若当前有任务则原子取出并清空；否则返回 null。
 * 用于长轮询，避免 peek + pop 之间的竞态。
 */
async function tryPopLastTask() {
  let task = null;
  await updateState((state) => {
    const raw = state.lastTask ?? null;
    if (!raw) return state;
    if (isEmptyDevToolsTask(raw)) {
      return {
        ...state,
        lastTask: null,
      };
    }
    task = raw;
    return {
      ...state,
      lastTask: null,
    };
  });
  return task;
}

/** Claude 完成一轮浏览器侧工作后调用 MCP 工具清空，避免下次拉取到陈旧任务/步骤 */
async function clearDevToolsBridgeQueues() {
  await updateState((state) => ({
    ...state,
    lastTask: null,
    browserTestSteps: [],
  }));
}

async function setBrowserTestSteps(steps) {
  await updateState((state) => ({
    ...state,
    browserTestSteps: Array.isArray(steps) ? steps : [],
  }));
}

async function popBrowserTestSteps() {
  let steps = [];
  await updateState((state) => {
    steps = Array.isArray(state.browserTestSteps) ? state.browserTestSteps : [];
    return {
      ...state,
      browserTestSteps: [],
    };
  });
  return steps;
}

/** 调试用：确认 HTTP / MCP / Channel 是否共用同一文件（应用目录下的 `server/.runtime/state.json`） */
function getStateFilePath() {
  return STATE_FILE;
}

module.exports = {
  setLastTask,
  appendDiagnostic,
  isEmptyDevToolsTask,
  clearDevToolsBridgeQueues,
  popLastTask,
  tryPopLastTask,
  setBrowserTestSteps,
  popBrowserTestSteps,
  readState,
  getStateFilePath,
};
