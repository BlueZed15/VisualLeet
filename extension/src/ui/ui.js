// VisualLeet UI controller (privileged extension page). Owns the sandboxed
// runner iframe, the packaged-asset bridge, run state, imports and the
// renderer. It never executes Python and never acts on runner messages
// beyond displaying their results.
//
// Where results show up (design dark v0.1):
//  - status pill (top right): the run state;
//  - notice (#message, top of the visualizer panel): imports, validation, runtime notes;
//  - banner (#banner): facts about the trace that is still shown (limit reached, needs input);
//  - placeholder (#placeholder): replaces the visualizer when there is no trace to show
//    (starting, empty, running for a while, timed out, stopped, errors).

import { EXAMPLES, HELPERS } from "./examples.js";
import { composeSource, hasTopLevelCode, describeLanguage, draftForSolution } from "./prepare.js";
import { createLeetCodeMode } from "./leetcode-mode.js";
import { resultLine } from "./harness.js";

const PROTOCOL = 1;
const LIMITS = { wallMs: 5000, maxTraceBytes: 10 * 1024 * 1024 };
const MAX_SOURCE_BYTES = 256 * 1024;
const BACKSTOP_EXTRA_MS = 4000;   // if the sandbox itself stops answering
const RUNNING_PLACEHOLDER_MS = 400;   // most runs finish in ~30 ms: don't flash a placeholder
const DRAFT_KEY = "visualleet.draft.v1";
const RENDER_OPTIONS = { startingInstruction: 0, verticalStack: true, codeDivHeight: 250 };

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
  status: $("status"), message: $("message"), banner: $("banner"), placeholder: $("placeholder"),
  diag: $("diag"), diagToggle: $("diag-toggle"), sourceTab: $("source-tab"),
  setup: $("setup"), solution: $("solution"), call: $("call"), inputs: $("inputs"),
  visualize: $("visualize"), stop: $("stop"), reset: $("reset"),
  importLeetcode: $("import-leetcode"), importSelection: $("import-selection"),
  example: $("example"), helper: $("helper"), viz: $("viz"), stepMeter: $("step-meter"),
  tabs: [...document.querySelectorAll("[data-tab]")], modeToggle: $("mode-toggle"),
};

const MODE_KEY = "visualleet.mode";
const PENDING_MAX_AGE_MS = 2 * 60 * 1000;
let mode = "manual";               // "manual" (paste) | "lc" (LeetCode test case)
// VisualLeet's problem database: index.json + one file per problem.
let dbIndex = { problems: {} };
const dbReady = fetch(chrome.runtime.getURL("problems/index.json")).then((r) => r.json()).then((d) => { dbIndex = d; }).catch(() => {});
async function loadEntry(slug) {
  await dbReady;
  if (!/^[a-z0-9-]+$/.test(slug || "") || !dbIndex.problems[slug]) return null;
  try { return await (await fetch(chrome.runtime.getURL(`problems/${slug}.json`))).json(); } catch { return null; }
}
const lc = createLeetCodeMode({
  tabs: $("case-tabs"), add: $("case-add"), del: $("case-delete"), fields: $("case-fields"), title: $("lc-title"),
  badge: $("lc-badge"), expected: $("case-expected"), verdict: $("case-verdict"), source: $("case-source"),
  call: $("lc-call"), callReset: $("lc-call-reset"), callNote: $("lc-call-note"), setup: $("lc-setup"),
});

let iframe = null;
let assetCache = null;
let workerSrc = null;
let runtimeInfo = null;
let status = "not initialized";
let current = null;      // { runId, kind, tClick, backstop, slow, resolve }
let rendered = null;
let lastRun = {};
let lastTrace = null;
let initStart = 0;
let lastInitMs = null;
let placeholderTag = null;   // why the placeholder is showing ("starting", "empty", …)
let resetting = false;
let sourceTabId = Number(new URLSearchParams(location.search).get("sourceTab")) || null;
const waiters = { ready: [], stats: [] };

// ---------- status & messages ----------

const IDLE = new Set(["ready", "complete", "limit reached", "failed", "stopped", "timed out", "needs input"]);
const STATUS_TEXT = {
  "not initialized": "Not initialized", initializing: "Starting Python…", ready: "Ready", running: "Running…",
  "preparing visualization": "Preparing…", complete: "Complete", "limit reached": "Limit reached",
  "timed out": "Timed out", stopped: "Stopped", failed: "Error", "needs input": "Needs input",
};

function setStatus(s) {
  status = s;
  el.status.textContent = STATUS_TEXT[s] || s;
  el.status.dataset.state = s.replace(/\s+/g, "-");
  const busy = s === "running" || s === "preparing visualization";
  el.visualize.disabled = busy || !runtimeInfo;
  el.stop.disabled = s !== "running";
}

// kind: "ok" | "info" | "error"
function showMessage(text, kind = "error") {
  el.message.textContent = text || "";
  el.message.dataset.kind = kind;
  el.message.hidden = !text;
}

// kind: "warn" | "info" | "error"; null hides it
function setBanner(kind, title = "", body = "") {
  if (!kind) { el.banner.hidden = true; el.banner.replaceChildren(); return; }
  const t = document.createElement("strong");
  t.textContent = title;
  el.banner.replaceChildren(t, body ? " " + body : "");
  el.banner.dataset.kind = kind;
  el.banner.hidden = false;
}

// kind: "empty" | "loading" | "error" | "info"; null hides it. Showing one hides the visualizer.
function setPlaceholder(kind, title = "", body = "", { tag = kind, code = false } = {}) {
  placeholderTag = kind ? tag : null;
  if (!kind) { el.placeholder.hidden = true; el.placeholder.replaceChildren(); el.viz.hidden = false; return; }
  const icon = document.createElement("div"); icon.className = "ph-icon"; icon.setAttribute("aria-hidden", "true");
  const h = document.createElement("div"); h.className = "ph-title" + (code ? " code" : ""); h.textContent = title;
  const p = document.createElement("div"); p.className = "ph-body"; p.textContent = body;
  el.placeholder.replaceChildren(icon, h, p);
  el.placeholder.dataset.kind = kind;
  el.placeholder.hidden = false;
  el.viz.hidden = true;
}

const showEmpty = () => setPlaceholder("empty", "Nothing to show yet",
  "Paste or import a solution, add a test call, then press Visualize.");

// Everything the user is currently being told, as text (test hook).
function visibleMessages() {
  const parts = [];
  if (!el.message.hidden) parts.push(el.message.textContent);
  if (!el.banner.hidden) parts.push(el.banner.textContent);
  if (!el.placeholder.hidden) parts.push([...el.placeholder.children].map((c) => c.textContent).filter(Boolean).join("\n"));
  return parts.join("\n");
}

const fmt = (ms) => (ms === undefined || ms === null ? "?" : ms.toFixed(0) + " ms");
function renderDiag() {
  const lines = [];
  if (runtimeInfo) {
    const t = runtimeInfo.timings;
    lines.push(`Python ${runtimeInfo.python} (Pyodide ${runtimeInfo.pyodide})`);
    lines.push(`runtime start: ${fmt(runtimeInfo.uiInitMs)} (worker ${fmt(t.total)}: pyodide ${fmt(t.loadPyodide)}, tracer ${fmt(t.loadTracer)}${t.wasmCompiledOnceMs != null ? `, wasm compiled once in ${fmt(t.wasmCompiledOnceMs)}` : ""})`);
    lines.push(`spare interpreter: ${runtimeInfo.spareReady ? "ready" : "starting"}`);
  } else {
    lines.push("Python runtime: starting…");
  }
  if (lastRun.steps !== undefined) {
    lines.push(`last run: ${lastRun.steps} steps, ${(lastRun.bytes / 1024).toFixed(0)} KiB trace, ${lastRun.interpreterRun === 1 ? "fresh" : "reused"} interpreter`);
    lines.push(`  execute ${fmt(lastRun.execMs)}, transfer ${fmt(lastRun.transferMs)}, parse ${fmt(lastRun.parseMs)}, render ${fmt(lastRun.renderMs)}, click→first view ${fmt(lastRun.firstViewMs)}`);
  }
  el.diag.textContent = lines.join("\n");
}

// Step meter in the visualizer's tab bar; follows the renderer's own
// "Step X of Y" numbering (the final entry is "done running").
function updateStepMeter(viz) {
  const total = Math.max(viz.curTrace.length - 1, 1);
  const cur = Math.min(viz.curInstr + 1, total);
  el.stepMeter.querySelector("b").textContent = String(cur);
  el.stepMeter.querySelector(".total").textContent = String(total);
  el.stepMeter.style.setProperty("--p", (100 * cur / total).toFixed(1) + "%");
  el.stepMeter.hidden = false;
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
  setStatus("initializing");
  if (!rendered && (!placeholderTag || placeholderTag === "empty")) {
    setPlaceholder("loading", "Starting Python…", "Loading the bundled runtime. This happens once per tab (about 2 s).", { tag: "starting" });
  }
  renderDiag();
  document.body.appendChild(iframe);
}

function toSandbox(msg) {
  iframe.contentWindow.postMessage(Object.assign({ v: PROTOCOL }, msg), "*");
}

function finishJob(result) {
  if (!current) return;
  clearTimeout(current.backstop);
  clearTimeout(current.slow);
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
        .catch((err) => {
          setStatus("failed");
          clearVisualization();
          setPlaceholder("error", "Python couldn't start", "Could not load the packaged Python runtime: " + err.message);
        });
      break;
    case "initializing":
      runtimeInfo = null;
      if (!initStart) initStart = performance.now();
      if (!current) setStatus("initializing");
      renderDiag();
      break;
    case "ready": {
      // also sent after each run, when a fresh spare interpreter takes over
      if (initStart) { lastInitMs = performance.now() - initStart; initStart = 0; }
      runtimeInfo = Object.assign({}, m.info, { uiInitMs: lastInitMs });
      setStatus(!current && (status === "initializing" || status === "not initialized") ? "ready" : status);
      if (!current && placeholderTag === "starting") showEmpty();
      if (resetting && !current) { resetting = false; showMessage("Python restarted.", "ok"); }
      renderDiag();
      if (!current) waiters.ready.splice(0).forEach((f) => f(runtimeInfo));
      break;
    }
    case "init-error":
      setStatus("failed");
      clearVisualization();
      setPlaceholder("error", "Python failed to start", m.message + "\nPress Reset to try again.");
      finishJob({ status: "failed", message: m.message });
      break;
    case "result":
      onResult(m);
      break;
    case "probe-result":
      if (current && current.runId === m.runId) { setStatus("ready"); finishJob({ status: "probe", report: JSON.parse(m.report) }); }
      break;
    case "error":
      if (current && m.runId === current.runId) {
        setStatus("failed");
        clearVisualization();
        setPlaceholder("error", "Couldn't visualize this run", m.message);
        finishJob({ status: "failed", code: m.code, message: m.message });
      }
      break;
    case "timeout":
      runtimeInfo = null;        // that interpreter is gone; wait for the sandbox's ready/initializing
      if (current && m.runId === current.runId) {
        setStatus("timed out");
        clearVisualization();
        setPlaceholder("error", `Stopped after ${m.wallMs / 1000} seconds`,
          "The program ran too long without finishing. Python is restarting; try a smaller input.");
        finishJob({ status: "timed out" });
      }
      break;
    case "stopped":
      runtimeInfo = null;        // that interpreter is gone; wait for the sandbox's ready/initializing
      if (current && m.runId === current.runId) {
        setStatus("stopped");
        clearVisualization();
        setPlaceholder("info", "Run stopped", "Your code is unchanged. Press Visualize to run it again.");
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
  setStatus("preparing visualization");
  let trace;
  const tp = performance.now();
  try {
    trace = JSON.parse(m.traceJson);
  } catch {
    setStatus("failed");
    clearVisualization();
    setPlaceholder("error", "The runner returned malformed data", "Press Visualize to try again.");
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
    setStatus("failed");
    setPlaceholder("error", (last.line ? `Line ${last.line}: ` : "") + last.exception_msg,
      "The program didn't start. Fix the line and press Visualize.", { code: true });
    if (current.info.lc) lc.judge(null, "No result: the program didn't start (see the error on the right).");
    finishJob({ status: "failed", steps, exception: last.exception_msg, line: last.line });
    return;
  }
  const tr = performance.now();
  try {
    setPlaceholder(null);                       // the renderer only draws into a visible element
    rendered = VisualLeetRenderer.renderTrace("viz", trace, Object.assign({ updateOutputCallback: updateStepMeter }, RENDER_OPTIONS));
    document.body.offsetHeight;
  } catch (err) {
    clearVisualization();
    setStatus("failed");
    setPlaceholder("error", "Could not display this trace", err.message);
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
  let final = "complete";
  if (last.event === "instruction_limit_reached") {
    final = "limit reached";
    // the tracer's text (kept as is) is two lines written for Python Tutor
    const text = last.exception_msg || "";
    const steps = /Stopped after running (\d+) steps/.exec(text);
    const what = steps ? `The program hit the ${Number(steps[1]).toLocaleString("en-US")}-step limit.`
      : (text.split("\n")[0].replace(/,\s*$/, ".") || "The program hit a limit.");
    setBanner("warn", "Incomplete trace.", what + " Showing the steps recorded so far; try a smaller input.");
  } else if (last.event === "raw_input") {
    final = "needs input";
    setBanner("warn", "Needs input.",
      `The program called input(${last.prompt ? JSON.stringify(last.prompt) : ""}) but there are no more input lines. Add a line in the input() tab and visualize again.`);
    selectTab("inputs");
  }
  if (current.info.lc) {
    // the generated call prints the result last, in LeetCode's format
    if (last.event === "exception" || last.event === "uncaught_exception") {
      lc.judge(null, `No result: your code raised ${last.exception_msg}${last.line ? ` (line ${last.line})` : ""}.`);
    } else if (final !== "complete") {
      lc.judge(null, "No result: the run stopped before your code returned.");
    } else {
      lc.judge(resultLine(last.stdout));
    }
  }
  setStatus(final);
  finishJob({ status: final, steps, lastEvent: last.event, stdout: last.stdout, exception: last.exception_msg, metrics: lastRun });
}

function clearVisualization() {
  if (rendered) { rendered.destroy(); rendered = null; }
  el.stepMeter.hidden = true;
}

function startJob(kind, extra = {}, info = {}) {
  if (!IDLE.has(status) || !runtimeInfo) {
    showMessage(runtimeInfo ? "A run is already in progress." : "The Python runtime is still starting. Try again in a moment.", "info");
    return Promise.resolve({ status: "rejected", message: "Runtime is " + status });
  }
  const runId = crypto.randomUUID();
  if (!info.keepMessage) showMessage("");
  setBanner(null);
  return new Promise((resolve) => {
    current = {
      runId, kind, resolve, info, tClick: performance.now(),
      backstop: setTimeout(() => {
        // the sandbox didn't answer at all: throw the whole frame away
        setStatus("timed out");
        clearVisualization();
        setPlaceholder("error", "The runner stopped responding", "Restarting Python. Try a smaller input.");
        finishJob({ status: "timed out", backstop: true });
        createSandbox();
      }, LIMITS.wallMs + BACKSTOP_EXTRA_MS),
      slow: kind === "run" ? setTimeout(() => {
        if (current && current.runId === runId && status === "running") {
          setPlaceholder("loading", "Running your code…", "Recording each step. Press Stop if it takes too long.");
        }
      }, RUNNING_PLACEHOLDER_MS) : 0,
    };
    setStatus("running");
    toSandbox(Object.assign({ type: kind, runId, limits: LIMITS }, extra));
  });
}

// ---------- program ----------

function program() {
  return { setup: el.setup.value, solution: el.solution.value, call: el.call.value };
}

function visualize(opts = {}) {
  return mode === "lc" ? visualizeCase(opts) : visualizePasted();
}

// LeetCode mode: the user's code + the generated call; inputs built by hidden setup.
function visualizeCase(opts = {}) {
  if (!lc.problem) { showMessage("Click the VisualLeet icon on a LeetCode problem first.", "info"); return Promise.resolve({ status: "rejected" }); }
  const g = lc.program();
  if (!g.ok) {
    showMessage("Fix the highlighted test-case values first.", "error");
    return Promise.resolve({ status: "rejected", reason: "case", errors: g.errors });
  }
  const solution = el.solution.value;
  if (!solution.trim()) { showMessage("There's no code yet: click the VisualLeet icon on the LeetCode tab to copy it.", "info"); return Promise.resolve({ status: "rejected" }); }
  const source = solution.replace(/\s+$/, "") + "\n\n" + g.code + "\n";
  if (new TextEncoder().encode(source + g.setup).length > MAX_SOURCE_BYTES) {
    showMessage("The program is larger than 256 KiB; VisualLeet is meant for small examples.", "error");
    return Promise.resolve({ status: "rejected" });
  }
  return startJob("run", { source, inputs: [], setup: g.setup, setupVisible: g.visible }, { lc: true, keepMessage: opts.keepMessage });
}

function visualizePasted() {
  const parts = program();                          // captured at click time
  const source = composeSource(parts);
  if (!source.trim()) { showMessage("Add some Python code first.", "info"); return Promise.resolve({ status: "rejected" }); }
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) {
    showMessage("The program is larger than 256 KiB; VisualLeet is meant for small examples.", "error");
    return Promise.resolve({ status: "rejected" });
  }
  if (!hasTopLevelCode(source)) {
    showMessage("Your code only defines functions or classes, so nothing would run. Add a test call, e.g. print(Solution().twoSum([2, 7, 11, 15], 9))", "error");
    selectTab("call");
    el.call.focus();
    return Promise.resolve({ status: "rejected", reason: "no-call" });
  }
  const inputs = el.inputs.value === "" ? [] : el.inputs.value.replace(/\r/g, "").split("\n");
  return startJob("run", { source, inputs });
}

function stop() { if (current && current.kind !== "probe") toSandbox({ type: "stop" }); }
function resetRuntime() {
  runtimeInfo = null;
  resetting = true;
  initStart = performance.now();
  setStatus("initializing");
  showMessage("Restarting the Python runtime…", "info");
  renderDiag();
  toSandbox({ type: "reset" });
}

function setProgram({ setup, solution, call, inputs }) {
  if (setup !== undefined) el.setup.value = setup;
  if (solution !== undefined) el.solution.value = solution;
  if (call !== undefined) el.call.value = call;
  if (inputs !== undefined) el.inputs.value = inputs;
  saveDraft();
}

function saveDraft() {
  markFilledTabs();
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify(Object.assign(program(), { inputs: el.inputs.value }))); } catch {}
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null"); } catch { return null; }
}

// ---------- tabs (Test call / Setup / input()) ----------

function selectTab(name) {
  const tab = el.tabs.find((t) => t.dataset.tab === name);
  if (!tab) return;
  const group = tab.dataset.group || "testcase";
  for (const t of el.tabs) {
    if ((t.dataset.group || "testcase") !== group) continue;
    const on = t === tab;
    t.setAttribute("aria-selected", String(on));
    t.tabIndex = on ? 0 : -1;
    $(t.getAttribute("aria-controls")).hidden = !on;
  }
}

// Setup and input lines run too, but sit behind a tab: mark them when they have content.
function markFilledTabs() {
  $("tab-setup").toggleAttribute("data-filled", el.setup.value.trim() !== "");
  $("tab-inputs").toggleAttribute("data-filled", el.inputs.value !== "");
  $("tab-setup").title = el.setup.value.trim() ? "Setup has code that runs before the solution" : "";
  $("tab-inputs").title = el.inputs.value ? "There are input lines for input()" : "";
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
    setMode("manual");
    el.solution.value = res.text;
    saveDraft();
    showMessage(`Imported ${res.text.split("\n").length} lines from the selection into Solution. Review it, add a test call if needed, then Visualize.`, "ok");
    return res;
  }
  return openLeetCode(res, { autoRun: true });
}

// ---------- LeetCode mode ----------

function setMode(m) {
  mode = m === "lc" && lc.problem ? "lc" : "manual";
  document.body.classList.toggle("mode-lc", mode === "lc");
  document.body.classList.toggle("mode-manual", mode === "manual");
  el.modeToggle.hidden = !lc.problem;
  el.modeToggle.textContent = mode === "lc" ? "Paste mode" : "LeetCode mode";
  el.modeToggle.title = mode === "lc" ? "Paste or type any Python program instead" : "Back to the LeetCode problem's test cases";
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  if (mode === "lc") selectTab("solution");
}

/**
 * Show what was read from a LeetCode problem page: its code, its database
 * entry and test cases, the case selected in LeetCode's Testcase panel.
 * Visualizes it right away when everything checks out (one click).
 */
async function openLeetCode(res, { autoRun = false } = {}) {
  if (!res || !res.ok) {
    showMessage((res && res.error) || "Couldn't read the LeetCode page.", "error");   // current code and cases kept
    return res || { ok: false };
  }
  const entry = await loadEntry(res.slug);
  const lang = describeLanguage(res.language || "");
  if (!entry) {
    // not in VisualLeet's database: paste mode with a draft call, as before
    setMode("manual");
    if (res.code && lang.ok) {
      const lines = (res.exampleInputs || []).map((x) => x.split("\n"));
      const draft = draftForSolution(res.code, []);
      setProgram({ setup: draft.setup, solution: res.code, call: draft.call });
      selectTab("call");
      showMessage([`"${res.title || res.slug}" isn't in VisualLeet's problem database yet, so you're in paste mode: check the drafted test call.`,
        lines.length ? `LeetCode's first example input: ${lines[0].join(", ")}` : "", lang.note, ...draft.notes].filter(Boolean).join("\n"), "info");
    } else {
      showMessage(`"${res.title || res.slug}" isn't in VisualLeet's problem database yet. ${!res.code ? "Couldn't read the code editor either (is the page still loading?)." : lang.note}`, "error");
    }
    return { ok: false, reason: "not-in-db", slug: res.slug };
  }
  const loaded = lc.loadFromPage(res, entry);
  setMode("lc");
  const notes = [loaded.note];
  let runnable = true;
  // never run older code in place of what the click was meant to show
  if (!res.code) { notes.push("Couldn't read LeetCode's code editor (is it still loading?). Your code here was kept; press Visualize to run it."); runnable = false; }
  else if (!lang.ok) { notes.push(lang.note); runnable = false; }
  else { el.solution.value = res.code; saveDraft(); if (lang.note) notes.push(lang.note); }
  const note = notes.filter(Boolean).join("\n");
  showMessage(note, "info");
  if (autoRun && runnable) {
    await window.visualleet.whenReady();
    return Object.assign(await visualize({ keepMessage: true }), { problem: res.slug, fromLeetCode: loaded.fromLeetCode });
  }
  return { ok: true, problem: res.slug, fromLeetCode: loaded.fromLeetCode, ran: false };
}

// The background worker stores what an icon click read; take it once.
async function takePending(id) {
  let pending = null;
  try { pending = (await chrome.storage.session.get("pending")).pending; } catch { return; }
  if (!pending || (id && pending.id !== id) || Date.now() - pending.at > PENDING_MAX_AGE_MS) return;
  await chrome.storage.session.remove("pending").catch(() => {});
  sourceTabId = pending.tabId;
  return openLeetCode(pending.result, { autoRun: true });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== chrome.runtime.id) return;
  if (msg && msg.type === "source-tab" && typeof msg.tabId === "number") {
    sourceTabId = msg.tabId;
    showSourceTab(msg.title, msg.url);
    if (msg.pendingId) takePending(msg.pendingId);
  }
});

function showSourceTab(title, url) {
  const name = title || url || "";
  el.sourceTab.textContent = name ? `from: ${name}` : "";
  el.sourceTab.title = name ? `Imports read from: ${name}${url && title ? "\n" + url : ""}` : "";
  el.sourceTab.hidden = !name;
}

// ---------- wiring ----------

for (const name of Object.keys(EXAMPLES)) el.example.add(new Option(name, name));
for (const name of Object.keys(HELPERS)) el.helper.add(new Option(name, name));

el.example.addEventListener("change", () => {
  const ex = EXAMPLES[el.example.value];
  if (ex) { setProgram({ setup: ex.setup, solution: ex.solution, call: ex.call, inputs: ex.inputs || "" }); selectTab("call"); }
  el.example.value = "";
});
el.helper.addEventListener("change", () => {
  const h = HELPERS[el.helper.value];
  if (h) { setProgram({ setup: (el.setup.value.trim() ? el.setup.value.replace(/\s+$/, "") + "\n\n" : "") + h }); selectTab("setup"); }
  el.helper.value = "";
});

for (const t of el.tabs) {
  t.addEventListener("click", () => selectTab(t.dataset.tab));
  t.addEventListener("keydown", (e) => {          // arrow keys move between visible tabs of the same group
    const group = el.tabs.filter((x) => (x.dataset.group || "testcase") === (t.dataset.group || "testcase") && x.offsetParent !== null);
    const i = group.indexOf(t);
    const j = e.key === "ArrowRight" ? i + 1 : e.key === "ArrowLeft" ? i - 1 : null;
    if (j === null || i < 0) return;
    const next = group[(j + group.length) % group.length];
    selectTab(next.dataset.tab);
    next.focus();
    e.preventDefault();
  });
}

for (const ta of [el.setup, el.solution, el.call, el.inputs]) {
  ta.addEventListener("input", saveDraft);
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && !e.shiftKey && !e.ctrlKey && !e.altKey && ta !== el.inputs) {      // indent with 4 spaces
      e.preventDefault();
      const { selectionStart: s, selectionEnd: t, value } = ta;
      ta.value = value.slice(0, s) + "    " + value.slice(t);
      ta.selectionStart = ta.selectionEnd = s + 4;
      saveDraft();
    }
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.repeat) { e.preventDefault(); visualize(); }   // explains itself if busy
});
el.visualize.addEventListener("click", visualize);
el.stop.addEventListener("click", stop);
el.reset.addEventListener("click", resetRuntime);
el.diagToggle.addEventListener("click", () => {
  el.diag.hidden = !el.diag.hidden;
  el.diagToggle.setAttribute("aria-pressed", String(!el.diag.hidden));
  if (!el.diag.hidden) el.diag.scrollIntoView({ block: "nearest" });
});
el.importLeetcode.addEventListener("click", () => requestImport("leetcode"));
el.importSelection.addEventListener("click", () => requestImport("selection"));
window.addEventListener("pagehide", () => { if (iframe) iframe.remove(); clearVisualization(); });

el.modeToggle.addEventListener("click", () => setMode(mode === "lc" ? "manual" : "lc"));

const draft = loadDraft();
setProgram(draft || EXAMPLES["Two Sum"]);
setMode("manual");
if (sourceTabId) chrome.runtime.sendMessage({ type: "describe-tab", tabId: sourceTabId }).then((r) => r && showSourceTab(r.title, r.url)).catch(() => {});
createSandbox();

// Back to the last LeetCode problem, then take a case an icon click left for us.
const started = (async () => {
  const last = lc.lastSlug();
  const entry = last ? await loadEntry(last) : null;
  if (entry && lc.restore(entry)) {
    let saved = null;
    try { saved = localStorage.getItem(MODE_KEY); } catch {}
    setMode(saved === "lc" ? "lc" : "manual");
  }
  return takePending();
})();

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
  message: visibleMessages,
  lastRun: () => lastRun,
  lastTrace: () => lastTrace,
  runtimeInfo: () => runtimeInfo,
  rendered: () => rendered,
  started: () => started,
  mode: () => mode,
  setMode,
  openLeetCode,
  leetcode: lc,
  verdict: () => { const v = $("case-verdict"); return v.hidden ? null : { kind: v.dataset.kind, text: v.textContent }; },
};
