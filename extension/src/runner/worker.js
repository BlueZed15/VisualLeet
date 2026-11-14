// VisualLeet Python worker. Created by the sandbox page from a blob: URL, so
// it inherits the sandbox's opaque origin and CSP (no network, no extension
// APIs). Loads Pyodide from in-memory packaged assets and runs the tracer.
"use strict";
const ASSET_BASE = "https://visualleet-assets.invalid/";
const assets = new Map();
let runPython = null;
let pyodide = null;

// Pyodide fetches its wasm, stdlib and lock file by URL. Serve those from the
// packaged copies passed in by the sandbox; nothing else is reachable.
self.fetch = async (input) => {
  const url = typeof input === "object" && input !== null && "url" in input ? String(input.url) : String(input);
  const name = url.split("?")[0].split("/").pop();
  const a = assets.get(name);
  if (!a) throw new TypeError("VisualLeet runner has no network access (" + url + ")");
  return new Response(a.bytes, { status: 200, headers: { "Content-Type": a.type } });
};

// Evidence for the isolation probe: the browser reports each blocked request here.
self.__vlViolations = [];
self.addEventListener("securitypolicyviolation", (e) => {
  self.__vlViolations.push({ directive: e.effectiveDirective, blocked: e.blockedURI });
});

function moduleUrl(name) {
  return URL.createObjectURL(new Blob([assets.get(name).bytes], { type: "text/javascript" }));
}

const RUNNER_PY = `
import json, sys
sys.path.insert(0, "/home/pyodide/visualleet")
import pg_logger

_OPTIONS = json.dumps({"cumulative_mode": False, "heap_primitives": False, "show_only_outputs": False})

def visualleet_run(source, inputs_json):
    out = {}
    def finalizer(code, trace):
        out["json"] = json.dumps({"code": code, "trace": trace})
    pg_logger.exec_script_str(source, inputs_json, _OPTIONS, finalizer)
    return out["json"]
`;

// Isolation probe: worst case, arbitrary Python using the JS bridge directly
// (bypassing the tracer's import restrictions).
const PROBE_PY = `
import js, json
def t(expr):
    try:
        return str(js.eval(expr))
    except Exception as e:
        return "error: " + type(e).__name__ + ": " + str(e)[:160]
async def ta(expr):
    try:
        return str(await js.eval(expr))
    except Exception as e:
        return "error: " + type(e).__name__ + ": " + str(e)[:160]
r = {}
r["typeof chrome"] = t("typeof chrome")
r["chrome.runtime.id"] = t("typeof chrome !== 'undefined' && chrome.runtime ? String(chrome.runtime.id) : 'unavailable'")
r["typeof document"] = t("typeof document")
r["self.origin"] = t("self.origin")
r["indexedDB.open"] = t("(() => { try { indexedDB.open('x'); return 'allowed' } catch (e) { return 'blocked: ' + e.name } })()")
r["sync XHR to example.com"] = t("(() => { try { const x = new XMLHttpRequest(); x.open('GET', 'https://example.com/', false); x.send(); return 'reached: ' + x.status } catch (e) { return 'blocked: ' + e.name } })()")
r["original fetch to example.com"] = await ta("WorkerGlobalScope.prototype.fetch.call(self, 'https://example.com/').then(r => 'reached: ' + r.status, e => 'blocked: ' + e.name)")
r["importScripts from example.com"] = t("(() => { try { importScripts('https://example.com/x.js'); return 'loaded' } catch (e) { return 'blocked: ' + e.name } })()")
r["WebSocket to example.com"] = await ta("new Promise((res) => { try { const w = new WebSocket('wss://example.com/'); w.onopen = () => res('opened'); w.onerror = () => res('failed to connect'); setTimeout(() => res('no answer after 3 s'), 3000) } catch (e) { res('blocked: ' + e.name) } })")
r["CSP violations reported in worker"] = t("JSON.stringify((self.__vlViolations || []).map(v => v.directive + ' ' + v.blocked))")
r["forged messages posted"] = t("(() => { postMessage({type: 'openTab', url: 'https://example.com'}); postMessage({type: 'result', runId: 'forged', traceJson: '{}'}); postMessage('not an object'); return 3 })()")
json.dumps(r)
`;

// Use the module the sandbox compiled once, instead of compiling 9.6 MB of
// wasm again in every worker. Only the first instantiation (Pyodide's main
// module) is redirected; later ones (e.g. stdlib extension modules) are not.
function usePrecompiledWasm(mod) {
  const origStreaming = WebAssembly.instantiateStreaming;
  const origInstantiate = WebAssembly.instantiate;
  const restore = () => {
    WebAssembly.instantiateStreaming = origStreaming;
    WebAssembly.instantiate = origInstantiate;
  };
  const fromModule = async (imports) => {
    restore();
    return { module: mod, instance: await origInstantiate.call(WebAssembly, mod, imports) };
  };
  WebAssembly.instantiateStreaming = (_response, imports) => fromModule(imports);
  WebAssembly.instantiate = (source, imports) =>
    source instanceof WebAssembly.Module ? origInstantiate.call(WebAssembly, source, imports) : fromModule(imports);
}

async function init(msg) {
  const t0 = performance.now();
  for (const [name, a] of Object.entries(msg.assets)) assets.set(name, a);
  if (msg.wasmModule) usePrecompiledWasm(msg.wasmModule);
  const { loadPyodide } = await import(moduleUrl("pyodide.mjs"));
  const asm = await import(moduleUrl("pyodide.asm.mjs"));
  const t1 = performance.now();
  pyodide = await loadPyodide({
    indexURL: ASSET_BASE,
    createPyodideModule: asm.default,
    stdout: () => {},
    stderr: () => {},
  });
  const t2 = performance.now();
  pyodide.FS.mkdirTree("/home/pyodide/visualleet");
  for (const f of ["pg_logger.py", "pg_encoder.py"]) {
    pyodide.FS.writeFile("/home/pyodide/visualleet/" + f, new Uint8Array(assets.get(f).bytes));
  }
  pyodide.runPython(RUNNER_PY);
  runPython = pyodide.globals.get("visualleet_run");
  const t3 = performance.now();
  postMessage({
    type: "ready",
    info: {
      pyodide: pyodide.version,
      python: pyodide.runPython("import sys; sys.version.split()[0]"),
      timings: { importJs: t1 - t0, loadPyodide: t2 - t1, loadTracer: t3 - t2, total: t3 - t0,
                 wasmCompiledOnceMs: msg.wasmModule ? msg.compileMs : null },
    },
  });
}

self.onmessage = async (e) => {
  const m = e.data;
  try {
    if (m.type === "init") {
      await init(m);
    } else if (m.type === "run") {
      const maxBytes = Number(m.limits && m.limits.maxTraceBytes) || 10 * 1024 * 1024;
      if (new TextEncoder().encode(m.source).length > 256 * 1024) {
        postMessage({ type: "error", runId: m.runId, code: "source-too-large", message: "Source is larger than 256 KiB." });
        return;
      }
      const t0 = performance.now();
      const inputs = Array.isArray(m.inputs) && m.inputs.length ? JSON.stringify(m.inputs) : null;
      const traceJson = runPython(m.source, inputs);
      const t1 = performance.now();
      if (traceJson.length > maxBytes) {
        postMessage({ type: "error", runId: m.runId, code: "trace-too-large",
                      message: `Trace is ${(traceJson.length / 1048576).toFixed(1)} MiB, over the ${(maxBytes / 1048576).toFixed(0)} MiB limit.` });
        return;
      }
      postMessage({ type: "result", runId: m.runId, traceJson, metrics: { execMs: t1 - t0, bytes: traceJson.length } });
    } else if (m.type === "probe") {
      const report = await pyodide.runPythonAsync(PROBE_PY);
      postMessage({ type: "probe-result", runId: m.runId, report: String(report) });
    }
  } catch (err) {
    const type = m && m.type === "init" ? "init-error" : "error";
    postMessage({ type, runId: m && m.runId, code: "internal", message: String((err && err.stack) || err) });
  }
};
