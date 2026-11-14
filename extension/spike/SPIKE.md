# MV3 feasibility spike: results

Date: 2026-11-14. Automated by `scripts/spike-check.mjs` (21/21 checks passed);
raw data in `spike-results.json`, screenshot in `bfs-step-21.png`.

Environment: Chrome 157.0.8103.78 (installed stable Chrome, **headless**, fresh
temporary profile, extension loaded unpacked through DevTools), Windows 11
(10.0.26300), Intel Core Ultra 7 251HX. Pyodide 314.0.8 / Python 3.14.2.
Not yet checked by hand in a normal (headed) Chrome window.

## Architecture that was tested

```
toolbar click ─► background service worker ─► opens ui/index.html (extension page, strict CSP)
                                                 │  fetches an allowlist of 7 packaged files once
                                                 ▼  postMessage (validated source + protocol version)
                                   runner/sandbox.html  (manifest sandbox: opaque origin,
                                                 │       no chrome.* APIs, connect-src 'none')
                                                 ▼  blob: worker, watchdog timer, generation counter
                                   Python worker: Pyodide + forked tracer (pg_logger/pg_encoder)
```

- Pyodide's files reach the worker as in-memory copies. The worker replaces
  `fetch` with a lookup in that allowlist, and loads Pyodide's JS through
  `createPyodideModule`, so nothing is ever requested over the network.
- The sandbox owns the worker. Stop and timeouts terminate the worker and
  start a fresh one; results from a terminated generation are dropped.
- The UI accepts messages only from its own sandbox frame, only answers to
  the run it is waiting for, and never acts on runner messages beyond
  displaying them.

## Answers

| # | Question | Answer | Evidence |
| --- | --- | --- | --- |
| 1 | Does packaged Pyodide load with no CDN? | **Yes** | Ready in 2.4 s from page load; no requests outside the extension; works with the network disabled |
| 2 | Do the worker type and loading paths work in MV3? | **Yes** | A `blob:` classic worker created inside the sandbox page; Pyodide's ES modules loaded by dynamic `import()` of blob URLs |
| 3 | Does the existing tracer run unchanged? | **Yes** | BFS, sliding window, recursion, collections/heapq/bisect/lru_cache, runtime and syntax errors, step limit; `bdb`, frames and the encoder all work. Uses the tracer's normal web entry point (`exec_script_str`, import allowlist on) |
| 4 | Does it render through the real visualizer? | **Yes** | Code with current/previous line markers, frames, objects, arrows; Next steps through 57 steps without re-running Python |
| 5 | Can a timer outside the worker stop stuck code? | **Yes** | A native loop with almost no trace events was killed at 5.03 s; Stop takes effect in 18 ms; the next run works; a stopped run's late result is ignored |
| 6 | Is Python cut off from privileged capabilities? | **Yes**, for everything probed | Probe running arbitrary Python through the `js` bridge: `typeof chrome` is `undefined`, no `document`, origin `null`; XHR, fetch (including the original `fetch`), `importScripts` and WebSocket to the internet all blocked, with `connect-src`/`script-src` CSP violation reports; IndexedDB blocked. Three forged worker messages were dropped by the sandbox. User code going through the tracer can't even `import js` |

Also checked: HTML in printed output and strings is shown as text (no
elements created, no script ran); a second run sees none of the first run's
globals.

## Timings (median of 7 warm runs unless noted)

| Measure | BFS (58 steps, 46 KiB) | Sliding window (71 steps) |
| --- | --- | --- |
| Python execution + tracing | 16 ms | 12 ms |
| Transfer worker → UI | 3 ms | 3 ms |
| JSON parse | 0.2 ms | 0.2 ms |
| First render | 11 ms | 11 ms |
| **Click → first view** | **32 ms** (worst 34) | **27 ms** (worst 29) |

| Measure | Value |
| --- | --- |
| Cold start (page load → runtime ready) | 2.4 s (worker part ~1.9 s, nearly all `loadPyodide`) |
| Second page load in the same browser | 3.1 s (no speedup from caching) |
| Step navigation (Next) | 3.3 ms median, 8.3 ms worst |
| Stop → stopped | 18 ms |
| Runtime rebuild after Stop/timeout | 2.4 s |

Against the spec's provisional targets: Run/Stop acknowledgement < 100 ms ✓,
worker termination visible < 500 ms ✓, warm BFS/sliding first view < 1 s ✓
(~30 ms), step navigation < 100 ms ✓.

## What the spike found that needs work

- **Restart cost.** After Stop or a timeout the next run waits ~2.4 s for a new
  interpreter. Fix: keep one pre-started spare worker so the swap is instant.
- **No compile caching.** Cold start doesn't improve on reload (3.1 s second
  time) because the wasm is compiled from memory each time. Fix to try:
  compile `WebAssembly.Module` once in the sandbox and hand it to each worker.
- **Syntax errors** produce a one-entry trace that the visualizer can't open;
  the UI now shows the error message instead (as the original frontend did).
- Pyodide probes for classic-worker support with a `data:` script at startup,
  which the sandbox CSP blocks (harmless, but shows up as a CSP report).
- The `WebSocket` constructor itself doesn't throw under the CSP; the
  connection fails instead. The violation report confirms it was blocked.

## Not covered by this spike

- Headed Chrome by hand, and the toolbar button (the check opens the UI page
  directly).
- Selected-text import and the LeetCode editor adapter.
- Starter-code/test-call UI, stdout/output size limits, `input()`.
- Network monitoring from inside the worker is via CSP reports, not DevTools.
