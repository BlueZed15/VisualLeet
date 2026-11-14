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
  viz: $("viz"), vizBody: document.querySelector(".viz-body"), stepMeter: $("step-meter"), diagToggle: $("diag-toggle"),
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
const STATUS_LABEL = {
  "not initialized": "Not started", initializing: "Starting Python…", ready: "Ready", running: "Running…",
  "preparing visualization": "Rendering…", complete: "Done", "limit reached": "Incomplete", "timed out": "Timed out",
  stopped: "Stopped", failed: "Error", "needs input": "Needs input",
};
let msgKind = "info";

function setStatus(s, message = "", kind = "error") {
  status = s;
  el.status.textContent = STATUS_LABEL[s] || s;
  el.status.dataset.state = s.replace(/\s+/g, "-");
  showMessage(message, kind);
  const busy = s === "running" || s === "preparing visualization";
  el.visualize.disabled = busy || !runtimeInfo;
  el.stop.disabled = !busy || s !== "running";
}

function showMessage(text, kind = "error") {
  msgKind = text ? kind : "info";
  el.message.textContent = text;
  el.message.dataset.kind = msgKind;
  updateView();
}

// What the visualizer panel shows: the trace, or a placeholder for the
// current state. Errors that ended a run are shown in the placeholder;
// other messages appear as a banner above the trace or placeholder.
function placeholderFor() {
  const msg = el.message.textContent;
  switch (status) {
    case "not initialized":
    case "initializing":
      return { kind: "loading", title: "Starting Python…", body: "Loading the bundled runtime. This happens once per tab and takes a couple of seconds.", eats: msgKind === "info" };
    case "running":
    case "preparing visualization":
      return { kind: "loading", title: "Running your code…", body: "Recording every step. Press Stop if it takes too long.", eats: true };
    case "failed":
      if (msg) return { kind: "error", title: "Your code didn't run", detail: msg, body: "Fix the problem and press Visualize again.", eats: true };
      break;
    case "timed out":
      return { kind: "error", title: "Stopped after 5 seconds", body: msg || "The program ran too long. Try a smaller input.", eats: true };
    case "stopped":
      return { kind: "info", title: "Run stopped", body: "Your code is unchanged. Press Visualize to run it again.", eats: true };
  }
  return { kind: "empty", title: "Ready when you are", steps: ["Paste, import or load an example", "Add a test call", "Press Visualize"] };
}

function updateView() {
  if (!el.vizBody) return;
  const busy = status === "running" || status === "preparing visualization";
  el.vizBody.classList.toggle("busy", busy && !!rendered);
  let eaten = false;
  if (rendered) {
    el.empty.hidden = true;
  } else {
    const ph = placeholderFor();
    eaten = !!ph.eats;
    const parts = [Object.assign(document.createElement("div"), { className: "ph-icon" }),
      Object.assign(document.createElement("div"), { className: "ph-title", textContent: ph.title })];
    parts[0].setAttribute("aria-hidden", "true");
    if (ph.detail) parts.push(Object.assign(document.createElement("pre"), { className: "ph-detail", textContent: ph.detail }));
    if (ph.body) parts.push(Object.assign(document.createElement("div"), { className: "ph-body", textContent: ph.body }));
    if (ph.steps) {
      const ol = document.createElement("ol");
      ol.className = "ph-steps";
      ph.steps.forEach((t, i) => {
        const li = document.createElement("li");
        li.append(Object.assign(document.createElement("b"), { textContent: String(i + 1) }), t);
        ol.append(li);
      });
      parts.push(ol);
    }
    el.empty.dataset.kind = ph.kind;
    el.empty.replaceChildren(...parts);
    el.empty.hidden = false;
  }
  const showMsg = !!el.message.textContent && !eaten;
  const h = el.message.hidden ? 0 : el.message.offsetHeight;
  el.message.hidden = !showMsg;
  if ((showMsg ? el.message.offsetHeight : 0) !== h) redrawArrows();   // the banner moved the trace
  if (!rendered) el.stepMeter.hidden = $("player").hidden = true;
}

function redrawArrows() {
  if (rendered) requestAnimationFrame(() => rendered && rendered.viz.redrawConnectors());
}

function updateStepMeter(viz) {
  // same numbering as the visualizer's "Step N of M" (the last entry is the "done" state)
  const total = Math.max(viz.curTrace.length - 1, 1);
  const cur = Math.min(viz.curInstr + 1, total);
  el.stepMeter.hidden = $("player").hidden = false;
  el.stepMeter.querySelector("b").textContent = cur;
  el.stepMeter.querySelector(".total").textContent = total;
  el.stepMeter.style.setProperty("--p", (total ? (100 * cur) / total : 0).toFixed(1) + "%");
}

// ---------- step animation ----------
// After each step, compare what is on screen with the previous step and tag
// what changed, so CSS can animate it: new frames slide in, new objects pop
// in, changed values flash, new pointers glow. Purely visual: classes only.

let prevSnap = null;

function snapshotStep(viz) {
  const root = viz.domRoot && viz.domRoot[0];
  if (!root) return null;
  const ptr = new Map();
  for (const c of (viz.dataViz && viz.dataViz.jsPlumbInstance && viz.dataViz.jsPlumbInstance.conns) || []) ptr.set(c.sourceId, c.targetId);
  const valueOf = (td) => {
    const p = td.querySelector(".stack_pointer, [id]");
    return p && ptr.has(p.id) ? "->" + ptr.get(p.id) : td.textContent;
  };
  const values = new Map(), boxes = new Map();
  for (const f of root.querySelectorAll("div.stackFrame, div.zombieStackFrame")) {
    const fkey = f.id || (f.querySelector(".stackFrameHeader") || {}).textContent;
    boxes.set("f:" + fkey, f);
    for (const td of f.querySelectorAll("td.stackFrameValue")) {
      const name = td.previousElementSibling ? td.previousElementSibling.textContent : "";
      values.set("v:" + fkey + "|" + name, { el: td, v: valueOf(td) });
    }
  }
  for (const o of root.querySelectorAll(".heapObject[id]")) {
    boxes.set("o:" + o.id, o);
    o.querySelectorAll("td.listElt, td.tupleElt, td.setElt, td.dictVal, td.instVal, td.classVal").forEach((td, i) => {
      if (td.closest(".heapObject") !== o) return;          // belongs to a nested object
      const k = td.previousElementSibling && /dictKey|instKey|classKey/.test(td.previousElementSibling.className)
        ? td.previousElementSibling.textContent : String(i);
      values.set("h:" + o.id + "|" + k, { el: td, v: valueOf(td) });
    });
  }
  const arrows = new Set([...ptr].map(([s, t]) => s + ">" + t));
  return { values, boxes, arrows, step: viz.curInstr };
}

function retrigger(els, cls) {
  if (!els.length) return;
  for (const e of els) e.classList.remove(cls);
  void document.body.offsetWidth;                            // restart the CSS animation
  for (const e of els) e.classList.add(cls);
}

function animateStep(viz) {
  markCurrentLine(viz);
  const out = viz.domRoot && viz.domRoot[0].querySelector("#progOutputs");
  if (out) out.classList.toggle("vlEmpty", !(viz.curTrace[viz.curInstr] || {}).stdout);
  const snap = snapshotStep(viz);
  const prev = prevSnap;
  prevSnap = snap;
  if (!snap || !prev || snap.step === prev.step || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const changed = [], fresh = [];
  for (const [k, cur] of snap.values) {
    const old = prev.values.get(k);
    // a value in a brand-new frame/object isn't flashed: the whole box animates in
    const boxKey = (k[0] === "v" ? "f:" : "o:") + k.slice(2, k.indexOf("|"));
    if (old ? old.v !== cur.v : prev.boxes.has(boxKey)) changed.push(cur.el);
  }
  for (const [k, box] of snap.boxes) if (!prev.boxes.has(k)) fresh.push(box);
  retrigger(changed, "vlChanged");
  retrigger(fresh, "vlNew");
  const newArrows = [...snap.arrows].filter((a) => !prev.arrows.has(a));
  if (newArrows.length) {
    // arrows are drawn on the next frame; tag the new ones once they exist
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const layer = viz.dataViz && viz.dataViz.jsPlumbInstance;
      for (const c of (layer && layer.conns) || []) {
        if (!newArrows.includes(c.sourceId + ">" + c.targetId)) continue;
        const p = c.canvas.querySelector("path");
        if (p) p.setAttribute("pathLength", "1");     // lets CSS draw it in; gone on the next redraw
        retrigger([c.canvas], "vlNewArrow");
      }
    }));
  }
}

function markCurrentLine(viz) {
  const rows = viz.domRoot ? viz.domRoot[0].querySelectorAll("#pyCodeOutput td.cod") : [];
  rows.forEach((td, i) => td.parentElement.classList.toggle("vlCurLine", i + 1 === viz.curLineNumber));
}

// ---------- autoplay ----------

let playTimer = null;
function setPlaying(on) {
  clearInterval(playTimer);
  playTimer = null;
  const btn = $("play");
  if (on && rendered) {
    const v = rendered.viz;
    if (v.curInstr >= v.curTrace.length - 1) v.renderStep(0);     // at the end: start over
    playTimer = setInterval(() => {
      if (!rendered || !rendered.viz.stepForward()) setPlaying(false);
    }, Number($("speed").value));
  }
  const playing = !!playTimer;
  btn.setAttribute("aria-pressed", String(playing));
  btn.querySelector("use").setAttribute("href", playing ? "#i-pause" : "#i-play");
  btn.querySelector("span").textContent = playing ? "Pause" : "Play";
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
      if (!current) setStatus("initializing", el.message.textContent, msgKind);
      renderDiag();
      break;
    case "ready": {
      // also sent after each run, when a fresh spare interpreter takes over
      if (initStart) { lastInitMs = performance.now() - initStart; initStart = 0; }
      runtimeInfo = Object.assign({}, m.info, { uiInitMs: lastInitMs });
      const keepKind = msgKind;
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
        clearVisualization();
        setStatus("failed", m.message);
        finishJob({ status: "failed", code: m.code, message: m.message });
      }
      break;
    case "timeout":
      runtimeInfo = null;        // that interpreter is gone; wait for the sandbox's ready/initializing
      if (current && m.runId === current.runId) {
        clearVisualization();
        setStatus("timed out", `Stopped after ${m.wallMs / 1000} s without finishing. Try a smaller input.`);
        finishJob({ status: "timed out" });
      }
      break;
    case "stopped":
      runtimeInfo = null;        // that interpreter is gone; wait for the sandbox's ready/initializing
      if (current && m.runId === current.runId) {
        clearVisualization();
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
    rendered = VisualLeetRenderer.renderTrace("viz", trace, {
      startingInstruction: 0, verticalStack: true, codeDivHeight: 230, updateOutputCallback: updateStepMeter,
    });
    prevSnap = null;
    rendered.viz.add_pytutor_hook("end_updateOutput", (a) => { animateStep(a.myViz); return [false]; });
    animateStep(rendered.viz);          // baseline for the first step (nothing animates)
    updateStepMeter(rendered.viz);
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
    kind = "warn";
  } else if (last.event === "raw_input") {
    final = "needs input";
    msg = `The program called input(${last.prompt ? JSON.stringify(last.prompt) : ""}) but there are no more input lines. Add a line in the input() tab and visualize again.`;
    kind = "warn";
    selectTab("stdin");
  }
  setStatus(final, msg, kind);
  finishJob({ status: final, steps, lastEvent: last.event, stdout: last.stdout, exception: last.exception_msg, metrics: lastRun });
}

function clearVisualization() {
  setPlaying(false);
  if (rendered) { rendered.destroy(); rendered = null; }
  prevSnap = null;
  updateView();
}

function startJob(kind, extra = {}) {
  if (!IDLE.has(status) || !runtimeInfo) {
    showMessage(runtimeInfo ? "A run is already in progress." : "The Python runtime is still starting.", "info");
    return Promise.resolve({ status: "rejected", message: "Runtime is " + status });
  }
  const runId = crypto.randomUUID();
  setPlaying(false);
  return new Promise((resolve) => {
    current = {
      runId, kind, resolve, tClick: performance.now(),
      backstop: setTimeout(() => {
        // the sandbox didn't answer at all: throw the whole frame away
        clearVisualization();
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
  if (inputs !== undefined) el.inputs.value = inputs;
  saveDraft();
}

// ---------- tabs (Test call / Setup / input()) ----------

const tabs = [...document.querySelectorAll("[data-tabs] [data-tab]")];
function selectTab(name) {
  for (const t of tabs) t.setAttribute("aria-selected", String(t.dataset.tab === name));
  for (const p of document.querySelectorAll("[data-tabs] [data-panel]")) p.hidden = p.dataset.panel !== name;
}
// a small dot on a tab means it has content, so nothing hides unnoticed
function updateDots() {
  for (const d of document.querySelectorAll("[data-dot]")) d.classList.toggle("on", !!el[d.dataset.dot].value.trim());
}

function saveDraft() {
  updateDots();
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
    showMessage(`Imported ${res.text.split("\n").length} lines from the selection into Solution. Review it, add a test call if needed, then Visualize.`, "ok");
    return res;
  }
  // LeetCode
  const lang = describeLanguage(res.language);
  if (!lang.ok) { showMessage(lang.note, "error"); return Object.assign({}, res, { ok: false, reason: "language" }); }
  const draft = draftForSolution(res.code, res.examples || []);
  setProgram({ setup: draft.setup, solution: res.code, call: draft.call });
  showMessage([`Imported ${res.title ? `"${res.title}"` : "the LeetCode editor"} (${res.code.split("\n").length} lines).`, lang.note, ...draft.notes].filter(Boolean).join("\n"), "ok");
  selectTab("call");
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
  el.sourceTab.textContent = title || url ? `from: ${title || url}` : "";
  el.sourceTab.title = url ? `Imports come from ${url}` : "Page to import from";
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
  if (h) {
    setProgram({ setup: (el.setup.value.trim() ? el.setup.value.replace(/\s+$/, "") + "\n\n" : "") + h });
    selectTab("setup");
    showMessage(`Added ${el.helper.value} to Setup.`, "ok");
  }
  el.helper.value = "";
});

for (const t of tabs) t.addEventListener("click", () => selectTab(t.dataset.tab));
// arrows are drawn once per step; redraw them when the visualizer panel changes size
new ResizeObserver(redrawArrows).observe(el.vizBody);
el.diagToggle.addEventListener("click", () => {
  const on = el.diag.hidden;
  el.diag.hidden = !on;
  el.diagToggle.setAttribute("aria-pressed", String(on));
  el.diagToggle.title = on ? "Hide diagnostics" : "Show diagnostics";
});
$("play").addEventListener("click", () => setPlaying(!playTimer));
$("speed").addEventListener("change", () => { if (playTimer) setPlaying(true); });
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.defaultPrevented) { e.preventDefault(); if (!el.visualize.disabled) visualize(); return; }
  // Space plays/pauses when you're not typing or on a control
  if (e.key === " " && rendered && !e.target.closest("textarea, input, select, button, a")) { e.preventDefault(); setPlaying(!playTimer); }
});
if (/Mac/.test(navigator.platform)) document.querySelector("#visualize .kbd").textContent = "⌘ ↵";

for (const ta of [el.setup, el.solution, el.call, el.inputs]) {
  ta.addEventListener("input", saveDraft);
  ta.addEventListener("keydown", (e) => {
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
