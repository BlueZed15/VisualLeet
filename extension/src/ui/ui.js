// VisualLeet UI controller (privileged extension page). Owns the sandboxed
// runner iframe, the packaged-asset bridge, run state, imports and the
// renderer. It never executes Python and never acts on runner messages
// beyond displaying their results.

import { EXAMPLES, HELPERS } from "./examples.js";
import { composeSource, hasTopLevelCode, describeLanguage, draftForSolution } from "./prepare.js";

const PROTOCOL = 1;
const LIMITS = { wallMs: 5000, maxTraceBytes: 10 * 1024 * 1024 };
const MAX_SOURCE_BYTES = 256 * 1024;
const BACKSTOP_EXTRA_MS = 4000;   // if the sandbox itself stops answering
const DRAFT_KEY = "visualleet.draft.v1";

// The only files the runner can ever receive (packaged, version-pinned).
const ASSETS = {
  "pyodide.mjs": ["vendor/pyodide/pyodide.mjs", "text/javascript"],
  "pyodide.asm.mjs": ["vendor/pyodide/pyodide.asm.mjs", "text/javascript"],
  "pyodide.asm.wasm": ["vendor/pyodide/pyodide.asm.wasm", "application/wasm"],
  "python_stdlib.zip": ["vendor/pyodide/python_stdlib.zip", "application/zip"],
  "pyodide-lock.json": ["vendor/pyodide/pyodide-lock.json", "application/json"],
  "pg_logger.py": ["python/pg_logger.py", "text/x-python"],
  "pg_encoder.py": ["python/pg_encoder.py", "text/x-python"],
};

const $ = (id) => document.getElementById(id);
const el = {
  status: $("status"), message: $("message"), diag: $("diag"), sourceTab: $("source-tab"),
  setup: $("setup"), solution: $("solution"), call: $("call"), inputs: $("inputs"),
  visualize: $("visualize"), stop: $("stop"), reset: $("reset"),
  importLeetcode: $("import-leetcode"), importSelection: $("import-selection"),
  example: $("example"), helper: $("helper"), empty: $("empty"),
};

let iframe = null;
let assetCache = null;
let workerSrc = null;
let runtimeInfo = null;
let status = "not initialized";
let current = null;      // { runId, kind, tClick, backstop, resolve }
let rendered = null;
let lastRun = {};
let lastTrace = null;
let initStart = 0;
let lastInitMs = null;
let sourceTabId = Number(new URLSearchParams(location.search).get("sourceTab")) || null;
const waiters = { ready: [], stats: [] };

// ---------- status & messages ----------

const IDLE = new Set(["ready", "complete", "limit reached", "failed", "stopped", "timed out", "needs input"]);

function setStatus(s, message = "", kind = "error") {
  status = s;
  el.status.textContent = s;
  el.status.className = "status " + s.replace(/\s+/g, "-");
  showMessage(message, kind);
  const busy = s === "running" || s === "preparing visualization";
  el.visualize.disabled = busy || !runtimeInfo;
  el.stop.disabled = !busy || s !== "running";
}

function showMessage(text, kind = "error") {
  el.message.textContent = text;
  el.message.className = "message " + (text ? kind : "");
}

const fmt = (ms) => (ms === undefined || ms === null ? "?" : ms.toFixed(0) + " ms");
function renderDiag() {
  const lines = [];
  if (runtimeInfo) {
    const t = runtimeInfo.timings;
    lines.push(`Python ${runtimeInfo.python} (Pyodide ${runtimeInfo.pyodide})`);
    lines.push(`runtime start: ${fmt(runtimeInfo.uiInitMs)} (worker ${fmt(t.total)}: pyodide ${fmt(t.loadPyodide)}, tracer ${fmt(t.loadTracer)}${t.wasmCompiledOnceMs != null ? `, wasm compiled once in ${fmt(t.wasmCompiledOnceMs)}` : ""})`);
    lines.push(`spare interpreter: ${runtimeInfo.spareReady ? "ready" : "starting"}`);
  }
  if (lastRun.steps !== undefined) {
    lines.push(`last run: ${lastRun.steps} steps, ${(lastRun.bytes / 1024).toFixed(0)} KiB trace, ${lastRun.interpreterRun === 1 ? "fresh" : "reused"} interpreter`);
    lines.push(`  execute ${fmt(lastRun.execMs)}, transfer ${fmt(lastRun.transferMs)}, parse ${fmt(lastRun.parseMs)}, render ${fmt(lastRun.renderMs)}, click→first view ${fmt(lastRun.firstViewMs)}`);
  }
  el.diag.textContent = lines.join("\n");
}

// ---------- runtime (sandboxed runner) ----------

async function loadAssets() {
  if (assetCache) return;
  const entries = await Promise.all(Object.entries(ASSETS).map(async ([name, [path, type]]) => {
    const res = await fetch(chrome.runtime.getURL(path));
    if (!res.ok) throw new Error("Missing packaged file " + path);
    return [name, { bytes: await res.arrayBuffer(), type }];
  }));
  assetCache = Object.fromEntries(entries);
  workerSrc = await (await fetch(chrome.runtime.getURL("runner/worker.js"))).text();
}

function createSandbox() {
  if (iframe) iframe.remove();
  runtimeInfo = null;
  iframe = document.createElement("iframe");
  iframe.src = "../runner/sandbox.html";
  iframe.hidden = true;
  initStart = performance.now();
  setStatus("initializing", "", "info");
  document.body.appendChild(iframe);
}

function toSandbox(msg) {
  iframe.contentWindow.postMessage(Object.assign({ v: PROTOCOL }, msg), "*");
}

function finishJob(result) {
  if (!current) return;
  clearTimeout(current.backstop);
  const c = current;
  current = null;
  if (c.resolve) c.resolve(result);
}

window.addEventListener("message", (e) => {
  if (!iframe || e.source !== iframe.contentWindow) return;   // only our runner frame
  const m = e.data;
  if (!m || m.v !== PROTOCOL || typeof m.type !== "string") return;
  switch (m.type) {
    case "sandbox-loaded":
      loadAssets()
        .then(() => toSandbox({ type: "assets", assets: assetCache, workerSrc }))
        .catch((err) => setStatus("failed", "Could not load the packaged Python runtime: " + err.message));
      break;
    case "initializing":
      runtimeInfo = null;
      if (!initStart) initStart = performance.now();
      if (!current) setStatus("initializing", el.message.textContent, el.message.classList.contains("error") ? "error" : "info");
      renderDiag();
      break;
    case "ready": {
      // also sent after each run, when a fresh spare interpreter takes over
      if (initStart) { lastInitMs = performance.now() - initStart; initStart = 0; }
      runtimeInfo = Object.assign({}, m.info, { uiInitMs: lastInitMs });
      const keepKind = el.message.classList.contains("error") ? "error" : "info";
      const next = !current && (status === "initializing" || status === "not initialized") ? "ready" : status;
      setStatus(next, el.message.textContent, keepKind);
      renderDiag();
      if (!current) waiters.ready.splice(0).forEach((f) => f(runtimeInfo));
      break;
    }
    case "init-error":
      setStatus("failed", "The Python runtime failed to start: " + m.message);
      finishJob({ status: "failed", message: m.message });
      break;
    case "result":
      onResult(m);
      break;
    case "probe-result":
      if (current && current.runId === m.runId) { setStatus("ready", "", "info"); finishJob({ status: "probe", report: JSON.parse(m.report) }); }
      break;
    case "error":
      if (current && m.runId === current.runId) {
        setStatus("failed", m.message);
        finishJob({ status: "failed", code: m.code, message: m.message });
      }
      break;
    case "timeout":
      runtimeInfo = null;        // that interpreter is gone; wait for the sandbox's ready/initializing
      if (current && m.runId === current.runId) {
        setStatus("timed out", `Stopped after ${m.wallMs / 1000} s without finishing. Try a smaller input.`);
        finishJob({ status: "timed out" });
      }
      break;
    case "stopped":
      runtimeInfo = null;        // that interpreter is gone; wait for the sandbox's ready/initializing
      if (current && m.runId === current.runId) {
        setStatus("stopped", "Run stopped.", "info");
        finishJob({ status: "stopped" });
      }
      break;
    case "stats":
      waiters.stats.splice(0).forEach((f) => f(m.stats));
      break;
  }
});

function onResult(m) {
  if (!current || m.runId !== current.runId) return;          // stale result: ignore
  const tRecv = performance.now();
  setStatus("preparing visualization", "", "info");
  let trace;
  const tp = performance.now();
  try {
    trace = JSON.parse(m.traceJson);
  } catch {
    setStatus("failed", "The runner returned malformed data.");
    finishJob({ status: "failed" });
    return;
  }
  const parseMs = performance.now() - tp;
  lastTrace = trace;
  const steps = trace.trace.length;
  const last = trace.trace[steps - 1] || {};
  clearVisualization();

  // The program never started (e.g. a syntax error): report it instead of
  // opening the visualizer, as the original Python Tutor frontend does.
  if (steps === 1 && last.event === "uncaught_exception") {
    setStatus("failed", (last.line ? `Line ${last.line}: ` : "") + last.exception_msg);
    finishJob({ status: "failed", steps, exception: last.exception_msg, line: last.line });
    return;
  }
  const tr = performance.now();
  try {
    el.empty.hidden = true;
    rendered = VisualLeetRenderer.renderTrace("viz", trace, { startingInstruction: 0 });
    document.body.offsetHeight;
  } catch (err) {
    setStatus("failed", "Could not display this trace: " + err.message);
    finishJob({ status: "failed", message: String(err) });
    return;
  }
  const renderMs = performance.now() - tr;
  lastRun = {
    steps, bytes: m.metrics.bytes, execMs: m.metrics.execMs, interpreterRun: m.metrics.interpreterRun,
    transferMs: tRecv - current.tClick - m.metrics.execMs,
    parseMs, renderMs, firstViewMs: performance.now() - current.tClick,
  };
  renderDiag();
  let final = "complete", msg = "", kind = "info";
  if (last.event === "instruction_limit_reached") {
    final = "limit reached";
    msg = "Incomplete: " + (last.exception_msg || "the program hit a limit").split("\n")[0] + " Showing the steps recorded so far.";
    kind = "error";
  } else if (last.event === "raw_input") {
    final = "needs input";
    msg = `The program called input(${last.prompt ? JSON.stringify(last.prompt) : ""}) but there are no more input lines. Add a line under "Input lines" and visualize again.`;
    kind = "error";
    $("inputs-box").open = true;
  }
  setStatus(final, msg, kind);
  finishJob({ status: final, steps, lastEvent: last.event, stdout: last.stdout, exception: last.exception_msg, metrics: lastRun });
}

function clearVisualization() {
  if (rendered) { rendered.destroy(); rendered = null; }
  el.empty.hidden = false;
}

function startJob(kind, extra = {}) {
  if (!IDLE.has(status) || !runtimeInfo) {
    showMessage(runtimeInfo ? "A run is already in progress." : "The Python runtime is still starting.", "info");
    return Promise.resolve({ status: "rejected", message: "Runtime is " + status });
  }
  const runId = crypto.randomUUID();
  return new Promise((resolve) => {
    current = {
      runId, kind, resolve, tClick: performance.now(),
      backstop: setTimeout(() => {
        // the sandbox didn't answer at all: throw the whole frame away
        setStatus("timed out", "The runner stopped responding; restarting it.");
        finishJob({ status: "timed out", backstop: true });
        createSandbox();
      }, LIMITS.wallMs + BACKSTOP_EXTRA_MS),
    };
    setStatus("running", "", "info");
    toSandbox(Object.assign({ type: kind, runId, limits: LIMITS }, extra));
  });
}

// ---------- program ----------

function program() {
  return { setup: el.setup.value, solution: el.solution.value, call: el.call.value };
}

function visualize() {
  const parts = program();                          // captured at click time
  const source = composeSource(parts);
  if (!source.trim()) { showMessage("Add some Python code first.", "info"); return Promise.resolve({ status: "rejected" }); }
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) {
    showMessage("The program is larger than 256 KiB; VisualLeet is meant for small examples.", "error");
    return Promise.resolve({ status: "rejected" });
  }
  if (!hasTopLevelCode(source)) {
    showMessage("Your code only defines functions or classes, so nothing would run. Add a test call, e.g. print(Solution().twoSum([2, 7, 11, 15], 9))", "error");
    el.call.focus();
    return Promise.resolve({ status: "rejected", reason: "no-call" });
  }
  const inputs = el.inputs.value === "" ? [] : el.inputs.value.replace(/\r/g, "").split("\n");
  return startJob("run", { source, inputs });
}

function stop() { if (current && current.kind !== "probe") toSandbox({ type: "stop" }); }
function resetRuntime() {
  runtimeInfo = null;
  initStart = performance.now();
  setStatus("initializing", "Restarting the Python runtime…", "info");
  toSandbox({ type: "reset" });
}

function setProgram({ setup, solution, call, inputs }) {
  if (setup !== undefined) el.setup.value = setup;
  if (solution !== undefined) el.solution.value = solution;
  if (call !== undefined) el.call.value = call;
  if (inputs !== undefined) { el.inputs.value = inputs; $("inputs-box").open = !!inputs; }
  saveDraft();
}

function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.assign(program(), { inputs: el.inputs.value }))); } catch {}
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}

// ---------- imports (through the background service worker) ----------

async function requestImport(mode) {
  if (!sourceTabId) {
    showMessage("Open VisualLeet from the toolbar button while on the page you want to import from.", "error");
    return { ok: false, reason: "no-source-tab" };
  }
  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: "import", mode, tabId: sourceTabId });
  } catch (err) {
    res = { ok: false, error: String(err.message || err) };
  }
  if (!res || !res.ok) {
    showMessage((res && res.error) || "Import failed.", "error");   // editors are left untouched
    return res || { ok: false };
  }
  if (mode === "selection") {
    el.solution.value = res.text;
    saveDraft();
    showMessage(`Imported ${res.text.split("\n").length} lines from the selection into Solution. Review it, add a test call if needed, then Visualize.`, "info");
    return res;
  }
  // LeetCode
  const lang = describeLanguage(res.language);
  if (!lang.ok) { showMessage(lang.note, "error"); return Object.assign({}, res, { ok: false, reason: "language" }); }
  const draft = draftForSolution(res.code, res.examples || []);
  setProgram({ setup: draft.setup, solution: res.code, call: draft.call });
  showMessage([`Imported ${res.title ? `"${res.title}"` : "the LeetCode editor"} (${res.code.split("\n").length} lines).`, lang.note, ...draft.notes].filter(Boolean).join("\n"), "info");
  return Object.assign({}, res, { draft });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg && msg.type === "source-tab" && typeof msg.tabId === "number") {
    sourceTabId = msg.tabId;
    showSourceTab(msg.title, msg.url);
  }
});

function showSourceTab(title, url) {
  el.sourceTab.textContent = title || url ? `Import from: ${title || url}` : "";
}

// ---------- wiring ----------

for (const name of Object.keys(EXAMPLES)) el.example.add(new Option(name, name));
for (const name of Object.keys(HELPERS)) el.helper.add(new Option(name, name));

el.example.addEventListener("change", () => {
  const ex = EXAMPLES[el.example.value];
  if (ex) setProgram({ setup: ex.setup, solution: ex.solution, call: ex.call, inputs: ex.inputs || "" });
  el.example.value = "";
});
el.helper.addEventListener("change", () => {
  const h = HELPERS[el.helper.value];
  if (h) setProgram({ setup: (el.setup.value.trim() ? el.setup.value.replace(/\s+$/, "") + "\n\n" : "") + h });
  el.helper.value = "";
});

for (const ta of [el.setup, el.solution, el.call, el.inputs]) {
  ta.addEventListener("input", saveDraft);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); visualize(); return; }
    if (e.key === "Tab" && !e.shiftKey && ta !== el.inputs) {      // indent with 4 spaces
      e.preventDefault();
      const { selectionStart: s, selectionEnd: t, value } = ta;
      ta.value = value.slice(0, s) + "    " + value.slice(t);
      ta.selectionStart = ta.selectionEnd = s + 4;
      saveDraft();
    }
  });
}
el.visualize.addEventListener("click", visualize);
el.stop.addEventListener("click", stop);
el.reset.addEventListener("click", resetRuntime);
el.importLeetcode.addEventListener("click", () => requestImport("leetcode"));
el.importSelection.addEventListener("click", () => requestImport("selection"));
window.addEventListener("pagehide", () => { if (iframe) iframe.remove(); clearVisualization(); });

const draft = loadDraft();
setProgram(draft || EXAMPLES["Two Sum"]);
if (sourceTabId) chrome.runtime.sendMessage({ type: "describe-tab", tabId: sourceTabId }).then((r) => r && showSourceTab(r.title, r.url)).catch(() => {});
createSandbox();

// Test hooks (used by the automated checks through DevTools).
window.visualleet = {
  whenReady: () => (runtimeInfo && !current ? Promise.resolve(runtimeInfo) : new Promise((r) => waiters.ready.push(r))),
  setProgram,
  program,
  run: (source, inputs) => { setProgram({ setup: "", solution: source, call: "", inputs: inputs ? inputs.join("\n") : "" }); return visualize(); },
  visualize,
  stop,
  resetRuntime,
  probe: () => startJob("probe"),
  importFrom: (mode, tabId) => { if (tabId) sourceTabId = tabId; return requestImport(mode); },
  sandboxStats: () => new Promise((r) => { waiters.stats.push(r); toSandbox({ type: "stats" }); }),
  status: () => status,
  message: () => el.message.textContent,
  lastRun: () => lastRun,
  lastTrace: () => lastTrace,
  runtimeInfo: () => runtimeInfo,
};
