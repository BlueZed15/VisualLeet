# LeetScope extension (formerly VisualLeet)

A Chrome (MV3) extension that runs your Python DSA solution entirely in the
browser and shows a Python Tutor-style step-by-step visualization. Spec:
`../VISUALLEET_EXTENSION_SPEC.md`. Status: working prototype with the LeetScope
player UI (edit / playing modes, animated steps, zoom and drag), one-click visualization of LeetCode
test cases backed by a checked problem database (all NeetCode 150);
acceptance results in [`acceptance/`](acceptance/) (55/55 automated checks),
screenshots of every UI state in [`acceptance/states/`](acceptance/states/).
Picking up the work? Start with [`HANDOVER.md`](HANDOVER.md).

The archive in `../OnlinePythonTutor-Backup/` is **not modified**; the desktop
Bottle workflow keeps using its original files.

## Install and use

```powershell
cd extension
npm ci
npm run build:extension
```

Chrome → `chrome://extensions` → Developer mode → **Load unpacked** →
`extension/dist/extension`. Pin the LeetScope icon.

### On LeetCode: one click

1. On a LeetCode problem (editor set to **Python3**), pick the case you want
   in LeetCode's **Testcase** panel (an example, one you added, or edited
   values; a failing case from a submission works too).
2. Click **Visualize** in LeetCode's top bar (next to Submit), the LeetScope icon, or press **Alt+V**. LeetScope copies your
   code and that case, switches to the open LeetScope tab (or opens one) and opens it straight into playing.
3. The left column is the **test case**: tabs for the examples, the case from
   LeetCode and your own (**+** adds one; they're kept per problem), one box
   per input (checked as you type), the expected output for examples and a
   ✓/✗ verdict after the run. Below: **Your code**, the **Call** that runs it
   (editable) and the hidden **Setup**. Step with the slider or First / Prev /
   Next / Last. **From LeetCode tab** reads that tab again.

What runs: hidden setup (LeetCode's usual imports, `ListNode`/`TreeNode`
classes, your inputs) without being traced, then your code + the call. The
visualization shows only your code, the call and the inputs. The setup for
each problem comes from LeetScope's database (`src/problems/`): all 150
NeetCode problems, each checked against LeetCode's examples. Other problems
open in paste mode with a drafted test call.

### Paste mode (any Python)

**Paste mode** (top right) has the Solution / Test call / Setup / input()
editors: paste, use **Import selection** (copies what you selected on any
page you opened LeetScope from) or pick an Example, then **Visualize**
(Ctrl+Enter). **Stop** ends a long run; **Reset** restarts Python.

In paste mode what runs is exactly Setup + Solution + Test call, joined in
that order, and the visualizer shows that combined program. Code that only
defines things gets a prompt to add a test call instead of running. `input()`
reads lines from the input() tab.

Limits (both modes): 1,000 steps, 5 s, 64 KiB printed output, 10 MiB trace, 256 KiB
source. Hitting one is reported ("limit reached" / "timed out"); a partial
result is never shown as complete.

Reading pages is best-effort. If a page can't be read (protected `chrome://`
pages, a tab that navigated since you clicked the icon, a LeetCode page whose
editor hasn't loaded, a non-Python editor, the Testcase panel closed) you get
an explanation, nothing older is run in its place, and your current code is
left alone.

## Problem database

`src/problems/<slug>.json` (shipped, ~105 KB for 150 files) + `index.json`.
Each file holds the problem's input boxes (names and LeetCode types), the
hidden setup and the call, with `{box}` slots the extension fills with the
case. Files can be edited by hand. They are made and checked by:

```powershell
node scripts/collect-problems.mjs   # facts from leetcode.com -> problems/collected/ (dev only)
node scripts/build-db.mjs           # -> src/problems/*.json
node scripts/verify-db.mjs          # known-good solutions (problems/solutions/) on LeetCode's
                                    # examples, through the real tracer; stamps "verified"
```

Hand-written entries (`problems/handwritten.json`) cover problems whose test
input doesn't match the function (Linked List Cycle's `pos`, random pointers,
Clone Graph, LCA by value, Codec problems) and the 7 Premium ones.
`problems/overrides.json` lists problems that accept any order or several
answers. Verified 2026-11-15: 150/150.

## Architecture

```
toolbar click -> background service worker (remembers the source tab via activeTab,
                 |                          runs the importers with chrome.scripting)
                 v
ui/index.html  (extension page, CSP script-src 'self'): editors, status, renderer
   |  fetches an allowlist of 7 packaged files once; postMessage to its own frame only
   v
runner/sandbox.html  (manifest sandbox: opaque origin, no chrome.*, connect-src 'none')
   |  compiles the wasm once; keeps an active + a spare Python worker; 5 s watchdog
   v
blob: workers  (Pyodide 314.0.8 / Python 3.14.2 + forked tracer; fetch served from memory)
```

- Runs normally start on a fresh interpreter: after a run, the used one is
  swapped for the spare as soon as the spare is ready (about 1.5 s). Runs
  back-to-back inside that window reuse it (the tracer still gives each run
  fresh globals). Stop, timeout and Reset discard the interpreter, and a ready
  spare takes over immediately.
- Python can't reach extension APIs or the network. The checks run a probe
  through Pyodide's JS bridge that tries `chrome`, XHR, fetch (including the
  original `fetch`), `importScripts`, WebSocket and IndexedDB: all blocked,
  with CSP violation reports. User code can't `import js` at all (tracer allowlist).
- Permissions: `activeTab`, `scripting`, `storage` (hand-off to the LeetScope tab), and access to leetcode.com / leetcode.cn (for the Visualize button in LeetCode's top bar; Chrome shows "Read and change your data on leetcode.com"). Shortcut: Alt+V.

## Tests

```powershell
cd extension
node --test tests/                       # program assembly, LeetCode values/types, database entries (21)
npm run build:extension-test             # real extension + host access to 127.0.0.1 and leetcode.com
node scripts/acceptance.mjs              # 55 checks in headless Chrome -> acceptance/
npm run build:extension
node scripts/shoot-states.mjs            # screenshot every UI state -> acceptance/states/
cd ..
.venv\Scripts\python.exe -m unittest discover -s extension\tests -p "test_*.py"   # tracer (14)
```

The test build exists because automation can't click the toolbar icon to grant
`activeTab`. The acceptance script maps `leetcode.com` to a local HTTPS fixture
that imitates what the live site exposes. Never ship `dist/extension-test`.

Covered (details in `acceptance/acceptance-results.json`): every spec fixture
(Two Sum, BFS, sliding window, factorial frames, linked list, tree,
NestedInteger, DP history, aliasing, cycles, stdlib, syntax / caught / uncaught
errors, run A then B including module state), `input()`, missing test call,
exact combined program shown, HTML shown as text, isolation probe, step limit,
watchdog, Stop, stale results, large list / output / trace, repeated runs not
accumulating DOM, fresh-interpreter policy, selection import (line breaks,
empty selection), LeetCode import (off-screen lines, drafted call, non-Python
editor, missing editor), protected page, offline, closing the tab disposes the
workers.

### Timings (headless Chrome 157, Core Ultra 7 251HX, median of 7 runs)

| | BFS | Sliding window | Two Sum |
| --- | --- | --- | --- |
| Python run + trace | 13 ms | 8 ms | 32 ms |
| Click to first view | 29 ms | 23 ms | 48 ms |

Cold start (open tab to ready): 2.3 s. Ready again after Stop or a timeout:
immediate (spare interpreter). Watchdog fires at 5.02 s. Step navigation
measured in the spike: 3.3 ms median.

### Checked by hand, and not yet checked

- The LeetCode extractor function was run on the live leetcode.com Two Sum page
  (2026-11-14): read 87 of 87 lines while the editor showed lines 1-27, plus
  language `python3`, the title and 3 example inputs.
- **Not yet tried:** the real toolbar click -> activeTab flow in a normal
  Chrome window (automation can't click the icon), LeetCode while signed in,
  leetcode.cn.

## Known gaps

- Helper code in Setup (e.g. `build_list`) is traced too, so it adds steps and
  its functions appear in the Global frame.
- A return value that is a tree prints as a node object; step through the
  visualization to see its structure.
- Design: dark v0.1 only (no light mode yet). The visualizer's own controls
  (First/Prev/Next/Last, slider, legend) are restyled, not replaced.
  `acceptance/ui-*.png` show the earlier plain design.

## Development layout


| Path | What it is |
| --- | --- |
| `src/manifest.json` | MV3 manifest: background worker, sandbox page, CSPs |
| `src/background/background.js` | Toolbar button, source tab, selection and LeetCode importers |
| `src/ui/` | Extension page: `ui.js` controller, `prepare.js` program assembly and LeetCode drafts, `examples.js`; styles `ui.css`, `tokens.css`, `renderer-dark.css` (ported from `design/`) |
| `scripts/shoot-states.mjs` | Screenshots of the real extension in every UI state -> `acceptance/states/` |
| `src/runner/sandbox.*` | Sandboxed runner host: active + spare workers, watchdog, message checks |
| `src/runner/worker.js` | Python worker: loads Pyodide from in-memory assets, runs the tracer |
| `scripts/build-extension.mjs` | Builds `dist/extension` (or `dist/extension-test` with `--test`) |
| `scripts/acceptance.mjs` | Acceptance checks in headless Chrome -> `acceptance/` |
| `scripts/spike-check.mjs` | Loads the extension in headless Chrome and runs the spike checks |
| `spike/` | Spike results: `SPIKE.md`, `spike-results.json`, screenshot |
| `src/visualizer/pytutor.ts` | Fork of `v5-unity/js/pytutor.ts` with performance fixes (below) |
| `src/visualizer/arrow-layer.ts` | Replacement for the jsPlumb 1.3.10 calls pytutor.ts makes |
| `src/visualizer/index.ts` | Renderer entry point: `VisualLeetRenderer.renderTrace(containerId, trace, options)` |
| `src/visualizer/visualleet.css` | Styles for the collapse/expand controls |
| `src/python/pg_logger.py`, `pg_encoder.py` | Fork of the tracer: encoder speed, output limit, Python 3.13 class attributes hidden |
| `scripts/build-renderer.mjs` | esbuild bundle of the renderer (no type checking; legacy TS) |
| `scripts/serve-bench.mjs` | Static localhost server for the bench pages |
| `bench/` | Fixtures, trace generator, renderer bench page, old-vs-new compare page, tracer bench |
| `tests/` | Tracer equivalence + limit tests (Python), `prepare.js` tests (Node) |

Legacy libraries (jQuery, d3 v2, jQuery UI, bbq, doTimeout) and the Python
Tutor CSS are bundled straight from the archive, unmodified. jsPlumb is no
longer bundled.

## Commands (Windows PowerShell, from the workspace root)

```powershell
cd extension
npm ci                                   # esbuild, pyodide 314.0.8, puppeteer-core (pinned)
npm run build:extension                  # -> dist/extension (load unpacked in chrome://extensions)
npm run spike:check                      # automated spike checks in headless Chrome -> spike/
npm run build:renderer                   # -> dist/visualizer/renderer.{js,css} (bench pages)
npm run build:baseline                   # -> dist/baseline: the unmodified renderer, for comparisons
cd ..
.venv\Scripts\python.exe extension\bench\make_traces.py        # -> extension/bench/traces/*.json
.venv\Scripts\python.exe -m unittest discover -s extension\tests -p "test_*.py"
.venv\Scripts\python.exe extension\bench\tracer_bench.py       # original vs fork tracer timings
node extension\scripts\serve-bench.mjs                          # http://127.0.0.1:8765/bench/index.html
```

`dist/`, `node_modules/` and `bench/traces/` are generated and git-ignored.

### Comparing old and new renderer

`npm run build:baseline` bundles the **unmodified** archive renderer
(`bench/baseline-entry.ts`) into `dist/baseline`. Then:

- `bench/index.html` (fork) or `bench/index.html?build=baseline` (original):
  in the console, `await runSuite()` or `await bench("bfs", 0, 57)`.
- `bench/compare.html`: steps both renderers in lockstep and checks, at every
  step, that arrows (source → target), heap-object nudge margins, and the
  visible frame/object text are identical (margins to 0.1 px). In the
  console: `await runCompare()`. The two slowest traces are sampled (every
  10th/40th step plus the final steps) because the original renderer takes
  0.5–1.3 s per step on them.

## Renderer changes (`src/visualizer/pytutor.ts`)

See the diff:
`git diff --no-index OnlinePythonTutor-Backup/v5-unity/js/pytutor.ts extension/src/visualizer/pytutor.ts`

1. **Arrows**: jsPlumb is replaced by `ArrowLayer`, which implements the same
   calls (`connect`, `select().each/.detach`, `reset`, `repaintEverything`,
   `importDefaults`, connection `setPaintStyle`/`setHover`/`endpoints`/`canvas`).
   `connect()` only records an arrow. `flush()` (called once at the end of
   `renderDataStructures`) reads all endpoint positions in one pass and then
   draws every arrow into one SVG. Curve shape, anchors (right-middle →
   left-middle), arrowhead and dot sizes follow jsPlumb 1.3.10's StateMachine
   connector as Python Tutor configured it. Profiling showed jsPlumb's
   connect + reset at 70–80% of each step (about 4 ms per arrow).
2. **Rightward nudge**: the original shifts heap objects right so arrows
   between rows point rightward, reading an element position after every
   shift (one forced layout per heap→heap arrow; about 75 ms per step for a
   40-node linked list). `vlFastRightwardNudge` reads once, replays the same
   algorithm on a model of the shifts, writes, and re-reads once to verify.
   If anything doesn't match (or the structure is outside the model, e.g.
   nested objects) it undoes its writes and the original code runs.
   `globalThis.vlFastNudgeStats` counts fast vs fallback runs. Resulting
   margins match the original to within 0.1 px (0.05 px measured at a
   2,900 px margin): the original re-reads the computed margin, which Chrome
   serializes to 6 significant digits, on every `+=`; the fork adds exactly.
3. **List/set/dict cells** are created directly instead of with jQuery's
   `find('td:last')`, which rescanned every existing cell (O(n²): ~1.2 s per
   step for a 2,000-item list).
4. **Long collections are collapsed**: lists, tuples, dicts and sets with more
   than 100 items show the first 50 and last 10 (sets: the first 60), with a
   "(showing 60 of 2000)" label and a "+1940 more" button. "show fewer" folds
   it back. The choice persists across steps for that object.
   Hidden items are not drawn, so arrows from hidden items are not shown
   until expanded.
5. **Arrows stay attached when the page moves** (`arrow-layer.ts`): the
   arrow SVG's containing block is now the data container, so arrows scroll
   and move with the objects, and a ResizeObserver redraws them when the
   container or its children change size. Before, scrolling the visualizer
   sideways left arrows 113 px off, and the narrow stacked layout 918 px;
   after, ≤0.1 px in every case measured. The compare page is still
   identical on all 12 traces.

## Tracer changes (`src/python/pg_encoder.py`)

1. Lists, tuples, sets and dicts with at least 16 elements reuse the previous
   step's encoding when their elements are unchanged (same objects). The
   cache holds no references to user objects (only to immutable primitive
   elements), so object lifetimes, `__del__` timing and `id()` reuse in the
   user's program are unaffected.
2. `encode()` skips an `inspect.getmodule()` probe for builtin containers,
   whose result is always discarded for them.

`tests/test_tracer_equivalence.py` runs 26 programs (the bench fixtures plus
edge cases: in-place mutation, equal-but-new objects, id reuse, finalizers,
custom `__str__`/`__repr__`/`__eq__`, closures, stdlib containers, exceptions,
cycles) through the original tracer and the fork with the cache on and off,
and requires byte-identical JSON. The archive's own
`v5-unity/tests/test_local_runtime.py` also passes against the fork.

## Measured results

Machine: Windows 11, this workspace's laptop. Renderer timings from the
in-app Chromium browser pane, forced layout included, single session, both
builds measured back to back; expect ±30% run-to-run noise. Tracer timings:
desktop CPython 3.15.2 and Pyodide 314.0.8 (Python 3.14.2) under Node 26.

### Renderer, median time per step

Final run (all fixes in), 2026-11-14:

| Trace | Original | Fork |
| --- | --- | --- |
| BFS (58 steps) | 35.7 ms | 7.7 ms |
| Sliding window | 11.0 ms | 3.5 ms |
| LCS DP table | 23.9 ms | 9–12 ms |
| Recursive fib | 6.1 ms | 3.1 ms |
| Binary tree in-order | 51.6 ms | 10–15 ms |
| 1,000-step limit, 100-item list | 30.9 ms | 8.0 ms |
| 40-node linked list (last 30 steps) | 592 ms | 37–49 ms |
| 2,000-item list, collapsed (default) | 1,374 ms | 9.3 ms |
| 2,000-item list, expanded | 1,374 ms | 174 ms |

Worst single step for the fork on repeat runs: 72 ms (linked list). A first
run once showed isolated 450–600 ms spikes that did not reproduce.

### Tracer (whole run, median of 5)

| Trace | Desktop original → fork | Pyodide original → fork |
| --- | --- | --- |
| 2,000-item list, 405 steps | 136 → 23 ms | 316 → 103 ms (of which 51 ms is `json.dumps`) |
| Others | within noise | within noise |

## Not done / known gaps

- The renderer still rebuilds every heap object on every step. With the fixes
  above that is cheap except for an expanded collection of thousands of
  items (~178 ms/step for 2,000).
- Linked structures with many small objects (e.g. 40 nodes × 447 steps) still
  cost ~350 ms of tracing in Pyodide; the encode cache does not help small
  objects (checking costs as much as encoding).
- Large traces are still sent as full snapshots (3.5 MB for the 2,000-item
  list); a "send each object once" format would shrink transfer and
  `json.dumps`, but needs renderer-side reconstruction.
- Nothing here is inside a Chrome extension yet; the Pyodide numbers come from
  Node, not from an extension worker.
