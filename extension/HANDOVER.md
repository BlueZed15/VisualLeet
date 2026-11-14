# VisualLeet implementation handover

For whoever picks up the **implementation** next (another model or person).
Read this first, then `README.md` (usage, architecture, tests, results) and the
spec `../VISUALLEET_EXTENSION_SPEC.md`. The visual-design track has its own
handover: `design/HANDOVER.md`. Last updated 2026-11-14.

## Where things stand

- A working MV3 extension: `npm run build:extension` → `dist/extension`, loaded
  unpacked in Chrome. Python 3.14.2 (Pyodide 314.0.8) runs the archived Python
  Tutor tracer inside a sandboxed worker; the forked Python Tutor renderer draws it.
- Verified automatically: **43/43** acceptance checks (`scripts/acceptance.mjs`,
  headless Chrome 157), 11 Node tests, 7 Python tracer tests. Spike results in
  `spike/SPIKE.md`, acceptance results and screenshots in `acceptance/`.
- **Not verified yet:** the real toolbar-click → activeTab → import flow in a
  normal Chrome window (automation can't click the icon; the user is trying it
  now), LeetCode while signed in, leetcode.cn.
- Nothing is committed. The outer repo has one initial commit; `extension/`,
  the spec and the archive folder are untracked. Don't commit or push unless
  the user asks.

## Ground rules the user agreed to (keep them)

1. **Never modify `../OnlinePythonTutor-Backup/`.** It's the user's working
   desktop tool (a separate nested git repo with its own pre-existing edits).
   All changes live in forks under `extension/src/` with a provenance header
   (archive commit `473848d`) and are diffable against the originals.
2. **Measure before and after** any performance change, with the existing
   benches (`bench/`, `scripts/acceptance.mjs`). The user explicitly wanted
   speed confirmed before building; report real numbers and noise (±30% here).
3. **Tracer output must stay identical to the original** except for documented,
   deliberate changes. `tests/test_tracer_equivalence.py` enforces this
   (26 programs, cache on and off). If you change the tracer, keep it passing.
4. Spec principles: no server, no CDN/remote code, no telemetry; never present
   a partial result as complete; never silently convert code or inputs (drafts
   go into editable boxes); keep user edits when an import fails.
5. The design session works only in `extension/design/`. Don't edit there;
   it doesn't edit `src/`, `scripts/`, `bench/`, `tests/`, `package.json` or
   run the build scripts (they wipe `dist/`).

## Architecture in one screen

```
toolbar click -> background/background.js  (activeTab grant; remembers source tab;
                 |                          importers via chrome.scripting.executeScript)
                 v
ui/index.html + ui.js  (extension page, CSP script-src 'self')
   |  fetches 7 allowlisted packaged files once; talks only to its own iframe
   v
runner/sandbox.html + sandbox.js  (manifest sandbox: opaque origin, no chrome.*,
   |                               CSP connect-src 'none'; compiles wasm once;
   |                               active + spare worker; 5 s watchdog)
   v
runner/worker.js in a blob: worker  (overrides fetch to serve the in-memory files,
                                     loads Pyodide via createPyodideModule,
                                     runs pg_logger.exec_script_str)
```

Message protocol: objects with `v: 1` and `type`; UI ↔ sandbox via
`postMessage(…, "*")` but each side checks `event.source` is the expected
window. Run IDs (`crypto.randomUUID`) reject stale results; the sandbox drops
messages from any worker that isn't the current active/spare.

Worker policy (sandbox.js header has details): after a run the used
interpreter is swapped for the spare as soon as the spare is ready (~1.5 s);
runs in quick succession reuse it. Stop/timeout/Reset kill the active worker;
a ready spare takes over instantly. Results carry `interpreterRun` (1 = fresh).

## File map (what to edit for what)

| Want to change | File |
| --- | --- |
| Toolbar behavior, importers (selection, LeetCode) | `src/background/background.js` |
| Page layout / styles (basic design) | `src/ui/index.html`, `src/ui/ui.css` |
| Run flow, statuses, messages, test hooks | `src/ui/ui.js` |
| Combining setup/solution/call, LeetCode test-call drafts | `src/ui/prepare.js` (+ `tests/prepare.test.mjs`) |
| Examples and helper starters | `src/ui/examples.js` |
| Worker lifecycle, watchdog, message filtering | `src/runner/sandbox.js` |
| Pyodide loading, run/probe commands | `src/runner/worker.js` |
| Tracer (limits, events) | `src/python/pg_logger.py` |
| Value encoding, encode cache | `src/python/pg_encoder.py` |
| Renderer (arrows, nudge, collapse) | `src/visualizer/pytutor.ts`, `arrow-layer.ts`, `visualleet.css` |
| Permissions / CSP | `src/manifest.json` |
| Build, test build | `scripts/build-extension.mjs` |

## Commands

```powershell
cd extension
npm ci
npm run build:extension           # dist/extension (ship / load this one)
npm run build:extension-test      # dist/extension-test: + host access to 127.0.0.1, https://leetcode.com
node scripts/acceptance.mjs       # needs the test build; ~3 min; writes acceptance/
node --test tests/                # prepare.js unit tests
cd ..
.venv\Scripts\python.exe -m unittest discover -s extension\tests -p "test_*.py"
```

Bench pages (renderer old vs new): `npm run build:renderer`,
`npm run build:baseline`, `node scripts/serve-bench.mjs`, open
`http://127.0.0.1:8765/bench/index.html` or `/bench/compare.html`.
`.claude/launch.json` (workspace root) has a `renderer-bench` entry for the
in-app browser.

The test build is needed because automation can't grant activeTab. The
acceptance script maps leetcode.com to a local **HTTPS** fixture (self-signed
cert generated with Git Bash's openssl, `--ignore-certificate-errors` in the
temp profile only). Never ship `dist/extension-test`.

## Decisions already made (and why)

- **Pyodide directly, no PyScript**; pinned npm package, only the 5 core files
  packaged (14 MB total). SHA-256s in `dist/extension/vendor/PROVENANCE.txt`.
- **Sandbox page + blob worker**: the only setup that gives an opaque origin,
  no extension APIs and `connect-src 'none'`. Files reach the worker as
  in-memory copies through the UI page (allowlisted bridge), not via
  web_accessible_resources.
- **Tracer "web" mode** (`exec_script_str`, import allowlist on). User code
  can't `import js`. The allowlist isn't the security boundary; the sandbox is.
- **Renderer fork, not rewrite**: jsPlumb replaced by `ArrowLayer` (same API
  subset, batched). Rightward-nudge batched with verify-and-fallback. O(n²)
  `td:last` removed. Collections >100 items collapsed with "showing 60 of N".
  Old-vs-new compare page proves identical arrows/text, margins within 0.1 px.
- **No WebGL/WebGPU**: measured bottleneck was layout thrashing and jsPlumb,
  not drawing. The user asked; this was the answer.
- **Encode cache** only for exact list/tuple/set/dict with ≥16 elements; holds
  no references to user objects (only primitives) so lifetimes, `__del__` and
  `id()` reuse are unchanged. Instances aren't cached (no gain).
- **Deliberate tracer output changes** (documented in file headers and
  excluded/normalized in tests): 64 KiB printed-output limit (ends with the
  same `instruction_limit_reached` event as the step limit); Python 3.13's
  `__firstlineno__` / `__static_attributes__` hidden on classes.
- **LeetCode import** reads `window.monaco` in the page's MAIN world (checked
  on the live site 2026-11-14: models report `python3`, `getValue()` returns
  off-screen lines; a second `plaintext` model is the test-case box). Example
  inputs come from `[data-track-load="description_content"]` text between
  "Input:" and "Output:". Drafts are editable, with notes shown to the user.
- **Syntax errors**: the tracer returns a one-entry `uncaught_exception`
  trace; the UI shows the message instead of opening the visualizer (as the
  original frontend did).

## Gotchas that cost time (avoid repeating)

- Bash heredocs with mixed quotes in this environment break ("unexpected EOF").
  Write multi-line files with the file tool, or a script file, instead.
- `pyodide` requests files with `URL` objects, not strings: the worker's fetch
  override must handle both.
- Chrome forces HTTPS for leetcode.com: plain-HTTP fixtures fail with
  `ERR_BLOCKED_BY_CLIENT`.
- puppeteer `installExtension` needs an absolute path.
- Python set/dict-of-str order varies per process: equivalence subprocesses
  use `PYTHONHASHSEED=0`. The original tracer keeps some objects alive until a
  later GC, so `__del__` output can leak into the next program's trace:
  `tests/dump_traces.py` runs `gc.collect()` between programs.
- The UI must forget the interpreter (`runtimeInfo = null`) on stop/timeout/
  reset, or `whenReady()` resolves early and the next run is rejected.
- The sandbox must announce when the **spare** becomes ready, otherwise the UI
  never learns it (and the swap-on-ready policy never triggers).
- `WebAssembly.compile` of the 9.6 MB wasm takes ~13 ms (Chrome compiles
  lazily), so most of the ~2 s cold start is Python's own init, not compile.
- Line-marker arrows in the code panel animate (200–450 ms); screenshots right
  after clicking Next miss them. Wait ~1 s.
- `package.json` is `"type": "module"`; the renderer and UI are plain ES modules
  / IIFE bundles, no TypeScript type checking (legacy TS).

## Suggested next steps (spec order; confirm with the user)

1. Fix whatever the user finds in the real toolbar/LeetCode flow (signed in too).
2. Port the chosen design from `design/` into `src/ui/` (see `design/HANDOVER.md`).
3. Optional quality items: hide Setup helpers from the visualization
   (`#pythontutor_hide` or a tracer option); show tree/list return values
   readably; an editor with syntax highlighting (measure page-load cost).
4. Bigger, only if measurements call for it: send each heap object once
   (delta traces) for very large inputs; incremental heap rendering for
   expanded huge collections (~178 ms/step at 2,000 items).
5. Spec benchmark procedure in a headed Chrome; Chrome Web Store work is out
   of scope for the prototype.
