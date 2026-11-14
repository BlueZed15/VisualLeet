// VisualLeet UI controller (privileged extension page). Owns the sandboxed
// runner iframe, the packaged-asset bridge, run state, imports and the
// renderer. It never executes Python and never acts on runner messages
// beyond displaying their results.

import { EXAMPLES, SHOWCASE_EXAMPLES, ERROR_EXAMPLES, HELPERS } from "./examples.js";
import { composeSource, hasTopLevelCode, describeLanguage, draftForSolution } from "./prepare.js";
import { createLeetCodeMode } from "./leetcode-mode.js";
import { resultLine } from "./harness.js";

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
  importSelection: $("import-selection"),
  example: $("example"), helper: $("helper"), empty: $("empty"),
  viz: $("viz"), vizBody: document.querySelector(".viz-body"), stepMeter: $("step-meter"), diagToggle: $("diag-toggle"),
  vizPanel: document.querySelector(".viz-panel"), codeEditor: $("code-editor"), gutter: document.querySelector("#code-editor .gutter"),
  edit: $("edit"), editArea: $("edit-area"),
  modeToggle: $("mode-toggle"), lcCases: $("lc-cases"), editLeft: $("edit-left"),
};

// ---------- LeetCode mode: a problem from LeetScope's database + its test cases ----------
// (paste mode is everything else: the code editor + Test call / Setup / input())
const LC_MODE_KEY = "visualleet.mode";
// dev/test builds ("LeetScope (DEV)", "(TEST BUILD)"): examples, Import selection and paste mode
const DEV = /\((DEV|TEST BUILD)\)/.test(chrome.runtime.getManifest().name);
document.body.classList.toggle("dev", DEV);
const PENDING_MAX_AGE_MS = 2 * 60 * 1000;
let lcMode = false;
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
}, {
  // another case picked while playing: run it right away
  onSelect: () => { if (lcMode && mode === "watch") visualize(); },
});

// "edit": the code editor fills the panel. "watch": the run plays like a video.
let mode = "edit";
let lastErrorLine = null;   // line (in the combined program) of the last run's error

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
let runCrashed = false;   // the last run ended in an uncaught exception (status stays "complete")

function setStatus(s, message = "", kind = "error") {
  status = s;
  const crashed = runCrashed && s === "complete";
  el.status.textContent = crashed ? "Error" : STATUS_LABEL[s] || s;
  el.status.dataset.state = crashed ? "failed" : s.replace(/\s+/g, "-");
  showMessage(message, kind);
  const busy = s === "running" || s === "preparing visualization";
  el.visualize.disabled = busy || !runtimeInfo;
  el.stop.disabled = !busy || s !== "running";
  el.stop.hidden = s !== "running";
}

// ---------- modes: edit the code / watch it run ----------

function setMode(m) {
  mode = m;
  el.vizPanel.dataset.mode = m;
}

/** Back to the code: stop any run, drop the trace, so the next run starts at step 1. */
function enterEdit({ focus = false } = {}) {
  if (current && current.kind === "run") stop();
  setPlaying(false);
  hideInspector();
  if (rendered) { rendered.destroy(); rendered = null; prevSnap = null; }
  setMode("edit");
  placeCases();
  // in the editor, keep only the headline of an error/warning ("Line 6: IndexError...");
  // the rest was about stepping through the run
  if (msgKind === "error" || msgKind === "warn") showMessage(el.message.textContent.split("\n")[0], msgKind);
  updateView();
  updateGutter();
  if (focus) {
    el.solution.focus();
    // put the cursor on the line that failed, when it is in the solution
    const line = solutionLineOf(lastErrorLine);
    if (line) selectLine(el.solution, line);
  }
}

function enterWatch() {
  setMode("watch");
  updateView();
}

// The combined program is setup + "\n\n" + solution + ...: map one of its line numbers to the solution's.
function solutionLineOf(programLine) {
  if (!programLine) return null;
  // LeetCode mode: the solution comes first (its setup runs hidden, separately)
  if (lcMode) return programLine <= el.solution.value.split("\n").length ? programLine : null;
  const setup = el.setup.value.replace(/\s+$/, "");
  const offset = setup.trim() ? setup.split("\n").length + 2 : 0;
  const n = programLine - offset;
  return n >= 1 && n <= el.solution.value.split("\n").length ? n : null;
}
function selectLine(ta, n) {
  const lines = ta.value.split("\n");
  const start = lines.slice(0, n - 1).reduce((a, l) => a + l.length + 1, 0);
  ta.setSelectionRange(start, start + lines[n - 1].length);
  const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
  ta.scrollTop = Math.max(0, (n - 4) * lh);
  el.gutter.scrollTop = ta.scrollTop;
}

// line numbers beside the editor
function updateGutter() {
  const n = Math.max(1, el.solution.value.split("\n").length);
  if (el.gutter.dataset.n !== String(n)) {
    el.gutter.dataset.n = String(n);
    el.gutter.textContent = Array.from({ length: n }, (_, i) => i + 1).join("\n");
  }
  el.gutter.scrollTop = el.solution.scrollTop;
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
  const editing = mode === "edit";
  el.editArea.hidden = !editing;
  el.viz.hidden = editing;
  let eaten = false;
  if (editing || rendered) {
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
  updateLayoutAttr();
}

// side-by-side cards (with the control bar docked under the right one) only while a trace is shown
function updateLayoutAttr() {
  const wide = mode === "watch" && rendered && rendered.wide;
  if ((el.vizPanel.dataset.layout === "wide") !== !!wide) {
    el.vizPanel.dataset.layout = wide ? "wide" : "";
    redrawArrows();
  }
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
  const bar = el.stepMeter.querySelector(".bar");
  bar.setAttribute("aria-valuenow", cur);
  bar.setAttribute("aria-valuemax", total);
  const atStart = viz.curInstr <= 0, atEnd = viz.curInstr >= viz.curTrace.length - 1;
  $("nav-first").disabled = $("nav-prev").disabled = atStart;
  $("nav-next").disabled = $("nav-last").disabled = atEnd;
}

// ---------- step navigation (header transport, keys, scrubber) ----------

function goStep(where) {
  if (!rendered) return;
  const v = rendered.viz, last = v.curTrace.length - 1;
  if (where === "first") v.renderStep(0);
  else if (where === "last") v.renderStep(last);
  else if (where === "prev") v.stepBack();
  else if (where === "next") v.stepForward();
  else v.renderStep(Math.max(0, Math.min(last, where)));
}
function userStep(where) { setPlaying(false); goStep(where); }

function initStepControls() {
  for (const [id, where] of [["nav-first", "first"], ["nav-prev", "prev"], ["nav-next", "next"], ["nav-last", "last"]]) {
    $(id).addEventListener("click", () => userStep(where));
  }
  // scrubber: click or drag the step meter's bar
  const bar = el.stepMeter.querySelector(".bar");
  const stepAt = (x) => {
    const r = bar.getBoundingClientRect();
    const f = Math.min(1, Math.max(0, (x - r.left) / r.width));
    return Math.round(f * (rendered.viz.curTrace.length - 1));
  };
  bar.addEventListener("pointerdown", (e) => {
    if (!rendered) return;
    e.preventDefault();
    bar.setPointerCapture(e.pointerId);
    bar.classList.add("dragging");
    setPlaying(false);
    goStep(stepAt(e.clientX));
  });
  bar.addEventListener("pointermove", (e) => {
    if (!rendered || !bar.hasPointerCapture(e.pointerId)) return;
    const s = stepAt(e.clientX);
    if (s !== rendered.viz.curInstr) goStep(s);
  });
  const end = (e) => { if (bar.hasPointerCapture(e.pointerId)) bar.releasePointerCapture(e.pointerId); bar.classList.remove("dragging"); };
  bar.addEventListener("pointerup", end);
  bar.addEventListener("pointercancel", end);
  bar.addEventListener("keydown", (e) => {
    const map = e.shiftKey ? { ArrowLeft: "first", ArrowRight: "last" }
      : { ArrowLeft: "prev", ArrowDown: "prev", ArrowRight: "next", ArrowUp: "next", Home: "first", End: "last" };
    if (e.key === " ") { e.preventDefault(); e.stopPropagation(); setPlaying(!playTimer); return; }
    if (map[e.key]) { e.preventDefault(); e.stopPropagation(); userStep(map[e.key]); }
  });
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
  // a signature per heap object (its cell values, pointers included) to tell
  // which objects changed on this step
  const objSig = new Map();
  for (const [k, { v }] of values) {
    if (!k.startsWith("h:")) continue;
    const id = k.slice(2, k.indexOf("|"));
    objSig.set(id, (objSig.get(id) || "") + "\u0001" + k + "=" + v);
  }
  for (const k of boxes.keys()) if (k.startsWith("o:") && !objSig.has(k.slice(2))) objSig.set(k.slice(2), "");
  return { values, boxes, arrows, objSig, step: viz.curInstr };
}

function retrigger(els, cls) {
  if (!els.length) return;
  for (const e of els) e.classList.remove(cls);
  void document.body.offsetWidth;                            // restart the CSS animation
  for (const e of els) e.classList.add(cls);
}

function animateStep(viz) {
  // keep moved boxes and zoom on every step (the renderer redrew this step's arrows before them)
  if (!stageIsDefault()) applyStage();
  if (inspected) requestAnimationFrame(refreshInspector);   // live value as you step
  markCurrentLine(viz);
  // drop the archive's "(see UNSUPPORTED FEATURES)" pointer from error text
  const eo = viz.domRoot && viz.domRoot[0].querySelector("#errorOutput");
  if (eo && /\(see\b/.test(eo.textContent)) eo.textContent = eo.textContent.replace(/\s*\(see[\s\S]*?\)\s*$/, "");
  const out = viz.domRoot && viz.domRoot[0].querySelector("#progOutputs");
  if (out) {
    const empty = !(viz.curTrace[viz.curInstr] || {}).stdout;
    // the renderer has already drawn this step's arrows; showing/hiding the
    // output box moves the data under them, so draw them again
    if (out.classList.contains("vlEmpty") !== empty) { out.classList.toggle("vlEmpty", empty); redrawArrows(); }
  }
  const snap = snapshotStep(viz);
  const prev = prevSnap;
  prevSnap = snap;
  if (!snap) return;
  // marks describe ONE step: clear the previous step's (the renderer may reuse those cells)
  for (const e of viz.domRoot[0].querySelectorAll(".vlChanged, .vlNew")) e.classList.remove("vlChanged", "vlNew");
  // only mark what one step changed: after a jump (End, Home, scrubbing) everything
  // would look "changed", which tells you nothing
  if (!prev || Math.abs(snap.step - prev.step) !== 1) return;
  const changed = [], fresh = [];
  for (const [k, cur] of snap.values) {
    const old = prev.values.get(k);
    // a value in a brand-new frame/object isn't marked: the whole box animates in
    const boxKey = (k[0] === "v" ? "f:" : "o:") + k.slice(2, k.indexOf("|"));
    if (old ? old.v !== cur.v : prev.boxes.has(boxKey)) changed.push(cur.el);
  }
  for (const [k, box] of snap.boxes) if (!prev.boxes.has(k)) fresh.push(box);
  retrigger(changed, "vlChanged");
  retrigger(fresh, "vlNew");
  // objects that are new or whose contents changed on this step
  const touched = new Set();
  for (const [id, sig] of snap.objSig) if (prev.objSig.get(id) !== sig) touched.add(id);
  // highlight a pointer that is new or re-pointed (its cell changed value, or it sits in a
  // brand-new frame/object), or that points at an object that changed. Not judged by
  // arrow ids: arrows starting inside objects are numbered in render order, so their
  // ids shift whenever the layout does.
  const changedCells = new Set(changed);
  const hot = (c) => {
    if (touched.has(c.targetId)) return true;
    const src = document.getElementById(c.sourceId);
    if (!src) return false;
    const cell = src.closest("td");
    return (cell && changedCells.has(cell)) || fresh.some((box) => box.contains(src));
  };
  const layer = viz.dataViz && viz.dataViz.jsPlumbInstance;
  if ((layer && layer.conns || []).some(hot)) {
    // arrows are drawn on the next frame; tag them once they exist
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!rendered || rendered.viz !== viz || viz.curInstr !== snap.step) return;   // already moved on
      retrigger(((layer && layer.conns) || []).filter(hot).map((c) => c.canvas), "vlNewArrow");
    }));
  }
}

function markCurrentLine(viz) {
  const rows = viz.domRoot ? viz.domRoot[0].querySelectorAll("#pyCodeOutput td.cod") : [];
  const entry = viz.curTrace[viz.curInstr] || {};
  // the line an exception was raised on (also for a syntax error's single step)
  const errLine = /exception/.test(entry.event || "") ? entry.line : null;
  rows.forEach((td, i) => {
    td.parentElement.classList.toggle("vlCurLine", i + 1 === viz.curLineNumber && i + 1 !== errLine);
    td.parentElement.classList.toggle("vlErrLine", i + 1 === errLine);
  });
}

// ---------- stage: zoom, pan, drag boxes, hover arrows, inspect values ----------
// The frames/objects area (#dataViz) is zoomed and panned with a CSS transform; frames and
// objects can be dragged (a translate on each, remembered across steps). The arrow layer
// sits outside #dataViz and measures on-screen positions, so a redraw keeps it exact.

const stage = { scale: 1, x: 0, y: 0, offsets: new Map(), trace: null };
const ZOOM_MIN = 0.4, ZOOM_MAX = 2.5;

const vizRoot = () => rendered && rendered.viz.domRoot && rendered.viz.domRoot[0];
const card = () => { const r = vizRoot(); return r && r.querySelector("#vizLayoutTdSecond"); };
const dataViz = () => { const r = vizRoot(); return r && r.querySelector("#dataViz"); };
const layerConns = () => (rendered && rendered.viz.dataViz && rendered.viz.dataViz.jsPlumbInstance && rendered.viz.dataViz.jsPlumbInstance.conns) || [];

// a draggable box: a top-level object or a frame, keyed so it can be found again next step
function boxOf(target) {
  const r = vizRoot();
  if (!r || !target.closest) return null;
  const top = target.closest('[id^="toplevel_heap_object_"]');     // a <td class="toplevelHeapObject">

  if (top && r.contains(top)) return { el: top, key: top.id };
  const frame = target.closest("div.stackFrame, div.zombieStackFrame");
  if (frame && r.contains(frame)) return { el: frame, key: frame.dataset.frame_id ? "frame:" + frame.dataset.frame_id : frame.id };
  return null;
}
function findBox(key) {
  const r = vizRoot();
  if (!r) return null;
  if (key.startsWith("frame:")) return r.querySelector(`[data-frame_id="${CSS.escape(key.slice(6))}"]`);
  return r.querySelector("#" + CSS.escape(key));
}

function applyStage({ redraw = true } = {}) {
  const dv = dataViz();
  if (!dv) return;
  dv.style.transformOrigin = "0 0";
  dv.style.transform = stage.scale === 1 && !stage.x && !stage.y ? "" : `translate(${stage.x}px, ${stage.y}px) scale(${stage.scale})`;
  for (const [key, o] of stage.offsets) {
    const el = findBox(key);
    if (el) el.style.transform = `translate(${o.x}px, ${o.y}px)`;
  }
  const label = document.getElementById("zoom-level");
  if (label) label.textContent = Math.round(stage.scale * 100) + "%";
  if (redraw && rendered) rendered.viz.redrawConnectors();
}
const stageIsDefault = () => stage.scale === 1 && !stage.x && !stage.y && !stage.offsets.size;

function resetStage() {
  for (const key of stage.offsets.keys()) { const el = findBox(key); if (el) el.style.transform = ""; }
  stage.scale = 1; stage.x = 0; stage.y = 0; stage.offsets.clear();
  applyStage();
}

function zoomBy(factor, clientX, clientY) {
  const dv = dataViz();
  if (!dv) return;
  const s1 = stage.scale, s2 = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, s1 * factor));
  if (s2 === s1) return;
  const rect = dv.getBoundingClientRect();
  // zoom around the pointer (or the card's centre): keep that point still
  const c = card().getBoundingClientRect();
  const px = (clientX ?? c.left + c.width / 2) - (rect.left - stage.x);
  const py = (clientY ?? c.top + c.height / 3) - (rect.top - stage.y);
  stage.x = px - (px - stage.x) * (s2 / s1);
  stage.y = py - (py - stage.y) * (s2 / s1);
  stage.scale = s2;
  applyStage();
}

// the small toolbar in the visualization card's corner
let stageBar = null;
function mountStageBar() {
  const c = card();
  if (!c) return;
  if (!stageBar) {
    stageBar = document.createElement("div");
    stageBar.className = "stage-bar";
    stageBar.innerHTML =
      '<button type="button" data-zoom="out" title="Zoom out (Ctrl+wheel)" aria-label="Zoom out">−</button>' +
      '<span id="zoom-level" title="Zoom">100%</span>' +
      '<button type="button" data-zoom="in" title="Zoom in (Ctrl+wheel)" aria-label="Zoom in">+</button>' +
      '<button type="button" data-zoom="reset" class="reset" title="Reset zoom, pan and moved boxes">Reset layout</button>';
    stageBar.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      if (b.dataset.zoom === "in") zoomBy(1.2);
      else if (b.dataset.zoom === "out") zoomBy(1 / 1.2);
      else resetStage();
    });
  }
  c.prepend(stageBar);
  applyStage({ redraw: false });
}

// --- dragging: a box moves it, the background pans; a press without movement is a click ---
let drag = null;
el.viz.addEventListener("pointerdown", (e) => {
  const c = card();
  if (e.button !== 0 || !c || !c.contains(e.target) || e.target.closest(".stage-bar, button, a")) return;
  const box = boxOf(e.target);
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false, box, target: e.target };
  c.setPointerCapture(e.pointerId);
  e.preventDefault();                                      // no text selection while dragging
});
let dragRaf = 0;
el.viz.addEventListener("pointermove", (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.lastX, dy = e.clientY - drag.lastY;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 4) return;
  if (!drag.moved) { drag.moved = true; card().classList.add(drag.box ? "dragging-box" : "panning"); hideInspector(); }
  drag.lastX = e.clientX; drag.lastY = e.clientY;
  if (drag.box) {
    const o = stage.offsets.get(drag.box.key) || { x: 0, y: 0 };
    o.x += dx / stage.scale; o.y += dy / stage.scale;
    stage.offsets.set(drag.box.key, o);
    drag.box.el.style.transform = `translate(${o.x}px, ${o.y}px)`;
  } else {
    stage.x += dx; stage.y += dy;
    dataViz().style.transform = `translate(${stage.x}px, ${stage.y}px) scale(${stage.scale})`;
  }
  if (!dragRaf) dragRaf = requestAnimationFrame(() => { dragRaf = 0; if (rendered) rendered.viz.redrawConnectors(); });
});
const endDrag = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  const c = card();
  if (c) { c.classList.remove("dragging-box", "panning"); if (c.hasPointerCapture(e.pointerId)) c.releasePointerCapture(e.pointerId); }
  if (!d.moved && e.type === "pointerup") inspectAt(d.target, e.clientX, e.clientY);
};
el.viz.addEventListener("pointerup", endDrag);
el.viz.addEventListener("pointercancel", endDrag);
el.viz.addEventListener("wheel", (e) => {
  const c = card();
  if (!c || !c.contains(e.target) || !(e.ctrlKey || e.metaKey)) return;   // plain wheel scrolls as usual
  e.preventDefault();
  zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
}, { passive: false });

// --- hovering: an arrow, a variable/field or an object lights up its arrows ---
// (arrows are 1.5px; each gets an invisible wide twin so it's easy to point at)
function addArrowHitAreas() {
  for (const c of layerConns()) {
    const p = c.canvas.querySelector("path:not(.vlHit)");
    if (!p || c.canvas.querySelector("path.vlHit")) continue;
    const hit = p.cloneNode(false);
    hit.setAttribute("class", "vlHit");
    c.canvas.insertBefore(hit, p);
  }
}
const arrowObserver = new MutationObserver(() => { if (rendered) addArrowHitAreas(); });
function watchArrows() {
  arrowObserver.disconnect();
  const svg = vizRoot() && vizRoot().querySelector(".vlArrowLayer");
  if (svg) arrowObserver.observe(svg, { childList: true, subtree: true });
  else requestAnimationFrame(() => { const s = vizRoot() && vizRoot().querySelector(".vlArrowLayer"); if (s) { arrowObserver.observe(s, { childList: true, subtree: true }); addArrowHitAreas(); } });
}

let hoverEls = [];
function setHover(conns, ends = []) {
  for (const x of hoverEls) x.classList.remove("vlHover");
  hoverEls = [...conns.map((c) => c.canvas), ...ends];
  for (const x of hoverEls) x.classList.add("vlHover");
}
el.viz.addEventListener("mouseover", (e) => {
  if (drag || !rendered) return;
  const t = e.target;
  const g = t.closest && t.closest(".vlArrowLayer g");
  if (g) {
    const c = layerConns().find((k) => k.canvas === g);
    if (c) setHover([c], [document.getElementById(c.targetId), (document.getElementById(c.sourceId) || {}).closest?.("td")].filter(Boolean));
    return;
  }
  const cell = t.closest && t.closest("td.stackFrameValue, td.stackFrameVar, td.listElt, td.tupleElt, td.setElt, td.dictVal, td.instVal, td.classVal");
  const obj = t.closest && t.closest(".heapObject");
  if (!cell && !obj) { setHover([]); return; }
  const valueCell = cell && cell.classList.contains("stackFrameVar") ? cell.nextElementSibling : cell;
  const related = layerConns().filter((c) => {
    const src = document.getElementById(c.sourceId);
    if (valueCell && src && valueCell.contains(src)) return true;                 // pointers out of this cell
    return !valueCell && obj && (c.targetId === obj.id || (src && obj.contains(src))); // into / out of this object
  });
  setHover(related);
});
el.viz.addEventListener("mouseleave", () => setHover([]));

// --- inspecting: what a variable/field/object holds right now, and where it's used ---
function reprValue(v, heap, depth = 0, seen = new Set()) {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (typeof v === "number") return String(v);
  if (typeof v === "string") return JSON.stringify(v).replace(/^"|"$/g, "'");
  if (!Array.isArray(v)) return String(v);
  if (v[0] === "REF") return reprObject(v[1], heap, depth, seen);
  if (v[0] === "IMPORTED_FAUX_PRIMITIVE" || v[0] === "SPECIAL_FLOAT") return String(v[1]);
  return String(v[0]).toLowerCase();
}
function reprObject(id, heap, depth = 0, seen = new Set()) {
  const o = heap && heap[id];
  if (!o) return "…";
  if (seen.has(id)) return "<cycle>";
  if (depth > 3) return "…";
  const s = new Set(seen).add(id);
  const sub = (x) => reprValue(x, heap, depth + 1, s);
  const items = (arr, f) => (arr.length > 20 ? arr.slice(0, 20).map(f).concat(`… ${arr.length - 20} more`) : arr.map(f)).join(", ");
  switch (o[0]) {
    case "LIST": return "[" + items(o.slice(1), sub) + "]";
    case "TUPLE": return "(" + items(o.slice(1), sub) + (o.length === 2 ? ",)" : ")");
    case "SET": return o.length > 1 ? "{" + items(o.slice(1), sub) + "}" : "set()";
    case "DICT": return "{" + items(o.slice(1), ([k, v]) => sub(k) + ": " + sub(v)) + "}";
    case "INSTANCE": return o[1] + "(" + items(o.slice(2), ([k, v]) => k + "=" + sub(v)) + ")";
    case "INSTANCE_PPRINT": return String(o[2]);
    case "CLASS": return "class " + o[1];
    case "FUNCTION": return String(o[1]);
    default: return String(o[0]).toLowerCase();
  }
}
function typeOfObject(id, heap) {
  const o = heap && heap[id];
  if (!o) return "object";
  const n = o.length - 1;
  switch (o[0]) {
    case "LIST": return `list · ${n} item${n === 1 ? "" : "s"}`;
    case "TUPLE": return `tuple · ${n} item${n === 1 ? "" : "s"}`;
    case "SET": return `set · ${n} item${n === 1 ? "" : "s"}`;
    case "DICT": return `dict · ${n} key${n === 1 ? "" : "s"}`;
    case "INSTANCE": return `${o[1]} instance`;
    case "INSTANCE_PPRINT": return `${o[1]} instance`;
    default: return String(o[0]).toLowerCase();
  }
}
const heapIdOf = (domId) => (domId || "").replace(/^.*heap_object_/, "");

let inspected = null;      // what the inspector is showing: { kind: "var", frameKey, name } | { kind: "obj", id }
const inspector = document.createElement("div");
inspector.className = "inspector";
inspector.hidden = true;
inspector.setAttribute("role", "dialog");
document.body.append(inspector);

function hideInspector() {
  inspected = null;
  inspector.hidden = true;
  clearCodeMarks();
  for (const x of document.querySelectorAll("#viz .vlInspected")) x.classList.remove("vlInspected");
}

// resolve what was clicked in the visualization into something to inspect
function inspectAt(target, x, y) {
  const r = vizRoot();
  if (!r) return;
  const cell = target.closest("td.stackFrameValue, td.stackFrameVar");
  if (cell) {
    const row = cell.parentElement;
    const name = row.querySelector("td.stackFrameVar")?.textContent.trim();
    const frame = cell.closest("div.stackFrame, div.zombieStackFrame");
    if (name && frame) return showInspector({ kind: "var", frameKey: frame.dataset.frame_id || frame.id, name }, x, y);
  }
  const obj = target.closest(".heapObject");
  if (obj) return showInspector({ kind: "obj", id: heapIdOf(obj.id) }, x, y);
  hideInspector();
}

// click a name in the code: inspect that variable (current frame first, then globals).
// Capture phase + stopPropagation: the renderer's own click on a code line toggles a
// breakpoint (which changes how Next steps), so that click must not reach it.
el.viz.addEventListener("click", (e) => {
  const cod = e.target.closest && e.target.closest("#pyCodeOutput td.cod, #pyCodeOutput td.lineNo");
  if (!cod || !rendered) return;
  e.stopPropagation();
  if (!cod.classList.contains("cod")) return;
  const pos = document.caretPositionFromPoint ? document.caretPositionFromPoint(e.clientX, e.clientY) : null;
  const range = !pos && document.caretRangeFromPoint ? document.caretRangeFromPoint(e.clientX, e.clientY) : null;
  const node = pos ? pos.offsetNode : range && range.startContainer;
  const off = pos ? pos.offset : range && range.startOffset;
  if (!node || node.nodeType !== 3) return hideInspector();
  const text = node.textContent;
  let a = off, b = off;
  while (a > 0 && /\w/.test(text[a - 1])) a--;
  while (b < text.length && /\w/.test(text[b])) b++;
  const word = text.slice(a, b);
  if (!/^[A-Za-z_]\w*$/.test(word)) return hideInspector();
  const r = vizRoot();
  const frames = [...r.querySelectorAll("div.highlightedStackFrame"), ...r.querySelectorAll("div.stackFrame")];
  for (const f of frames) {
    const row = [...f.querySelectorAll("td.stackFrameVar")].find((td) => td.textContent.trim() === word);
    if (row) return showInspector({ kind: "var", frameKey: f.dataset.frame_id || f.id, name: word }, e.clientX, e.clientY);
  }
  showInspector({ kind: "name", name: word }, e.clientX, e.clientY);    // not a live variable: still mark its uses
}, true);

function showInspector(what, x, y) {
  inspected = what;
  inspector.style.left = Math.min(window.innerWidth - 340, x + 12) + "px";
  inspector.style.top = Math.min(window.innerHeight - 200, y + 12) + "px";
  refreshInspector();
}

// (re)compute the inspector for the current step; called on every step while it's open
function refreshInspector() {
  if (!inspected || !rendered) return;
  const viz = rendered.viz, r = vizRoot();
  const entry = viz.curTrace[viz.curInstr] || {};
  const heap = entry.heap || {};
  for (const x of r.querySelectorAll(".vlInspected")) x.classList.remove("vlInspected");
  let title = inspected.name || "object", type = "", value = "", names = [];
  if (inspected.kind === "var") {
    const f = r.querySelector(`[data-frame_id="${CSS.escape(String(inspected.frameKey))}"]`) || document.getElementById(inspected.frameKey);
    const row = f && [...f.querySelectorAll("td.stackFrameVar")].find((td) => td.textContent.trim() === inspected.name);
    names = [inspected.name];
    if (!row) { type = "not in scope at this step"; value = "—"; }
    else {
      const valTd = row.nextElementSibling;
      row.parentElement.classList.add("vlInspected");
      const src = valTd && valTd.querySelector(".stack_pointer, [id]");
      const conn = src && layerConns().find((c) => c.sourceId === src.id);
      const frameName = (f.querySelector(".stackFrameHeader") || {}).textContent || "";
      if (conn) {
        const id = heapIdOf(conn.targetId);
        type = typeOfObject(id, heap); value = reprObject(id, heap);
        document.getElementById(conn.targetId)?.classList.add("vlInspected");
      } else {
        const span = valTd && valTd.querySelector(".numberObj, .stringObj, .boolObj, .nullObj, .importedObj");
        type = !span ? "value" : span.classList.contains("numberObj") ? (/[.e]/i.test(span.textContent) ? "float" : "int")
          : span.classList.contains("stringObj") ? "str" : span.classList.contains("boolObj") ? "bool"
          : span.classList.contains("nullObj") ? "NoneType" : "function / class";
        value = valTd ? valTd.textContent.trim() : "";
      }
      type += frameName ? ` · in ${frameName.trim()}` : "";
    }
  } else if (inspected.kind === "obj") {
    title = typeOfObject(inspected.id, heap).split(" · ")[0];
    type = typeOfObject(inspected.id, heap);
    value = heap[inspected.id] ? reprObject(inspected.id, heap) : "no longer exists at this step";
    const objEl = r.querySelector(`[id$="heap_object_${CSS.escape(inspected.id)}"]`);
    objEl && objEl.classList.add("vlInspected");
    // the variables pointing at it, to mark in the code
    for (const c of layerConns()) {
      if (heapIdOf(c.targetId) !== inspected.id) continue;
      const src = document.getElementById(c.sourceId);
      const nm = src && src.closest("tr") && src.closest("tr").querySelector("td.stackFrameVar");
      if (nm) names.push(nm.textContent.trim());
    }
  } else {
    names = [inspected.name];
    type = "not a variable at this step";
    value = "—";
  }
  const lines = markCodeUses([...new Set(names)]);
  inspector.replaceChildren();
  const h = document.createElement("div"); h.className = "ins-title"; h.textContent = title;
  const close = document.createElement("button"); close.type = "button"; close.className = "ins-close"; close.textContent = "×"; close.title = "Close (Esc)";
  close.addEventListener("click", hideInspector);
  h.append(close);
  const t = document.createElement("div"); t.className = "ins-type"; t.textContent = type;
  const v = document.createElement("pre"); v.className = "ins-value"; v.textContent = value;
  const u = document.createElement("div"); u.className = "ins-uses";
  u.textContent = lines.length ? `Used on line${lines.length > 1 ? "s" : ""} ${lines.join(", ")}` : (names.length ? "Not used by name in the code" : "");
  inspector.append(h, t, v, u);
  inspector.hidden = false;
}

// mark every whole-word use of the names in the code panel; returns the line numbers
function clearCodeMarks() {
  for (const m of document.querySelectorAll("#viz mark.vlMark")) {
    const p = m.parentNode;
    p.replaceChild(document.createTextNode(m.textContent), m);
    p.normalize();
  }
}
function markCodeUses(names) {
  clearCodeMarks();
  const r = vizRoot();
  if (!r || !names.length) return [];
  const re = new RegExp("\\b(" + names.map((n) => n.replace(/[^\w]/g, "")).join("|") + ")\\b", "g");
  const lines = [];
  r.querySelectorAll("#pyCodeOutput td.cod").forEach((td, i) => {
    const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    let hit = false;
    for (const n of nodes) {
      const text = n.textContent;
      re.lastIndex = 0;
      if (!re.test(text)) continue;
      re.lastIndex = 0;
      const frag = document.createDocumentFragment();
      let last = 0, m;
      while ((m = re.exec(text))) {
        frag.append(text.slice(last, m.index));
        const mark = document.createElement("mark");
        mark.className = "vlMark";
        mark.textContent = m[0];
        frag.append(mark);
        last = m.index + m[0].length;
      }
      frag.append(text.slice(last));
      n.parentNode.replaceChild(frag, n);
      hit = true;
    }
    if (hit) lines.push(i + 1);
  });
  return lines;
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

  // The program never started (e.g. a syntax error): still open the
  // visualizer so the code is shown with the offending line marked.
  if (steps === 1 && last.event === "uncaught_exception") {
    // that single entry has no frames or heap, which the renderer needs
    trace.trace[0] = Object.assign({ func_name: "<module>", globals: {}, ordered_globals: [], stack_to_render: [], heap: {}, stdout: "" }, last);
    try { el.empty.hidden = true; renderView(trace, 0); el.viz.classList.add("vlNoRun"); } catch (err) { console.warn("LeetScope: could not show the code", err); clearVisualization(); }
    lastErrorLine = last.line || null;
    if (current.info.lc) lc.judge(null, "No result: the program didn't start (see the marked line).");
    setStatus("failed", (last.line ? `Line ${last.line}: ` : "") + last.exception_msg + "\nThe program didn't start. Press Edit to fix the marked line, then Visualize again.");
    finishJob({ status: "failed", steps, exception: last.exception_msg, line: last.line });
    return;
  }
  // A runtime error: open at the step where it failed, so the state that
  // caused it is on screen; stepping back shows how it got there.
  // (the tracer ends such a run with an "exception" or "uncaught_exception" entry)
  const crashed = /exception/.test(last.event || "") && !!last.exception_msg;
  // the exception is recorded again in each frame it unwinds through; open at
  // the first of those steps, where it was raised, not where it surfaced
  // (each unwound frame adds a "return" then an "exception" entry)
  let failStep = steps - 1;
  for (let j = steps - 1; crashed && j > 0; j--) {
    const prev = trace.trace[j - 1];
    if (prev.event === "exception" && prev.exception_msg === last.exception_msg) failStep = j - 1;
    else if (prev.event !== "return") break;
  }
  const failEntry = trace.trace[failStep] || last;
  const tr = performance.now();
  try {
    el.empty.hidden = true;
    renderView(trace, crashed ? failStep : 0);
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
  if (crashed) {
    runCrashed = true;
    lastErrorLine = failEntry.line || null;
    const where = failEntry.line ? ` on line ${failEntry.line}` : "";
    msg = `${(failEntry.exception_msg || last.exception_msg || "Error").split("\n")[0]}${where}, at step ${Math.min(failStep + 1, Math.max(steps - 1, 1))}.\nShowing the moment it failed. Press ← or drag the step bar to see how it got there.`;
    kind = "error";
  } else if (last.event === "instruction_limit_reached") {
    final = "limit reached";
    // the archive's text continues "Please shorten your code, since Python Tutor is not designed..."
    const why = (last.exception_msg || "the program hit a limit").split("\n")[0].replace(/\s*Please shorten your code.*$/i, "");
    msg = "Incomplete: " + why + " Showing the steps recorded so far: look for the loop or recursion that never ends.";
    kind = "warn";
  } else if (last.event === "raw_input") {
    final = "needs input";
    msg = `The program called input(${last.prompt ? JSON.stringify(last.prompt) : ""}) but there are no more input lines. Add a line in the input() tab and visualize again.`;
    kind = "warn";
    selectTab("stdin");
  }
  if (current.info.lc) {
    // the call prints the result last, in LeetCode's format: judge it against the expected output
    if (crashed) lc.judge(null, `No result: your code raised ${(failEntry.exception_msg || last.exception_msg || "an error").split("\n")[0]}${failEntry.line ? ` (line ${failEntry.line})` : ""}.`);
    else if (final !== "complete") lc.judge(null, "No result: the run stopped before your code returned.");
    else lc.judge(resultLine(last.stdout));
    // a note from reading LeetCode (e.g. "couldn't read the Testcase panel") stays visible
    if (!msg && current.info.note) { msg = current.info.note; kind = "info"; }
  }
  setStatus(final, msg, kind);
  finishJob({ status: final, steps, lastEvent: last.event, stdout: last.stdout, exception: last.exception_msg, metrics: lastRun });
}

// Wide panel: code on the left, frames/objects on the right, so the data is
// never below the fold. Narrow panel: code stacked above the data.
const WIDE_MIN = 860;
const isWide = () => el.vizBody.clientWidth >= WIDE_MIN;
// the code column's width for the current panel size (the renderer takes it in px)
const codeWidth = () => Math.round(Math.min(680, Math.max(360, el.vizBody.clientWidth * 0.45)));

function renderView(trace, step) {
  const wide = isWide();
  el.viz.classList.toggle("vlWide", wide);
  el.viz.classList.toggle("vlStacked", !wide);
  el.viz.classList.remove("vlNoRun");
  const opts = { startingInstruction: step, updateOutputCallback: updateStepMeter };
  // LeetCode mode: the test case goes under the code card, so the card leaves room for it
  const casesH = lcMode && wide ? casesHeight() : 0;
  el.vizPanel.style.setProperty("--cases-h", casesH + "px");
  const codeH = Math.max(lcMode ? 180 : 240, el.vizBody.clientHeight - 40 - (casesH ? casesH + 10 : 0));
  if (wide) Object.assign(opts, { verticalStack: false, codeDivWidth: codeWidth(), codeDivHeight: codeH });
  else Object.assign(opts, { verticalStack: true, codeDivHeight: 230 });
  rendered = VisualLeetRenderer.renderTrace("viz", trace, opts);
  rendered.wide = wide;
  rendered.codeW = wide ? codeWidth() : 0;
  rendered.trace = trace;
  if (wide) {
    // use the left column fully: the code card runs down the column, with the
    // program's output under it (rather than above the frames and objects)
    const root = rendered.viz.domRoot[0];
    const out = root.querySelector("#progOutputs");
    const left = root.querySelector("#vizLayoutTdFirst");
    if (out && left && rendered.viz.outputBox) {
      left.appendChild(out);
      rendered.viz.outputBox.domRoot = window.jQuery(left);   // it looks itself up under its own root
    }
  }
  el.vizPanel.style.setProperty("--code-w", (wide ? codeWidth() : 0) + "px");
  placeCases();
  updateLayoutAttr();
  // a new run starts with the default layout; a re-layout of the same run keeps zoom/moves
  if (stage.trace !== trace) { stage.trace = trace; stage.scale = 1; stage.x = 0; stage.y = 0; stage.offsets.clear(); hideInspector(); }
  mountStageBar();
  watchArrows();
  if (!stageIsDefault()) applyStage();
  prevSnap = null;
  rendered.viz.add_pytutor_hook("end_updateOutput", (a) => { animateStep(a.myViz); return [false]; });
  animateStep(rendered.viz);          // baseline for the first step (nothing animates)
  updateStepMeter(rendered.viz);
}

// LeetCode mode: the test-case panel's height while playing (under the code card)
const casesHeight = () => Math.round(Math.min(340, Math.max(230, el.vizBody.clientHeight * 0.4)));

// The test-case panel lives under the code: in the editor while editing, in the
// renderer's left column (under the code card and output) while playing.
function placeCases() {
  const left = lcMode && mode === "watch" && rendered && rendered.viz.domRoot[0].querySelector("#vizLayoutTdFirst");
  const target = left || el.editLeft;
  if (el.lcCases.parentElement !== target) target.appendChild(el.lcCases);
}

// switch layouts when the panel crosses the threshold, keeping the current step
let relayoutTimer = 0;
// (also when the code column's width would change a lot)
const layoutStale = () => rendered && (rendered.wide !== isWide() || (rendered.wide && Math.abs(rendered.codeW - codeWidth()) > 40));
function maybeRelayout() {
  if (!layoutStale()) return;
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    if (!layoutStale()) return;
    const { trace } = rendered, step = rendered.viz.curInstr, playing = !!playTimer;
    setPlaying(false);
    rendered.destroy();
    renderView(trace, step);
    if (playing) setPlaying(true);
  }, 150);
}

function clearVisualization() {
  setPlaying(false);
  hideInspector();
  if (rendered) { rendered.destroy(); rendered = null; }
  prevSnap = null;
  placeCases();
  updateView();
}

function startJob(kind, extra = {}, info = {}) {
  if (!IDLE.has(status) || !runtimeInfo) {
    showMessage(runtimeInfo ? "A run is already in progress." : "The Python runtime is still starting.", "info");
    return Promise.resolve({ status: "rejected", message: "Runtime is " + status });
  }
  const runId = crypto.randomUUID();
  setPlaying(false);
  runCrashed = false;
  return new Promise((resolve) => {
    current = {
      runId, kind, resolve, info, tClick: performance.now(),
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

function visualize(opts = {}) {
  return lcMode ? visualizeCase(opts) : visualizePasted();
}

// LeetCode mode: your code + the call from the problem's database file; the
// inputs are built by hidden setup, which runs untraced.
function visualizeCase(opts = {}) {
  if (!lc.problem) { showMessage("Click Visualize on a LeetCode problem (or the LeetScope icon there) first.", "info"); return Promise.resolve({ status: "rejected" }); }
  const g = lc.program();
  if (!g.ok) {
    showCodeView("code");
    showMessage("Fix the highlighted test-case values first.", "error");
    return Promise.resolve({ status: "rejected", reason: "case", errors: g.errors });
  }
  const solution = el.solution.value;
  if (!solution.trim()) { showMessage("There's no code yet: click Visualize on the LeetCode tab to copy it.", "info"); return Promise.resolve({ status: "rejected" }); }
  const source = solution.replace(/\s+$/, "") + "\n\n" + g.code + "\n";
  if (new TextEncoder().encode(source + g.setup).length > MAX_SOURCE_BYTES) {
    showMessage("The program is larger than 256 KiB; LeetScope is meant for small examples.", "error");
    return Promise.resolve({ status: "rejected" });
  }
  if (IDLE.has(status) && runtimeInfo) { lastErrorLine = null; enterWatch(); }
  return startJob("run", { source, inputs: [], setup: g.setup, setupVisible: g.visible }, { lc: true, note: opts.note || "" });
}

function visualizePasted() {
  const parts = program();                          // captured at click time
  const source = composeSource(parts);
  if (!source.trim()) { showMessage("Add some Python code first.", "info"); return Promise.resolve({ status: "rejected" }); }
  if (new TextEncoder().encode(source).length > MAX_SOURCE_BYTES) {
    showMessage("The program is larger than 256 KiB; LeetScope is meant for small examples.", "error");
    return Promise.resolve({ status: "rejected" });
  }
  if (!hasTopLevelCode(source)) {
    showMessage("Your code only defines functions or classes, so nothing would run. Add a test call, e.g. print(Solution().twoSum([2, 7, 11, 15], 9))", "error");
    el.call.focus();
    return Promise.resolve({ status: "rejected", reason: "no-call" });
  }
  const inputs = el.inputs.value === "" ? [] : el.inputs.value.replace(/\r/g, "").split("\n");
  // switch to the player only when the run will actually start (startJob explains otherwise)
  if (IDLE.has(status) && runtimeInfo) { lastErrorLine = null; enterWatch(); }
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
  enterEdit();            // new code: back to the editor; the next run starts from step 1
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
    showMessage("Open LeetScope from the toolbar button while on the page you want to import from.", "error");
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
    setLcMode(false);
    el.solution.value = res.text;
    saveDraft();
    enterEdit();
    showMessage(`Imported ${res.text.split("\n").length} lines from the selection into Solution. Review it, add a test call if needed, then Visualize.`, "ok");
    return res;
  }
  return openLeetCode(res, { autoRun: true });
}

// ---------- LeetCode mode ----------

function setLcMode(on) {
  // production: always LeetCode mode (an empty state until a problem is opened)
  lcMode = DEV ? !!on && !!lc.problem : true;
  document.body.classList.toggle("mode-lc", lcMode);
  const empty = lcMode && !lc.problem;
  document.body.classList.toggle("no-problem", empty);
  $("lc-empty").hidden = !empty;
  el.modeToggle.hidden = !DEV || !lc.problem;
  el.modeToggle.textContent = lcMode ? "Paste mode" : "LeetCode mode";
  el.modeToggle.title = lcMode ? "Paste or type any Python program instead" : "Back to the LeetCode problem and its test cases";
  try { localStorage.setItem(LC_MODE_KEY, lcMode ? "lc" : "manual"); } catch {}
  document.querySelector(".bar-hint").textContent = lcMode
    ? "Runs your code on the selected test case, then plays it step by step."
    : "Runs Setup, your code and the Test call, then plays it step by step.";
  if (mode === "watch") enterEdit();         // the other mode's run doesn't belong here
  placeCases();
  updateGutter();
}

// Your code / Call / Setup: the views of the code card (LeetCode mode)
function showCodeView(name) {
  for (const t of document.querySelectorAll("[data-codeview]")) t.setAttribute("aria-selected", String(t.dataset.codeview === name));
  for (const p of document.querySelectorAll("[data-codepanel]")) p.hidden = p.dataset.codepanel !== name;
  if (name === "code") updateGutter();
}

/**
 * Show what was read from a LeetCode problem page: its code, its database
 * entry and test cases, the case selected in LeetCode's Testcase panel.
 * Plays it right away when everything checks out (one click).
 */
async function openLeetCode(res, { autoRun = false } = {}) {
  if (!res || !res.ok) {
    showMessage((res && res.error) || "Couldn't read the LeetCode page.", "error");   // current code and cases kept
    return res || { ok: false };
  }
  const entry = await loadEntry(res.slug);
  const lang = describeLanguage(res.language || "");
  if (!entry && !DEV) {
    showMessage(`"${res.title || res.slug}" isn't in LeetScope's problem database yet. The database covers the NeetCode 150 for now and is growing.`, "info");
    return { ok: false, reason: "not-in-db", slug: res.slug };
  }
  if (!entry) {
    // dev/test builds: paste mode with a drafted test call
    setLcMode(false);
    if (res.code && lang.ok) {
      const draft = draftForSolution(res.code, []);
      setProgram({ setup: draft.setup, solution: res.code, call: draft.call });
      selectTab("call");
      const first = (res.exampleInputs || [])[0];
      showMessage([`"${res.title || res.slug}" isn't in LeetScope's problem database yet, so you're in paste mode: check the drafted test call.`,
        first ? `LeetCode's first example input: ${first.split("\n").join(", ")}` : "", lang.note, ...draft.notes].filter(Boolean).join("\n"), "info");
    } else {
      showMessage(`"${res.title || res.slug}" isn't in LeetScope's problem database yet. ${!res.code ? "Couldn't read the code editor either (is the page still loading?)." : lang.note}`, "error");
    }
    return { ok: false, reason: "not-in-db", slug: res.slug };
  }
  const loaded = lc.loadFromPage(res, entry);
  setLcMode(true);
  showCodeView("code");
  const notes = [loaded.note];
  let runnable = true;
  // never run older code in place of what the click was meant to show
  if (!res.code) { notes.push("Couldn't read LeetCode's code editor (is it still loading?). Your code here was kept; press Visualize to run it."); runnable = false; }
  else if (!lang.ok) { notes.push(lang.note); runnable = false; }
  else { el.solution.value = res.code; saveDraft(); updateGutter(); if (lang.note) notes.push(lang.note); }
  const note = notes.filter(Boolean).join("\n");
  enterEdit();
  showMessage(note, "info");
  if (autoRun && runnable) {
    await window.visualleet.whenReady();
    return Object.assign(await visualize({ note }), { problem: res.slug, fromLeetCode: loaded.fromLeetCode });
  }
  return { ok: true, problem: res.slug, fromLeetCode: loaded.fromLeetCode, ran: false };
}

// The background worker stores what a click on LeetCode read; take it once.
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
  el.sourceTab.textContent = title || url ? `from: ${title || url}` : "";
  el.sourceTab.title = url ? `Imports come from ${url}` : "Page to import from";
}

// ---------- wiring ----------

const ALL_EXAMPLES = Object.assign({}, EXAMPLES, SHOWCASE_EXAMPLES, ERROR_EXAMPLES);
for (const [label, set] of [["Examples", EXAMPLES], ["Diagram showcase", SHOWCASE_EXAMPLES], ["Errors & bugs", ERROR_EXAMPLES]]) {
  const group = document.createElement("optgroup");
  group.label = label;
  for (const name of Object.keys(set)) group.append(new Option(name, name));
  el.example.append(group);
}
for (const name of Object.keys(HELPERS)) el.helper.add(new Option(name, name));

el.example.addEventListener("change", () => {
  const ex = ALL_EXAMPLES[el.example.value];
  if (ex) {
    setLcMode(false);
    setProgram({ setup: ex.setup, solution: ex.solution, call: ex.call, inputs: ex.inputs || "" });
    selectTab(ex.inputs ? "stdin" : "call");
    showMessage("", "info");
  }
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
new ResizeObserver(() => { redrawArrows(); maybeRelayout(); }).observe(el.vizBody);
el.diagToggle.addEventListener("click", () => {
  const on = el.diag.hidden;
  el.diag.hidden = !on;
  el.diagToggle.setAttribute("aria-pressed", String(on));
  el.diagToggle.title = on ? "Hide diagnostics" : "Show diagnostics";
});
$("play").addEventListener("click", () => setPlaying(!playTimer));
$("speed").addEventListener("change", () => { if (playTimer) setPlaying(true); });
el.edit.addEventListener("click", () => enterEdit({ focus: true }));
el.solution.addEventListener("input", updateGutter);
el.solution.addEventListener("scroll", () => { el.gutter.scrollTop = el.solution.scrollTop; });
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.defaultPrevented) { e.preventDefault(); if (!el.visualize.disabled) visualize(); return; }
  // Esc: close the inspector first; otherwise, while watching, back to the code
  if (e.key === "Escape" && inspected) { e.preventDefault(); hideInspector(); return; }
  if (e.key === "Escape" && mode === "watch" && !e.target.closest("select")) { e.preventDefault(); enterEdit({ focus: true }); return; }
  // Player keys (like a video player): Space play/pause, ← → one step, Shift+← Shift+→ start/end.
  // Active unless you're typing, or on a control that isn't part of the player.
  if (!rendered || mode !== "watch" || e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const onPlayer = t.closest && t.closest("#player, #step-meter");
  if (t.closest && t.closest("textarea, input, select, a, [role=slider]")) return;
  if (t.closest && t.closest("button") && !onPlayer) return;
  const steps = e.shiftKey ? { ArrowLeft: "first", ArrowRight: "last" } : { ArrowLeft: "prev", ArrowRight: "next", Home: "first", End: "last" };
  if (e.key === " ") { e.preventDefault(); setPlaying(!playTimer); }      // preventDefault also stops the button's own click
  else if (steps[e.key]) { e.preventDefault(); userStep(steps[e.key]); }
});
initStepControls();
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
el.importSelection.addEventListener("click", () => requestImport("selection"));
window.addEventListener("pagehide", () => { if (iframe) iframe.remove(); clearVisualization(); });

el.modeToggle.addEventListener("click", () => setLcMode(!lcMode));
for (const t of document.querySelectorAll("[data-codeview]")) t.addEventListener("click", () => showCodeView(t.dataset.codeview));
$("case-run").addEventListener("click", () => visualize());

const draft = loadDraft();
setProgram(draft || EXAMPLES["Two Sum"]);
setLcMode(false);
if (sourceTabId) chrome.runtime.sendMessage({ type: "describe-tab", tabId: sourceTabId }).then((r) => r && showSourceTab(r.title, r.url)).catch(() => {});
createSandbox();

// Back to the last LeetCode problem, then take a case a click on LeetCode left for us.
const started = (async () => {
  const last = lc.lastSlug();
  const entry = last ? await loadEntry(last) : null;
  if (entry && lc.restore(entry)) {
    let saved = null;
    try { saved = localStorage.getItem(LC_MODE_KEY); } catch {}
    setLcMode(saved === "lc");
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
  message: () => el.message.textContent,
  lastRun: () => lastRun,
  lastTrace: () => lastTrace,
  runtimeInfo: () => runtimeInfo,
  rendered: () => rendered,
  started: () => started,
  mode: () => (lcMode ? "lc" : "manual"),
  view: () => mode,                          // "edit" | "watch"
  setMode: (m) => setLcMode(m === "lc"),
  openLeetCode,
  leetcode: lc,
  verdict: () => { const v = $("case-verdict"); return v.hidden ? null : { kind: v.dataset.kind, text: v.textContent }; },
};
