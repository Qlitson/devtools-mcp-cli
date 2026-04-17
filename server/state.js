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
    task = state.lastTask ?? null;
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
    task = state.lastTask ?? null;
    if (!task) return state;
    return {
      ...state,
      lastTask: null,
    };
  });
  return task;
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

module.exports = {
  setLastTask,
  appendDiagnostic,
  popLastTask,
  tryPopLastTask,
  setBrowserTestSteps,
  popBrowserTestSteps,
  readState,
};
