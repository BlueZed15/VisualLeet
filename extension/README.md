# LeetScope

A Chrome (Manifest V3) extension that runs your Python solution to a LeetCode
problem entirely in the browser and plays it back step by step: the code with
the current line, the stack frames, the objects and the pointers between them.
Nothing is sent to a server.

## Build and load

```powershell
cd extension
npm ci
npm run build:extension
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
`extension/dist/extension`. After rebuilding, click the reload icon on the
LeetScope card, then reopen the LeetScope tab and reload LeetCode tabs.

## Using it

1. Open a LeetCode problem with the editor set to **Python3** and pick a case
   in LeetCode's **Testcase** tab.
2. Click **Visualize** in LeetCode's top bar, the LeetScope toolbar icon, or
   press **Alt+V**. LeetScope reads your code and that case, then opens (or
   reuses) its tab and plays the run.
3. The workspace: your code on the left (**Your code / Call / Setup**), the
   test cases under it (Case 1, 2, …, **+** adds one, hover a case you added
   to delete it), and the visualizer on the right with zoom, fit and the
   playback bar (play, step, timeline, speed).

The Visualize button glows briefly when one of LeetCode's own Runs finishes.
To turn that off, right-click the LeetScope toolbar icon and untick **Glow on
LeetCode when a Run finishes**, or assign a key to "Turn the Visualize
button's glow on LeetCode on or off" at `chrome://extensions/shortcuts`.

Problems that can't be visualized (editor not in Python, the Testcase tab not
open, a problem not in the database) are explained in a card under the
Visualize button on LeetCode.

Limits: 1,500 steps, 10 s, 64 KiB of printed output, 10 MiB trace, 256 KiB of
source. Hitting one is reported; a partial run is never shown as complete.

## Project layout

| Path | What it is |
| --- | --- |
| `src/manifest.json` | MV3 manifest: permissions, content script, sandbox page, CSPs |
| `src/background/` | Service worker: toolbar icon and its right-click glow setting, Alt+V, the Visualize button's requests, reading the LeetCode page (`leetcode-reader.js`) |
| `src/content/` | The Visualize button on LeetCode, its glow and message card |
| `src/ui/` | The LeetScope page. `ui.js` controller, `leetcode-mode.js` test cases, `harness.js` / `leet.js` / `leet-helpers.js` building the program from a database entry, `ui.css` workspace styles, `renderer-dark.css` the visualizer's dark styles |
| `src/runner/` | Sandboxed runner: `sandbox.*` (active and spare Python workers, watchdog), `worker.js` (Pyodide in a blob worker) |
| `src/python/` | Fork of Python Tutor's tracer (`pg_logger.py`, `pg_encoder.py`) |
| `src/visualizer/` | Fork of Python Tutor's renderer (`pytutor.ts`), `arrow-layer.ts` (replaces jsPlumb), bundled to `visualizer/renderer.js` |
| `src/problems/` | The problem database shipped with the extension (one file per problem + `index.json`) |
| `src/icons/` | Extension icons (16, 32, 48, 128 px PNG; `icon.svg` is the page favicon), the lockup and mark used in the UI |
| `problems/`, `scripts/build-db.mjs` … | Building and checking the database (not shipped) |
| `scripts/` | Build, acceptance checks, screenshots, stress test, database tools |
| `tests/` | Node unit tests and Python tracer tests |
| `bench/` | Renderer and tracer benchmarks against the original Python Tutor |
| `design/` | Design reference (not shipped): the redesign handover, brand sources, logo generator |

`dist/`, `node_modules/`, `acceptance/` and `bench/traces/` are generated and
git-ignored.

## How it works

```
LeetCode page ──click──> background worker ──reads the page (activeTab / host access)
                              │  stores the result in chrome.storage.session
                              v
                     ui/index.html (extension page, CSP script-src 'self')
                              │  sends 7 allowlisted packaged files, postMessage only
                              v
                     runner/sandbox.html (manifest sandbox: opaque origin,
                              │            no chrome.*, connect-src 'none')
                              v
                     blob: workers (Pyodide 314.0.8 / Python 3.14.2 + forked tracer)
```

- **Isolation.** Python runs in a blob worker inside the manifest sandbox, so
  it can't reach extension APIs or the network. User code can't `import js`
  (tracer allowlist), but the sandbox is the real boundary.
- **Fresh interpreters.** After a run, the used interpreter is swapped for a
  spare as soon as the spare is ready (about 1.5 s). Stop, timeout and Reset
  discard it, and a ready spare takes over at once.
- **Hidden setup.** Each problem's setup (LeetCode's usual imports, `ListNode`
  and `TreeNode`, building the inputs) runs untraced before your code, so the
  visualization shows only your code, the call and the inputs.
- **Problem database, not generation.** Each problem is a checked file in
  `src/problems/` with its input boxes, setup and call. Nothing is generated
  at click time; problems not in the database are not visualized.
- **Renderer fork, not rewrite.** jsPlumb is replaced by one batched SVG
  arrow layer, layout reads are batched, collections over 100 items are
  collapsed, and jQuery UI is no longer bundled. `bench/compare.html` checks
  the fork draws the same arrows and text as the original.

## Problem database

```powershell
node scripts/collect-problems.mjs   # facts from leetcode.com -> problems/collected/
node scripts/build-db.mjs           # -> src/problems/*.json
node scripts/verify-db.mjs          # known-good solutions (problems/solutions/) on LeetCode's
                                    # examples through the real tracer; run after every build-db
node scripts/check-calls.mjs        # each call against LeetCode's starter signature
```

Hand-written entries (`problems/handwritten.json`) win over generated ones and
cover LeetCode's "manual" problems. `problems/overrides.json` lists problems
that accept any order or several answers. New batches: `node
scripts/collect-lists.mjs --count 400`, then `collect-problems.mjs --list`.

## Tests

```powershell
cd extension
npm test                                 # program building, LeetCode values and types
npm run build:extension-test             # the extension + host access to the local fixtures
npm run acceptance                       # end-to-end checks in headless Chrome -> acceptance/
node scripts/stress.mjs                  # slow-CPU stress test -> acceptance/
npm run build:extension
node scripts/shoot-states.mjs            # screenshots of every UI state -> acceptance/states/
cd ..
.venv\Scripts\python.exe -m unittest discover -s extension\tests -p "test_*.py"   # tracer
```

The test build exists because automation can't click the toolbar icon. The
acceptance script maps `leetcode.com` to a local HTTPS fixture. Never ship
`dist/extension-test`.

The checks run whole Python programs through the `visualleet.run(source)` test
hook (example programs in `scripts/lib/programs.mjs`) and drive the LeetCode
flow by clicking the real Visualize button on fixture pages.

Benchmarks: `npm run build:renderer`, `npm run build:baseline` (the original
renderer), `node scripts/serve-bench.mjs`, then
`http://127.0.0.1:8765/bench/index.html` or `/bench/compare.html`.

## Rules for changes

- Never modify `../OnlinePythonTutor-Backup/`. The forks in `src/python/` and
  `src/visualizer/` carry a provenance header (archive commit `473848d`).
- The tracer's output must stay identical to the original apart from the
  documented changes (the 64 KiB output limit, hidden Python 3.13 class
  attributes, the hidden setup). `tests/test_tracer_equivalence.py` enforces it.
- Measure before and after performance changes (`bench/`, the acceptance
  timings; expect about ±30% noise).
- No server, CDN, remote code or telemetry. Never show a partial result as
  complete. Keep the user's edits when reading a page fails.

## Gotchas

- The renderer skips drawing into a hidden container: unhide `#viz` before
  `renderTrace`.
- Arrows are drawn once per step; anything that changes the layout around the
  frames and objects needs `viz.redrawConnectors()` on the next frame.
- `[hidden]` loses to component `display` rules unless forced; `ui.css` has
  `[hidden] { display: none !important }`.
- While a run is shown, the Code panel and test cases sit inside the
  renderer's table, which sets Verdana; `ui.css` sets the design's font back.
- LeetCode's own CSS resets buttons, so the Visualize button's styles are
  scoped to its id. LeetCode only renders the Testcase panel while its tab is
  open. After in-app navigation `window.__NEXT_DATA__` still describes the
  first problem; the reader uses `window.next.router.components`.
- `pyodide` requests files with `URL` objects, so the worker's fetch override
  handles both strings and URLs. Chrome forces HTTPS for leetcode.com, so test
  fixtures are HTTPS.
- Python 3.14 annotations are lazy: entries need node-class helpers for the
  return type too, or the encoder's argument inspection fails.
- Icons: the toolbar uses `icon-16.png` (`icon-32.png` on 200% screens), and
  `chrome://extensions` always uses `icon-48.png` shown at 36 px, so it is
  stretched on 200% screens. The 16 px icon is hand-tuned and the 32 and 48 px
  icons are pixel-aligned with no rim, which keeps them sharp. Chrome caches
  icons: after changing them, remove and load the unpacked extension again.

## Credits

LeetScope is built on [Python Tutor](https://pythontutor.com) by Philip Guo.
The tracer and renderer in `src/python/` and `src/visualizer/` are forks of
its code. Python runs on [Pyodide](https://pyodide.org).
