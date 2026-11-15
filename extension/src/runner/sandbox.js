// VisualLeet runner host. Runs in a manifest sandbox page: opaque origin, no
// extension APIs, CSP with connect-src 'none'. Owns the Python workers, the
// watchdog, and the narrow message boundary between the workers and the UI.
//
// Worker policy:
//  - "active" runs jobs; a "spare" is booted in the background once the
//    active one is ready.
//  - After every finished run, if the spare is ready, the used interpreter is
//    discarded and the spare takes over, so runs normally start on a fresh
//    interpreter (no leftover imports, module state or random state). If the
//    spare isn't ready yet, the used interpreter is reused (the tracer gives
//    every run fresh globals); results report which happened.
//  - Stop, timeout and Reset terminate the active worker; a ready spare takes
//    over immediately.
//  - The wasm module is compiled once here and shared with every worker.
"use strict";
(() => {
  const PROTOCOL = 1;
  const parentWin = window.parent;
  const WORKER_TYPES = new Set(["ready", "init-error", "result", "error", "probe-result"]);

  let assets = null;      // { name: { bytes, type } } master copies (wasm bytes dropped once compiled)
  let workerSrc = null;
  let wasmModule = null;
  let compileMs = 0;
  let nextId = 0;
  let active = null;      // { id, worker, ready, info, runs }
  let spare = null;
  let job = null;         // { runId, kind, timer }
  const stats = { dropped: 0, stale: 0, started: 0, freshRuns: 0, reusedRuns: 0 };

  function toParent(msg) {
    parentWin.postMessage(Object.assign({ v: PROTOCOL }, msg), "*");
  }

  function kill(rec) {
    if (rec) rec.worker.terminate();
  }

  function spawn() {
    const rec = { id: ++nextId, worker: null, ready: false, info: null, runs: 0 };
    stats.started += 1;
    const url = URL.createObjectURL(new Blob([workerSrc], { type: "text/javascript" }));
    try {
      rec.worker = new Worker(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    rec.worker.onmessage = (e) => onWorkerMessage(rec, e.data);
    rec.worker.onerror = (e) => {
      e.preventDefault();
      if (rec === active) toParent({ type: "init-error", message: "Python worker error: " + (e.message || "unknown") });
    };
    // structured clone: each worker gets copies; the sandbox keeps the masters
    rec.worker.postMessage({ type: "init", assets, wasmModule, compileMs });
    return rec;
  }

  function announce() {
    if (active && active.ready) {
      toParent({ type: "ready", info: Object.assign({}, active.info, { spareReady: !!(spare && spare.ready) }) });
    } else {
      toParent({ type: "initializing" });
    }
  }

  // Replace the active interpreter (after stop/timeout/reset, or a finished run).
  function replaceActive({ onlyIfSpareReady = false } = {}) {
    if (onlyIfSpareReady && !(spare && spare.ready)) return false;
    kill(active);
    active = spare || spawn();
    spare = active.ready ? spawn() : null;   // a booting spare would compete with the active boot
    announce();
    return true;
  }

  function onWorkerMessage(rec, m) {
    if (rec !== active && rec !== spare) { stats.stale += 1; return; }
    if (!m || typeof m !== "object" || !WORKER_TYPES.has(m.type)) { stats.dropped += 1; return; }
    if (m.type === "ready") {
      rec.ready = true;
      rec.info = m.info;
      if (rec === active && !spare) spare = spawn();
      // a used interpreter is swapped for the fresh one as soon as it's ready
      if (rec === spare && active && active.ready && active.runs > 0 && !job) { replaceActive(); return; }
      if (active && active.ready) announce();   // also tells the UI when the spare is ready
      return;
    }
    if (m.type === "init-error") {
      if (rec === active) toParent({ type: "init-error", message: String(m.message).slice(0, 2000) });
      else { kill(rec); spare = null; stats.spareInitErrors = (stats.spareInitErrors || 0) + 1; stats.lastSpareError = String(m.message).slice(0, 300); }
      return;
    }
    // job answers must come from the active worker, for the job in progress
    if (rec !== active || !job || m.runId !== job.runId) { stats.dropped += 1; return; }
    clearTimeout(job.timer);
    const runId = job.runId;
    job = null;
    rec.runs += 1;
    const interpreterRun = rec.runs;          // 1 = this run used a fresh interpreter
    if (interpreterRun === 1) stats.freshRuns += 1; else stats.reusedRuns += 1;
    if (m.type === "result") {
      if (typeof m.traceJson !== "string") { stats.dropped += 1; return; }
      toParent({ type: "result", runId, traceJson: m.traceJson,
                 metrics: Object.assign({}, m.metrics, { interpreterRun }) });
    } else if (m.type === "probe-result") {
      toParent({ type: "probe-result", runId, report: String(m.report) });
    } else {
      toParent({ type: "error", runId, code: String(m.code || "error"), message: String(m.message).slice(0, 2000) });
    }
    // next run starts on a fresh interpreter when one is ready
    replaceActive({ onlyIfSpareReady: true });
  }

  function startJob(kind, msg) {
    if (!active || !active.ready) { toParent({ type: "error", runId: msg.runId, code: "not-ready", message: "Runtime is not ready." }); return; }
    if (job) { toParent({ type: "error", runId: msg.runId, code: "busy", message: "A run is already in progress." }); return; }
    const wallMs = Math.min(Math.max(Number(msg.limits && msg.limits.wallMs) || 10000, 100), 60000);
    const runId = msg.runId;
    job = {
      runId, kind,
      timer: setTimeout(() => {
        // watchdog outside the Python worker: discard that interpreter
        job = null;
        toParent({ type: "timeout", runId, wallMs });
        replaceActive();
      }, wallMs),
    };
    if (kind === "probe") {
      active.worker.postMessage({ type: "probe", runId });
    } else {
      const inputs = Array.isArray(msg.inputs) ? msg.inputs.map(String).slice(0, 1000) : [];
      // optional hidden setup (LeetCode problems): runs untraced before the source
      const setup = typeof msg.setup === "string" ? msg.setup : "";
      const setupVisible = Array.isArray(msg.setupVisible) ? msg.setupVisible.map(String).slice(0, 100) : [];
      active.worker.postMessage({ type: "run", runId, source: msg.source, inputs, setup, setupVisible, limits: msg.limits });
    }
  }

  async function setup(m) {
    assets = m.assets;
    workerSrc = String(m.workerSrc);
    try {
      const t = performance.now();
      wasmModule = await WebAssembly.compile(assets["pyodide.asm.wasm"].bytes);
      compileMs = performance.now() - t;
      // workers get the compiled module; no need to copy 9.6 MB of bytes into each
      assets = Object.assign({}, assets, { "pyodide.asm.wasm": { bytes: new ArrayBuffer(0), type: "application/wasm" } });
    } catch (err) {
      wasmModule = null;    // fall back to compiling inside each worker
    }
    active = spawn();
    announce();
  }

  window.addEventListener("message", (e) => {
    if (e.source !== parentWin) return;                 // only the embedding extension page
    const m = e.data;
    if (!m || m.v !== PROTOCOL || typeof m.type !== "string") return;
    switch (m.type) {
      case "assets":
        if (assets) return;                              // set once
        setup(m);
        break;
      case "run":
        if (typeof m.source !== "string" || typeof m.runId !== "string") return;
        startJob("run", m);
        break;
      case "probe":
        if (typeof m.runId !== "string") return;
        startJob("probe", m);
        break;
      case "stop": {
        if (!job) return;
        const runId = job.runId;
        clearTimeout(job.timer);
        job = null;
        toParent({ type: "stopped", runId });
        replaceActive();
        break;
      }
      case "reset":
        if (job) { clearTimeout(job.timer); toParent({ type: "stopped", runId: job.runId }); job = null; }
        kill(spare);
        spare = null;
        kill(active);
        active = spawn();
        announce();
        break;
      case "stats":
        toParent({ type: "stats", stats: Object.assign({ activeRuns: active ? active.runs : 0, spareReady: !!(spare && spare.ready), wasmPrecompiled: !!wasmModule, compileMs }, stats) });
        break;
    }
  });

  toParent({ type: "sandbox-loaded" });
})();
