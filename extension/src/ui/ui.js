// LeetScope UI controller (privileged extension page). Owns the sandboxed
// runner iframe, the packaged-asset bridge, run state, the problem and its
// test cases, and the renderer. It never executes Python and never acts on
// runner messages beyond displaying their results.

import { createLeetCodeMode } from "./leetcode-mode.js";
import { resultLine } from "./harness.js";
import { describeLanguage } from "./leet.js";
import { initReport } from "./report.js";

const PROTOCOL = 1;
const LIMITS = { wallMs: 10000, maxTraceBytes: 10 * 1024 * 1024 };
const MAX_SOURCE_BYTES = 256 * 1024;
const BACKSTOP_EXTRA_MS = 4000;   // if the sandbox itself stops answering
const CODE_KEY = "visualleet.draft.v1";      // your code, kept across reloads

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
  message: $("message"), diag: $("diag"), solution: $("solution"), reset: $("reset"),
  viz: $("viz"), vizBody: document.querySelector(".viz-body"), stepMeter: $("step-meter"), diagToggle: $("diag-toggle"),
  vizPanel: document.querySelector(".viz-panel"), codeEditor: $("code-editor"), gutter: document.querySelector("#code-editor .gutter"),
  edit: $("edit"), editArea: $("edit-area"),
  lcCases: $("lc-cases"), editLeft: $("edit-left"), codeCard: document.querySelector(".code-card"),
  caseRun: $("case-run"), vizHead: $("viz-head"), playerBar: $("player-bar"), lcSide: $("lc-side"), sidePh: $("side-ph"),
  diagStrip: $("diag-strip"), lcLink: $("lc-link"),
};
el.codeBody = el.codeCard.querySelector(".code-body");
el.sideHead = el.lcSide.querySelector(".viz-head");

// ---------- the problem: an entry from LeetScope's database + its test cases ----------
const PENDING_MAX_AGE_MS = 2 * 60 * 1000;
let dbIndex = { problems: {} };
const dbReady = fetch(chrome.runtime.getURL("problems/index.json")).then((r) => r.json()).then((d) => { dbIndex = d; }).catch(() => {});
async function loadEntry(slug) {
  await dbReady;
  if (!/^[a-z0-9-]+$/.test(slug || "") || !dbIndex.problems[slug]) return null;
  try { return await (await fetch(chrome.runtime.getURL(`problems/${slug}.json`))).json(); } catch { return null; }
}
const lc = createLeetCodeMode({
  tabs: $("case-tabs"), add: $("case-add"), fields: $("case-fields"), title: $("lc-title"),
  expected: $("case-expected"), verdict: $("case-verdict"), source: $("case-source"),
  call: $("lc-call"), callReset: $("lc-call-reset"), callNote: $("lc-call-note"), setup: $("lc-setup"),
}, {
  // another case picked while playing: run it right away
  onSelect: () => { if (mode === "watch") visualize(); },
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
let sourceUrl = "";        // the page the code and cases were read from
let sourceTabId = Number(new URLSearchParams(location.search).get("sourceTab")) || null;
const waiters = { ready: [], stats: [] };

// ---------- status & messages ----------

const IDLE = new Set(["ready", "complete", "limit reached", "failed", "stopped", "timed out", "needs input"]);
let msgKind = "info";

// No status pill in this design: Run shows a run (it turns into Stop), messages show the rest.
function setStatus(s, message = "", kind = "error") {
  status = s;
  showMessage(message, kind);
  const busy = isBusy();
  // while a run is going, Run becomes Stop (three hopping dots)
  const b = el.caseRun;
  b.classList.toggle("running", busy);
  b.querySelector(".run-label").textContent = busy ? "Stop" : "Run";
  b.setAttribute("aria-label", busy ? "Stop" : "Run");
  b.title = busy ? "Stop" : "Run this case (Ctrl+Enter)";
}
const isBusy = () => status === "running" || status === "preparing visualization";
function runOrStop() { if (isBusy()) stop(); else visualize(); }

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
  // the visualization stays on the right, as it was, while you edit on the
  // left; the next run replaces it
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

// The program is your code then the call (the setup runs hidden, separately):
// a line of it is a line of your code when it's within your code.
function solutionLineOf(programLine) {
  return programLine && programLine <= el.solution.value.split("\n").length ? programLine : null;
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
      return { kind: "loading", title: "Starting Python…", body: "Python loads once in each LeetScope tab. This takes a few seconds.", eats: msgKind === "info" };
    case "running":
    case "preparing visualization":
      return { kind: "loading", title: "Running your code…", body: "Recording every step. Press Stop if it takes too long.", eats: true };
    case "failed":
      if (msg) return { kind: "error", title: "Your code didn't run", detail: msg, body: "Fix the code and press Run again.", eats: true };
      break;
    case "timed out":
      return { kind: "error", title: `Stopped after ${LIMITS.wallMs / 1000} seconds`, body: msg || "Your code ran too long. Try a smaller input.", eats: true };
    case "stopped":
      return { kind: "info", title: "Run stopped", body: "Your code is unchanged. Press Run to start again.", eats: true };
  }
  return { kind: "empty", title: "The visualization plays here", body: "Press Run (Ctrl+Enter) to run your code on the selected test case." };
}

// fill a placeholder element with a state's icon, title and text
function fillPlaceholder(box, ph) {
  const parts = [];
  if (ph.kind === "loading") parts.push(Object.assign(document.createElement("div"), { className: "ph-dots", innerHTML: "<i></i><i></i><i></i>" }));
  else if (ph.kind === "empty") parts.push(Object.assign(document.createElement("img"), { className: "ph-mark", src: "../icons/mark.svg", alt: "" }));
  parts.push(Object.assign(document.createElement("div"), { className: "ph-title", textContent: ph.title }));
  if (ph.detail) parts.push(Object.assign(document.createElement("pre"), { className: "ph-detail", textContent: ph.detail }));
  if (ph.body) parts.push(Object.assign(document.createElement("div"), { className: "ph-body", textContent: ph.body }));
  box.dataset.kind = ph.kind;
  box.replaceChildren(...parts);
}

// a run is on screen (also while editing: it stays beside the editor)
const traceShown = () => !!rendered;

function updateView() {
  if (!el.vizBody) return;
  const busy = isBusy();
  el.vizBody.classList.toggle("busy", busy && !!rendered);
  const editing = mode === "edit";
  const shown = traceShown();
  const frozen = editing && shown;     // editing beside the last run
  // the code stays on screen while a run starts (so Run/Stop can be pressed); the
  // Visualizer side panel shows the state until there's a run to show
  el.editArea.hidden = shown;
  // (renderView unhides #viz before drawing: the renderer skips hidden containers)
  el.viz.hidden = !shown;
  el.viz.classList.toggle("vlEditing", frozen);
  el.edit.setAttribute("aria-pressed", String(editing));
  let eaten = false;
  if (!shown) {
    // the Visualizer side of the editor: what happens next, or the state of a run starting
    const ph = placeholderFor();
    eaten = !!ph.eats;
    fillPlaceholder(el.sidePh, ph);
  }
  const showMsg = !!el.message.textContent && !eaten;
  const h = el.message.hidden ? 0 : el.message.offsetHeight;
  el.message.hidden = !showMsg;
  placeCases();
  if ((showMsg ? el.message.offsetHeight : 0) !== h) redrawArrows();   // the banner moved the trace
  if (!rendered) el.stepMeter.hidden = $("player").hidden = true;
  requestAnimationFrame(positionSplitters);
}


function redrawArrows() {
  if (rendered) requestAnimationFrame(() => rendered && rendered.viz.redrawConnectors());
}

const MAX_TICKS = 120;     // above this many steps the timeline is a plain track
function updateStepMeter(viz) {
  // every position counts, the final "done" state too, so each step visibly moves
  // the counter and the lens (the timeline maps positions 0..length-1 evenly)
  const total = Math.max(viz.curTrace.length, 1);
  const cur = Math.min(viz.curInstr + 1, total);
  el.stepMeter.hidden = $("player").hidden = false;
  el.stepMeter.querySelector(".cur").textContent = cur;
  el.stepMeter.querySelector(".total").textContent = total;
  el.stepMeter.querySelector(".count").setAttribute("aria-label", `Step ${cur} of ${total}`);
  if (el.stepMeter.dataset.total !== String(total)) {
    // one tick per step, evenly spread; the "played" copy is clipped at the handle
    el.stepMeter.dataset.total = String(total);
    for (const row of el.stepMeter.querySelectorAll(".ticks")) {
      row.replaceChildren(...(total <= MAX_TICKS && total > 1
        ? Array.from({ length: total }, (_, i) => { const t = document.createElement("i"); t.style.left = (100 * i / (total - 1)).toFixed(3) + "%"; return t; })
        : []));
    }
  }
  el.stepMeter.style.setProperty("--p", (total > 1 ? (100 * (cur - 1)) / (total - 1) : 0).toFixed(2) + "%");
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

// The Code panel while playing: a band on the current line and two gutter arrows
// (amber: about to run, mint: just ran) that glide from line to line, and lines
// that fade a little with their distance from the current one.
function markCurrentLine(viz) {
  const root = viz.domRoot && viz.domRoot[0];
  const rows = root ? root.querySelectorAll("#pyCodeOutput td.cod") : [];
  const entry = viz.curTrace[viz.curInstr] || {};
  // the line an exception was raised on (also for a syntax error's single step)
  const errLine = /exception/.test(entry.event || "") ? entry.line : null;
  const cur = viz.curLineNumber, prev = viz.prevLineNumber;
  rows.forEach((td, i) => {
    const n = i + 1, tr = td.parentElement;
    tr.classList.toggle("vlCurLine", n === cur && n !== errLine);
    tr.classList.toggle("vlPrevLine", n === prev && n !== cur);
    tr.classList.toggle("vlErrLine", n === errLine);
    tr.dataset.d = cur ? String(Math.min(4, Math.abs(n - cur))) : "0";
  });
  const pane = root && root.querySelector("#pyCodeOutputDiv");
  if (!pane || !rows.length) return;
  let deco = pane.querySelector(":scope > .vl-deco");
  if (!deco) {
    deco = document.createElement("div");
    deco.className = "vl-deco";
    deco.setAttribute("aria-hidden", "true");
    deco.innerHTML = '<div class="vl-band"></div>' +
      '<svg class="vl-arrow vl-arrow-prev" viewBox="0 0 15 12"><use href="#i-line-arrow"/></svg>' +
      '<svg class="vl-arrow vl-arrow-cur" viewBox="0 0 15 12"><use href="#i-line-arrow"/></svg>' +
      // what the arrows mean: shown while the pointer is over the arrow column
      '<span class="vl-tag vl-tag-prev">Line that just ran</span>' +
      '<span class="vl-tag vl-tag-cur">Next line to run</span>';
    pane.prepend(deco);
  }
  const P = pane.getBoundingClientRect();
  const place = (node, line) => {
    const td = line && rows[line - 1];
    if (!td) { node.classList.add("off"); return; }
    const r = td.parentElement.getBoundingClientRect();
    if (!r.height) { node.classList.add("off"); return; }     // not laid out (hidden)
    node.classList.remove("off");
    node.style.setProperty("--y", (r.top - P.top + pane.scrollTop) + "px");
    node.style.setProperty("--h", r.height + "px");
  };
  place(deco.children[0], cur && cur !== errLine ? cur : null);
  place(deco.children[1], prev && prev !== cur ? prev : null);
  place(deco.children[2], cur);
  place(deco.children[3], prev && prev !== cur ? prev : null);
  place(deco.children[4], cur);
}

// hovering the arrow column (left of the line numbers' right edge) labels the arrows
el.viz.addEventListener("mousemove", (e) => {
  const pane = e.target.closest && e.target.closest("#pyCodeOutputDiv");
  const deco = pane && pane.querySelector(":scope > .vl-deco");
  const on = !!deco && e.clientX - pane.getBoundingClientRect().left < 60;
  for (const d of el.viz.querySelectorAll(".vl-deco")) d.classList.toggle("tags", on && d === deco);
});
el.viz.addEventListener("mouseleave", () => { for (const d of el.viz.querySelectorAll(".vl-deco.tags")) d.classList.remove("tags"); });

// Quiet Python colouring for the code while playing: comments and keywords only.
const PY_TOKENS = /(#.*$)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')|\b(and|as|assert|async|await|break|class|continue|def|del|elif|else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|pass|raise|return|try|while|with|yield)\b/g;
function highlightCode(root) {
  for (const td of root.querySelectorAll("#pyCodeOutput td.cod")) {
    if (td.childNodes.length !== 1 || td.firstChild.nodeType !== 3) continue;
    const text = td.firstChild.textContent;
    const frag = document.createDocumentFragment();
    let last = 0, m, hit = false;
    PY_TOKENS.lastIndex = 0;
    while ((m = PY_TOKENS.exec(text))) {
      if (m[2]) continue;                  // strings stay plain (and keep their # and keywords)
      frag.append(text.slice(last, m.index), Object.assign(document.createElement("span"), { className: m[1] ? "tk-c" : "tk-k", textContent: m[0] }));
      last = m.index + m[0].length;
      hit = true;
    }
    if (!hit) continue;
    frag.append(text.slice(last));
    td.replaceChildren(frag);
  }
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

// fit the frames and objects into the visible part of the card
function fitStage() {
  const dv = dataViz(), c = card();
  const content = dv && dv.querySelector("table#stackHeapTable");
  if (!content || !c) return;
  const w = content.offsetWidth, h = content.offsetHeight;
  const head = el.vizHead.offsetHeight, bar = el.playerBar.offsetHeight, msg = el.message.hidden ? 0 : el.message.offsetHeight;
  const aw = c.clientWidth - 36, ah = c.clientHeight - head - bar - msg - 36;
  if (!w || !h || aw <= 0 || ah <= 0) return;
  stage.scale = Math.max(ZOOM_MIN, Math.min(1.5, aw / w, ah / h));
  stage.x = 0; stage.y = 0;
  applyStage();
}

// the Visualizer header: zoom out / level / in, fit, reset layout
el.vizHead.addEventListener("click", (e) => {
  const b = e.target.closest("button[data-zoom]");
  if (!b || !rendered) return;
  if (b.dataset.zoom === "in") zoomBy(1.2);
  else if (b.dataset.zoom === "out") zoomBy(1 / 1.2);
  else if (b.dataset.zoom === "fit") fitStage();
  else resetStage();
});

// --- dragging: a box moves it, the background pans; a press without movement is a click ---
let drag = null;
el.viz.addEventListener("pointerdown", (e) => {
  const c = card();
  if (e.button !== 0 || !c || !c.contains(e.target) || e.target.closest(".viz-head, .player-bar, .message, button, a")) return;
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
  if (!c || !c.contains(e.target) || e.target.closest(".viz-head, .player-bar") || !(e.ctrlKey || e.metaKey)) return;   // plain wheel scrolls as usual
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
    }, speedMs());
  }
  const playing = !!playTimer;
  btn.setAttribute("aria-pressed", String(playing));
  btn.setAttribute("aria-label", playing ? "Pause" : "Play");
  btn.querySelector("use").setAttribute("href", playing ? "#i-pause" : "#i-play");
  btn.querySelector("span").textContent = playing ? "Pause" : "Play";
  el.stepMeter.classList.toggle("playing", playing);    // the dot in the lens breathes
}
const speedMs = () => Number(($("speed").querySelector('[aria-checked="true"]') || {}).dataset?.ms) || 550;

const fmt = (ms) => (ms === undefined || ms === null ? "?" : ms.toFixed(0) + " ms");
// one wrapping line of facts: labels dim, values light, "ready" in mint
function renderDiag() {
  const items = [];
  const item = (...parts) => {
    const s = document.createElement("span");
    s.className = "di";
    for (const p of parts) s.append(typeof p === "string" ? p : Object.assign(document.createElement("span"), { className: p.c || "v", textContent: p.v }));
    items.push(s);
  };
  if (runtimeInfo) {
    const t = runtimeInfo.timings;
    item({ v: `Python ${runtimeInfo.python}` }, ` (Pyodide ${runtimeInfo.pyodide})`);
    item("runtime start ", { v: fmt(runtimeInfo.uiInitMs) });
    items[items.length - 1].title = `worker ${fmt(t.total)}: pyodide ${fmt(t.loadPyodide)}, tracer ${fmt(t.loadTracer)}${t.wasmCompiledOnceMs != null ? `, wasm compiled once in ${fmt(t.wasmCompiledOnceMs)}` : ""}`;
  }
  if (lastRun.steps !== undefined) {
    item("last run ", { v: String(lastRun.steps) }, " steps, ", { v: (lastRun.bytes / 1024).toFixed(0) + " KiB" }, " trace, ", { v: lastRun.interpreterRun === 1 ? "fresh" : "reused" }, " interpreter");
    item("execute ", { v: fmt(lastRun.execMs) });
    item("transfer ", { v: fmt(lastRun.transferMs) });
    item("parse ", { v: fmt(lastRun.parseMs) });
    item("render ", { v: fmt(lastRun.renderMs) });
    item("click to first view ", { v: fmt(lastRun.firstViewMs) });
  }
  if (runtimeInfo) item("spare interpreter ", runtimeInfo.spareReady ? { v: "ready", c: "ok" } : { v: "starting" });
  if (!items.length) item("No diagnostics yet.");
  el.diag.replaceChildren(...items);
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
        .catch((err) => setStatus("failed", "LeetScope couldn't load Python. Reload the extension in chrome://extensions and try again."));
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
      setStatus("failed", "Python failed to start. Press the restart button in LeetScope's top bar to try again.");
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
        setStatus("timed out", `Your code ran for more than ${m.wallMs / 1000} seconds without finishing. It may loop forever, or the input may be too large to show step by step. Try a smaller input.`);
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
    setStatus("failed", "LeetScope couldn't read the result of this run. Press Run to try again.");
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
    try { renderView(trace, 0); el.viz.classList.add("vlNoRun"); } catch (err) { console.warn("LeetScope: could not show the code", err); clearVisualization(); }
    lastErrorLine = last.line || null;
    if (current.info.lc) lc.judge(null, "No result. Your code has an error on the marked line, so it didn't run.");
    setStatus("failed", (last.line ? `Line ${last.line}: ` : "") + last.exception_msg + "\nYour code didn't run. Fix the marked line and press Run again.");
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
    renderView(trace, crashed ? failStep : 0);
    document.body.offsetHeight;
  } catch (err) {
    setStatus("failed", "LeetScope couldn't draw this run. Press Run to try again.");
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
    lastErrorLine = failEntry.line || null;
    const where = failEntry.line ? ` on line ${failEntry.line}` : "";
    msg = `${(failEntry.exception_msg || last.exception_msg || "Error").split("\n")[0]}${where}, at step ${Math.min(failStep + 1, Math.max(steps - 1, 1))}.\nShowing the moment it failed. Press ← or drag the step bar to see how it got there.`;
    kind = "error";
  } else if (last.event === "instruction_limit_reached") {
    final = "limit reached";
    const why = (last.exception_msg || "Stopped at a limit.").split("\n")[0];
    if (/^Stopped after running \d+ steps/.test(why)) {
      const n = (steps - 1).toLocaleString("en-US");
      msg = `Incomplete. Your code ran more than ${n} steps, so only the first ${n} are shown. The code may be correct and simply long. A shorter input will show the whole run.`;
    } else {
      msg = `Incomplete. ${why} Showing the steps recorded so far. A smaller input will show the whole run.`;
    }
    kind = "warn";
  } else if (last.event === "raw_input") {
    final = "needs input";
    msg = "Your code called input(), and LeetCode problems don't read input. Remove the input() call and run again.";
    kind = "warn";
  }
  if (current.info.lc) {
    // the call prints the result last, in LeetCode's format: judge it against the expected output
    if (crashed) lc.judge(null, `No result. Your code raised ${(failEntry.exception_msg || last.exception_msg || "an error").split("\n")[0]}${failEntry.line ? ` (line ${failEntry.line})` : ""}.`);
    else if (final !== "complete") lc.judge(null, "No result. The run stopped before your code returned.");
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
const codeWidth = () => (sizes.leftW ? Math.round(clampN(sizes.leftW, 280, Math.max(280, el.vizBody.clientWidth - 380)))
  // the design's left column: 460px (flex 1 1 460px beside a flex 999 visualizer), less in a narrow window
  : Math.round(Math.max(320, Math.min(460 + Math.max(0, el.vizBody.clientWidth - 1032) / 1000, el.vizBody.clientWidth - 572))));

function renderView(trace, step) {
  // the run gets the whole panel before it's drawn (the renderer measures as it draws)
  el.editArea.hidden = true;
  el.viz.hidden = false;
  const wide = isWide();
  el.viz.classList.toggle("vlWide", wide);
  el.viz.classList.toggle("vlStacked", !wide);
  el.viz.classList.remove("vlNoRun");
  const opts = { startingInstruction: step, updateOutputCallback: updateStepMeter };
  // the test case goes under the code card, so the card leaves room for it
  const casesH = wide ? casesHeight() : 0;
  if (sizes.casesH) el.vizPanel.style.setProperty("--cases-h", sizes.casesH + "px"); else el.vizPanel.style.removeProperty("--cases-h");   // natural height unless resized
  const codeH = Math.max(180, el.vizBody.clientHeight - 40 - (casesH ? casesH + 10 : 0));
  if (wide) Object.assign(opts, { verticalStack: false, codeDivWidth: codeWidth(), codeDivHeight: codeH });
  else Object.assign(opts, { verticalStack: true, codeDivHeight: 230 });
  dropRunNodes();
  rendered = VisualLeetRenderer.renderTrace("viz", trace, opts);
  rendered.wide = wide;
  rendered.codeW = wide ? codeWidth() : 0;
  rendered.trace = trace;
  // the renderer clears #viz when it's destroyed: take our panels back out first
  const destroy = rendered.destroy;
  rendered.destroy = () => { rescueChrome(); destroy(); };
  {
    // the run's code view and printed output go into the Code panel (which
    // placeCases puts in the renderer's left column, so it stays inside #viz)
    const root = rendered.viz.domRoot[0];
    runNodes = ["#codAndNav", "#progOutputs"].map((s) => root.querySelector(s)).filter(Boolean);
    highlightCode(root);
  }
  el.vizPanel.style.setProperty("--code-w", (wide ? codeWidth() : 0) + "px");
  placeCases();
  if (rendered.viz.outputBox) rendered.viz.outputBox.domRoot = window.jQuery(el.codeBody);   // it looks itself up under its own root
  requestAnimationFrame(positionSplitters);
  // a new run starts with the default layout; a re-layout of the same run keeps zoom/moves
  if (stage.trace !== trace) { stage.trace = trace; stage.scale = 1; stage.x = 0; stage.y = 0; stage.offsets.clear(); hideInspector(); }
  applyStage({ redraw: false });
  watchArrows();
  if (!stageIsDefault()) applyStage();
  prevSnap = null;
  rendered.viz.add_pytutor_hook("end_updateOutput", (a) => { animateStep(a.myViz); return [false]; });
  animateStep(rendered.viz);          // baseline for the first step (nothing animates)
  updateStepMeter(rendered.viz);
}

// LeetCode mode: the test-case panel's height while playing (under the code card)
const casesHeight = () => (sizes.casesH ? sizes.casesH : Math.round(Math.min(340, Math.max(230, el.vizBody.clientHeight * 0.4))));

// The Code panel and the test cases form the left column: in the editor area
// before there's a run, in the renderer's left column while a run is shown
// (inside #viz, so the code view stays part of the visualization). The
// Visualizer header, messages and playback bar go around the frames and objects.
let runNodes = [];         // the run's code view and output, shown in the Code panel
function dropRunNodes() { for (const n of runNodes) n.remove(); runNodes = []; }
function rescueChrome() {
  if (el.codeCard.parentElement !== el.editLeft) el.editLeft.prepend(el.codeCard);
  if (el.lcCases.parentElement !== el.editLeft) el.codeCard.after(el.lcCases);
  if (el.vizHead.parentElement !== el.vizPanel) el.vizPanel.append(el.vizHead, el.playerBar);
  if (el.vizBody.contains(el.message) && !el.lcSide.contains(el.message) && el.message.parentElement !== el.vizBody) el.vizBody.prepend(el.message);
}

function placeCases() {
  const root = traceShown() && rendered.viz.domRoot && rendered.viz.domRoot[0];
  const left = root && root.querySelector("#vizLayoutTdFirst");
  const right = root && root.querySelector("#vizLayoutTdSecond");
  const target = left || el.editLeft;
  const card = el.codeCard;
  const watching = !!left && mode !== "edit";
  if (card.classList.contains("watching") !== watching) {
    card.classList.toggle("watching", watching);
    // the code view just appeared or went away: re-measure its line marks
    if (watching) requestAnimationFrame(() => rendered && markCurrentLine(rendered.viz));
  }
  if (card.parentElement !== target) target.insertBefore(card, target.firstChild);
  if (el.lcCases.parentElement !== target) target.insertBefore(el.lcCases, card.nextSibling);
  if (!rendered) dropRunNodes();
  for (const n of runNodes) if (n.parentElement !== el.codeBody) el.codeBody.appendChild(n);
  // the Visualizer panel's chrome
  if (right) {
    if (right.firstElementChild !== el.vizHead) right.prepend(el.vizHead);
    if (el.vizHead.nextElementSibling !== el.message) el.vizHead.after(el.message);
    if (right.lastElementChild !== el.playerBar) right.append(el.playerBar);
  } else {
    if (el.vizHead.parentElement !== el.vizPanel) el.vizPanel.append(el.vizHead, el.playerBar);
    // messages: under the Visualizer header of the editor's side panel
    if (el.sideHead.nextElementSibling !== el.message) el.sideHead.after(el.message);
  }
  el.vizHead.hidden = el.playerBar.hidden = !right;
  if (el.viz) el.viz.classList.toggle("vlEditing", !!left && mode === "edit");
}

// ---------- resizable panes: code | test cases | visualization ----------
// Three handles: between the columns (left width), between code and test
// cases (their height), and where they meet (both). Sizes apply live through
// CSS variables (--left-w, --cases-h; --code-w is the code column's width) and are
// remembered.
const SIZES_KEY = "visualleet.sizes.v1";
const sizes = (() => { try { return JSON.parse(localStorage.getItem(SIZES_KEY) || "{}") || {}; } catch { return {}; } })();
const clampN = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const splitters = ["v", "h", "x"].map((kind) => {
  const s = document.createElement("div");
  s.className = "splitter splitter-" + kind;
  s.hidden = true;
  s.setAttribute("role", "separator");
  s.setAttribute("aria-label", { v: "Resize the code and the visualization", h: "Resize the code and the test cases", x: "Resize all three panes" }[kind]);
  s.addEventListener("pointerdown", (e) => startResize(kind, e));
  s.addEventListener("dblclick", () => { delete sizes.leftW; delete sizes.casesH; saveSizes(); applySizes(); });
  el.vizBody.appendChild(s);
  return s;
});

// the left column and the right pane, in whichever layout is showing
function panes() {
  if (!lc.problem) return null;
  if (rendered && rendered.wide && !el.viz.hidden) {
    const root = rendered.viz.domRoot[0];
    return { left: root.querySelector("#vizLayoutTdFirst"), right: root.querySelector("#vizLayoutTdSecond") };
  }
  if (!el.editArea.hidden) return { left: el.editLeft, right: $("lc-side") };
  return null;
}

function positionSplitters() {
  const p = panes();
  const show = !!(p && p.left && p.right && p.left.offsetParent && p.right.offsetParent && el.lcCases.offsetParent);
  for (const s of splitters) s.hidden = !show;
  if (!show) return;
  const B = el.vizBody.getBoundingClientRect(), L = p.left.getBoundingClientRect(), R = p.right.getBoundingClientRect(), C = el.lcCases.getBoundingClientRect();
  const ox = el.vizBody.scrollLeft - B.left, oy = el.vizBody.scrollTop - B.top;
  const x = (L.right + R.left) / 2 + ox, y = C.top - 6 + oy;
  Object.assign(splitters[0].style, { left: x - 5 + "px", top: L.top + oy + "px", height: L.height + "px" });
  Object.assign(splitters[1].style, { left: L.left + ox + "px", top: y - 5 + "px", width: L.width + "px" });
  Object.assign(splitters[2].style, { left: x - 8 + "px", top: y - 8 + "px" });
}

function applySizes() {
  const st = el.vizPanel.style;
  // the left column: your size, else the default; the same while editing and playing
  const w = codeWidth() + "px";
  st.setProperty("--left-w", w);
  st.setProperty("--code-w", w);
  if (sizes.casesH) st.setProperty("--cases-h", sizes.casesH + "px");
  else st.removeProperty("--cases-h");
  if (rendered) rendered.codeW = codeWidth();      // the run already uses this width: no re-render needed
  requestAnimationFrame(() => { positionSplitters(); redrawArrows(); });
}
const saveSizes = () => { try { localStorage.setItem(SIZES_KEY, JSON.stringify({ leftW: sizes.leftW, casesH: sizes.casesH })); } catch {} };

function startResize(kind, e) {
  const p = panes();
  if (!p || e.button !== 0) return;
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  const L = p.left.getBoundingClientRect(), B = el.vizBody.getBoundingClientRect();
  document.body.classList.add("resizing", "resizing-" + kind);
  handle.classList.add("dragging");
  const move = (ev) => {
    if (kind !== "h") sizes.leftW = Math.round(clampN(ev.clientX - L.left, 280, B.width - 380));
    if (kind !== "v") sizes.casesH = Math.round(clampN(L.bottom - ev.clientY, 110, L.height - 150));
    applySizes();
  };
  const up = () => {
    handle.removeEventListener("pointermove", move);
    handle.removeEventListener("pointerup", up);
    handle.removeEventListener("pointercancel", up);
    document.body.classList.remove("resizing", "resizing-" + kind);
    handle.classList.remove("dragging");
    saveSizes();
    applySizes();
  };
  handle.addEventListener("pointermove", move);
  handle.addEventListener("pointerup", up);
  handle.addEventListener("pointercancel", up);
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
    showMessage(runtimeInfo ? "A run is already in progress." : "Python is still loading. Try again in a moment.", "info");
    return Promise.resolve({ status: "rejected", message: "Runtime is " + status });
  }
  const runId = crypto.randomUUID();
  setPlaying(false);
  return new Promise((resolve) => {
    current = {
      runId, kind, resolve, info, tClick: performance.now(),
      backstop: setTimeout(() => {
        // the sandbox didn't answer at all: throw the whole frame away
        clearVisualization();
        setStatus("timed out", "LeetScope stopped responding and is restarting Python. Press Run to try again.");
        finishJob({ status: "timed out", backstop: true });
        createSandbox();
      }, LIMITS.wallMs + BACKSTOP_EXTRA_MS),
    };
    setStatus("running", "", "info");
    toSandbox(Object.assign({ type: kind, runId, limits: LIMITS }, extra));
  });
}

// ---------- program ----------

// Your code + the call from the problem's database file; the inputs are built
// by hidden setup, which runs untraced.
function visualize(opts = {}) {
  if (!lc.problem) { showMessage("Open a problem on LeetCode and click Visualize to load it into LeetScope.", "info"); return Promise.resolve({ status: "rejected" }); }
  const g = lc.program();
  if (!g.ok) {
    showCodeView("code");
    showMessage("Fix the highlighted test case values, then press Run.", "error");
    return Promise.resolve({ status: "rejected", reason: "case", errors: g.errors });
  }
  const solution = el.solution.value;
  if (!solution.trim()) { showMessage("There's no code yet. Click Visualize on the LeetCode problem to bring your code here.", "info"); return Promise.resolve({ status: "rejected" }); }
  const source = solution.replace(/\s+$/, "") + "\n\n" + g.code + "\n";
  if (new TextEncoder().encode(source + g.setup).length > MAX_SOURCE_BYTES) {
    showMessage("This program is larger than 256 KiB, which is more than LeetScope can show.", "error");
    return Promise.resolve({ status: "rejected" });
  }
  if (IDLE.has(status) && runtimeInfo) { lastErrorLine = null; enterWatch(); }
  return startJob("run", { source, inputs: [], setup: g.setup, setupVisible: g.visible }, { lc: true, note: opts.note || "" });
}

function stop() { if (current && current.kind !== "probe") toSandbox({ type: "stop" }); }
function resetRuntime() {
  runtimeInfo = null;
  initStart = performance.now();
  setStatus("initializing", "Restarting Python…", "info");
  toSandbox({ type: "reset" });
}

// your code, kept across reloads
function saveCode() {
  try { localStorage.setItem(CODE_KEY, JSON.stringify({ solution: el.solution.value })); } catch {}
}
function loadCode() {
  try { return (JSON.parse(localStorage.getItem(CODE_KEY) || "null") || {}).solution || ""; } catch { return ""; }
}

// ---------- the problem ----------

// With no problem loaded, an empty state explains how to start.
function showProblem() {
  const empty = !lc.problem;
  document.body.classList.toggle("no-problem", empty);
  $("lc-empty").hidden = !empty;
  updateProblemLink();
  applySizes();
  placeCases();
  updateGutter();
}

// the problem chip links back to the problem on LeetCode
function updateProblemLink() {
  const pr = lc.problem;
  // the page the cases were read from, when known (keeps leetcode.cn, /description/ etc.)
  const same = pr && sourceUrl && new RegExp(`^https://leetcode\.(com|cn)/problems/${pr.slug}(/|$)`).test(sourceUrl);
  if (same) el.lcLink.href = sourceUrl;
  else if (pr && /^[a-z0-9-]+$/.test(pr.slug || "")) el.lcLink.href = `https://leetcode.com/problems/${pr.slug}/`;
  else el.lcLink.removeAttribute("href");
}

// Your code / Call / Setup: the views of the code card
function showCodeView(name) {
  for (const t of document.querySelectorAll("[data-codeview]")) t.setAttribute("aria-selected", String(t.dataset.codeview === name));
  for (const p of document.querySelectorAll("[data-codepanel]")) p.hidden = p.dataset.codepanel !== name;
  el.codeCard.dataset.view = name;
  redrawArrows();
  if (rendered) requestAnimationFrame(() => rendered && markCurrentLine(rendered.viz));
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
  if (!entry) {
    showMessage(`"${res.title || res.slug}" isn't supported by LeetScope yet. Support for more problems is on the way.`, "info");
    return { ok: false, reason: "not-in-db", slug: res.slug };
  }
  const loaded = lc.loadFromPage(res, entry);
  showProblem();
  showCodeView("code");
  const notes = [loaded.note];
  let runnable = true;
  // never run older code in place of what the click was meant to show
  if (!res.code) { notes.push("LeetScope couldn't read LeetCode's code editor. The page may still be loading. The code in LeetScope is unchanged, and you can press Run to run it."); runnable = false; }
  else if (!lang.ok) { notes.push(lang.note + " The code in LeetScope is unchanged."); runnable = false; }
  else { el.solution.value = res.code; saveCode(); updateGutter(); }
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
let opens = 0, lastOpen = null;     // for the automated checks
async function takePending(id) {
  let pending = null;
  try { pending = (await chrome.storage.session.get("pending")).pending; } catch { return; }
  if (!pending || (id && pending.id !== id) || Date.now() - pending.at > PENDING_MAX_AGE_MS) return;
  await chrome.storage.session.remove("pending").catch(() => {});
  sourceTabId = pending.tabId;
  chrome.runtime.sendMessage({ type: "describe-tab", tabId: sourceTabId }).then((r) => r && showSourceTab(r.title, r.url)).catch(() => {});
  opens++;
  lastOpen = openLeetCode(pending.result, { autoRun: true });
  return lastOpen;
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
  sourceUrl = typeof url === "string" ? url : "";
  updateProblemLink();
}

// ---------- wiring ----------

// arrows are drawn once per step; redraw them when the visualizer panel changes size
new ResizeObserver(() => { redrawArrows(); maybeRelayout(); applySizes(); }).observe(el.vizBody);
applySizes();
function showDiag(on) {
  el.diagStrip.hidden = !on;
  el.diagToggle.setAttribute("aria-pressed", String(on));
  el.diagToggle.title = on ? "Hide diagnostics" : "Show diagnostics";
  redrawArrows();          // the panels above shrank or grew
}
el.diagToggle.addEventListener("click", () => showDiag(el.diagStrip.hidden));
// Report a problem: what the report adds, shown to the user before they send it
initReport({ getDetails: () => {
  const pr = lc.problem;
  // what LeetScope is showing (a message, or a run's error), not the welcome text
  const shown = [el.message.textContent, ...[...el.vizBody.querySelectorAll(".ph-title, .ph-body")]
    .filter((n) => n.offsetParent && !n.closest("#lc-empty")).map((n) => n.textContent)]
    .map((t) => t.trim().replace(/\.$/, "")).filter(Boolean).join(". ").slice(0, 600);
  const chrome = (/Chrome\/([\d.]+)/.exec(navigator.userAgent) || [])[1] || "unknown";
  const lines = [
    `Problem: ${pr ? `${pr.title || pr.slug} (${pr.slug})` : "none open"}`,
    `LeetScope: ${globalThis.chrome?.runtime?.getManifest?.().version || "unknown"}`,
    `Chrome: ${chrome}`,
    `Python: ${runtimeInfo ? runtimeInfo.python : "not started"}`,
    `Status: ${status}`,
  ];
  if (shown) lines.push(`Last message: ${shown}`);
  return { text: lines.join("\n"), code: pr ? el.solution.value : "" };
} });
$("diag-close").addEventListener("click", () => showDiag(false));
$("play").addEventListener("click", () => setPlaying(!playTimer));
$("speed").addEventListener("click", (e) => {
  const b = e.target.closest("[data-ms]");
  if (!b) return;
  for (const x of $("speed").querySelectorAll("[data-ms]")) x.setAttribute("aria-checked", String(x === b));
  if (playTimer) setPlaying(true);
});
el.edit.addEventListener("click", () => enterEdit({ focus: true }));
el.solution.addEventListener("input", updateGutter);
el.solution.addEventListener("scroll", () => { el.gutter.scrollTop = el.solution.scrollTop; });
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.defaultPrevented) { e.preventDefault(); if (!isBusy()) visualize(); return; }
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
el.solution.addEventListener("input", saveCode);
el.solution.addEventListener("keydown", (e) => {
  if (e.key === "Tab" && !e.shiftKey) {      // indent with 4 spaces
    e.preventDefault();
    const ta = el.solution, { selectionStart: s, selectionEnd: t, value } = ta;
    ta.value = value.slice(0, s) + "    " + value.slice(t);
    ta.selectionStart = ta.selectionEnd = s + 4;
    saveCode();
    updateGutter();
  }
});
el.reset.addEventListener("click", resetRuntime);
window.addEventListener("pagehide", () => { if (iframe) iframe.remove(); clearVisualization(); });

// The problem chip goes back to the LeetCode tab the code and cases came from
// (focusing it); only if that tab is gone does it open the problem in a new tab.
el.lcLink.addEventListener("click", async (e) => {
  if (!sourceTabId || e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
  e.preventDefault();
  try {
    const t = await chrome.tabs.update(sourceTabId, { active: true });
    if (t && typeof t.windowId === "number") await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
  } catch {
    if (el.lcLink.href) window.open(el.lcLink.href, "_blank", "noopener");
  }
});

for (const t of document.querySelectorAll("[data-codeview]")) t.addEventListener("click", () => showCodeView(t.dataset.codeview));
el.caseRun.addEventListener("click", runOrStop);

el.solution.value = loadCode();
showProblem();
if (sourceTabId) chrome.runtime.sendMessage({ type: "describe-tab", tabId: sourceTabId }).then((r) => r && showSourceTab(r.title, r.url)).catch(() => {});
createSandbox();

// Back to the last LeetCode problem, then take a case a click on LeetCode left for us.
const started = (async () => {
  const last = lc.lastSlug();
  const entry = last ? await loadEntry(last) : null;
  if (entry && lc.restore(entry)) showProblem();
  return takePending();
})();

// Test hooks (used by the automated checks through DevTools).
window.visualleet = {
  whenReady: () => (runtimeInfo && !current ? Promise.resolve(runtimeInfo) : new Promise((r) => waiters.ready.push(r))),
  // run a whole Python program as it is (no problem or test case), shown like any run
  run: (source) => { if (IDLE.has(status) && runtimeInfo) { lastErrorLine = null; enterWatch(); } return startJob("run", { source, inputs: [] }); },
  visualize,
  code: () => el.solution.value,
  stop,
  resetRuntime,
  probe: () => startJob("probe"),
  sandboxStats: () => new Promise((r) => { waiters.stats.push(r); toSandbox({ type: "stats" }); }),
  status: () => status,
  message: () => el.message.textContent,
  lastRun: () => lastRun,
  lastTrace: () => lastTrace,
  runtimeInfo: () => runtimeInfo,
  rendered: () => rendered,
  started: () => started,
  view: () => mode,                          // "edit" | "watch"
  opens: () => opens,                        // how many clicks on LeetCode this tab has taken
  lastOpen: () => lastOpen,                  // the result of the latest one
  openLeetCode,
  leetcode: lc,
  verdict: () => { const v = $("case-verdict"); return v.hidden ? null : { kind: v.dataset.kind, text: v.textContent }; },
};
