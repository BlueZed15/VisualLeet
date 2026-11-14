# VisualLeet implementation handover

For whoever picks up the **implementation** next (another model or person).
Read this first, then `README.md` (usage, architecture, tests, results) and the
spec `../VISUALLEET_EXTENSION_SPEC.md`. The visual-design track has its own
handover: `design/HANDOVER.md`. Last updated 2026-11-15.

## Where things stand

- **Database: 600 problems** (2026-11-15). NeetCode 150 (each checked with a
  known-good solution) + 450 more from LeetCode's study plans (LeetCode 75,
  Top Interview 150, Top 100 Liked) and the most-liked free problems
  (`problems/batch-2026-11-15.json`, made by `scripts/collect-lists.mjs`).
  The 450 are **inputs-checked**: every example's inputs are built through
  the real tracer and printed back exactly (design problems: operations and
  typed arguments). Files carry `checked: "solution" | "inputs" | "none"`;
  the badge shows "✓ checked setup" / "inputs checked". User's plan: write
  solutions for full checks in later batches. 20 skipped (17 LeetCode
  "manual" problems that need hand-written entries, see
  `problems/build-skipped.json`; 3 SQL/pandas problems).

- **2026-11-15, later (user requests):** problems at click time are shown on
  the LeetCode page next to the Visualize button (content-script message;
  LeetScope isn't opened): non-Python editor, unreadable code, problem not in
  the database, selected test case not found (with "Use Example 1"). The
  background checks this in `clickProblem` before switching tabs. The user
  said **not** to read cases from LeetCode's plain-text test editor.
  Status pill hidden when Ready/Done. In LeetCode mode **Edit keeps the
  last run on the right** (the code card replaces the stepping code view in
  the left column); Visualize / Run case replaces it. Diagnostics float under
  the top bar. **Resizable panes:** handles between the columns, between code
  and test cases, and at their corner (both); sizes in CSS variables
  `--left-w` / `--cases-h`, saved in localStorage; double-click a handle to reset.

- **2026-11-15, on `merge_1` (user decisions):** LeetScope is LeetCode-only in
  the normal build. Paste mode, the examples, "Import selection",
  "Import from LeetCode" and the Editing/Playing header row are gone; restart
  and diagnostics are icons in the top bar. The code card has tabs **Your
  code / Call / Setup**; the bottom panel is only the test cases. With no
  problem loaded, an empty state explains how to start. Problems not in the
  database get a message (the database is meant to grow to all problems).
  **Dev build** (`npm run build:extension-dev` → `dist/extension-dev`, named
  "LeetScope (DEV)") and the test build keep examples, Import selection and
  paste mode (the acceptance checks and `shoot-states.mjs` use them);
  detected in `ui.js` by the manifest name.
- Test-case reading hardened after the user hit "Couldn't read LeetCode's
  Testcase panel": design problems' boxes have no "name =" labels (now read
  in order), the raw-case editor is looked up inside the Testcase panel only
  (a signed-in page can have other CodeMirror editors), the reader waits up
  to 1.5 s for the panel, all of the user's LeetCode cases are imported
  ("LeetCode n", examples not repeated), and a failure says what was found.

- **Branch `merge_1`** (2026-11-15) combines this work with the collaborator's
  `origin/feat/UI-Improvement`: product renamed **LeetScope** (icons, logo,
  title), their player UI (edit / playing modes, play + transport + scrubber
  + speed, step animation, zoom/pan/drag, hover arrows, value inspector,
  wide layout, "tidy" labels for typing names/functions/classes in the
  tracer, ~20 more examples). Their `ui.js`/`ui.css`/`index.html`/
  `renderer-dark.css` are the base; LeetCode mode was ported into them:
  code on the left (editable; the stepping code view while playing), the
  test-case panel under it (Call/Setup as tabs there), the visualization on
  the right; a click on LeetCode opens straight into playing; picking another
  case while playing reruns it. Paste mode is their UI unchanged. Internal
  names (`window.visualleet`, storage keys, tracer option names) still say
  visualleet on purpose (tests and saved cases depend on them).

- A working MV3 extension: `npm run build:extension` → `dist/extension`, loaded
  unpacked in Chrome. Python 3.14.2 (Pyodide 314.0.8) runs the archived Python
  Tutor tracer inside a sandboxed worker; the forked Python Tutor renderer draws it.
- **One-click LeetCode flow** (2026-11-15, what the user asked for): on a
  LeetCode problem, the VisualLeet icon or **Alt+V** reads the code and the
  test case selected in LeetCode's Testcase panel, opens/focuses the
  VisualLeet tab and visualizes it at once. The left column becomes a
  **test-case panel** (case tabs, one checked box per input, expected output,
  ✓/✗ verdict); code/call/setup are tabs below. "Paste mode" keeps the old
  editors for code from anywhere else.
- **Problem database = files** (the user's explicit choice: "db files", no
  runtime generation): `src/problems/<slug>.json`, one per NeetCode 150
  problem, plus `index.json`. Each file holds the input boxes and the exact
  hidden setup + call; at runtime the extension only fills in the case
  values. **All 150 verified** (a known-good solution through the real tracer
  on LeetCode's own examples, expected outputs matched). Problems not in the
  database fall back to paste mode with a drafted call.
- **Setup is hidden from the visualization**: inputs are built by untraced
  setup code (new tracer option); only the inputs show in the Global frame.
- **The dark v0.1 design is ported** (2026-11-14) from `design/` into `src/ui/`
  (LeetCode-style layout, status pill, tabs, step meter, placeholders/banners,
  dark visualizer). Screenshots of every state of the real extension:
  `acceptance/states/` (`node scripts/shoot-states.mjs`).
- **Arrow drift fixed** (the user saw arrows "moving here and there" in real
  Chrome): see "Decisions" below.
- Verified automatically: **55/55** acceptance checks (`scripts/acceptance.mjs`,
  headless Chrome 157; 17 of them for the LeetCode flow against a fake
  LeetCode page with the live site's structure), 21 Node tests, 14 Python
  tracer tests (equivalence still byte-identical), renderer old-vs-new compare
  page identical on all 12 traces, 150/150 database files verified.
- **Checked by the user:** the real toolbar-click → activeTab → import flow
  works "for the most part" (2026-11-14, before the design port). **Not
  verified yet in a real Chrome window:** the one-click flow, Alt+V, the new
  design, the arrow fix; LeetCode while signed in; leetcode.cn. The page
  reader was tested on the live site in the in-app browser (signed out).
- Git: the design port, arrow fix and LeetCode flow are uncommitted unless
  the user has committed since. Don't commit or push unless the user asks.

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
| Toolbar/Alt+V behavior, selection import, hand-off to the UI tab | `src/background/background.js` |
| Reading a LeetCode page (problem, code, selected case) | `src/background/leetcode-reader.js` (runs in the page) |
| Test-case panel (cases, boxes, verdict, saved per problem) | `src/ui/leetcode-mode.js` |
| Filling a database entry with a case | `src/ui/harness.js`; values/types/compare: `src/ui/leet.js`; hidden Python helpers: `src/ui/leet-helpers.js` |
| The problem database | `src/problems/*.json` (generated, then hand-editable); sources in `problems/` |
| Collect / build / verify the database | `scripts/collect-problems.mjs`, `scripts/build-db.mjs` (+ `scripts/lib/entry-writer.mjs`), `scripts/verify-db.mjs` (+ `verify_runner.py`) |
| Hand-written entries, order/multiple-answer corrections | `problems/handwritten.json`, `problems/overrides.json` |
| Untraced setup in the tracer | `src/python/pg_logger.py` (`visualleet_setup` options) |
| Page layout / components (dark v0.1) | `src/ui/index.html`, `src/ui/ui.css`, tokens in `src/ui/tokens.css` |
| Visualizer restyle (CSS only) | `src/ui/renderer-dark.css` |
| Run flow, statuses, where messages show, tabs, step meter, test hooks | `src/ui/ui.js` |
| Screenshots of every UI state | `scripts/shoot-states.mjs` → `acceptance/states/` |
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
node --test tests/                # prepare.js + harness/leet unit tests
node scripts/shoot-states.mjs     # screenshots of every UI state (needs build:extension)
# problem database (only when adding problems or changing helpers):
node scripts/collect-problems.mjs # leetcode.com -> problems/collected/ (1.5 s between requests; --only a,b)
node scripts/build-db.mjs         # -> src/problems/<slug>.json + index.json (verified=false)
node scripts/verify-db.mjs        # runs problems/solutions/*.py through the tracer, stamps verified
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
- **Arrows stay attached** (`arrow-layer.ts`, `attach()`): arrows are drawn once
  per step, relative to the SVG's on-screen position. The SVG used to have no
  positioned ancestor, so it didn't move with a scrolling panel or a layout
  shift (measured in real Chrome: 113 px off after scrolling the visualizer
  sideways, 918 px in the narrow stacked layout). Now the container
  (`#vizLayoutTdSecond`) is made the SVG's containing block, and a
  ResizeObserver on the container and its children redraws when they change
  size (window resize, output box). Measured drift after the fix: ≤0.1 px in
  every case (scroll, resize to 1100/850 px, panels toggled) on three
  examples. No caller needs `redrawConnectors()` after layout changes any more.
- **Where results show** (ported design): status pill = run state; notice
  (`#message`) = imports, validation, runtime notes; banner = facts about a
  trace that is still shown (limit reached, needs input); placeholder =
  replaces the visualizer when there is nothing valid to show (starting,
  empty, running > 400 ms, stopped, timed out, errors). Short runs never
  flash the "running" placeholder. `visualleet.message()` returns all visible
  text from those three, which is what the acceptance checks match.
- **Visualizer options**: `{ verticalStack: true, codeDivHeight: 250 }` (code
  above frames/objects; side-by-side needs ~1100 px). The step meter follows
  the renderer via its `updateOutputCallback` option (no polling).
- The renderer's "(see UNSUPPORTED FEATURES)" link to Python Tutor's site is
  hidden with CSS; the tracer's own limit text is unchanged (equivalence
  tests), and the banner words it for VisualLeet.
- **LeetCode flow**: three triggers, one path (`showFrom` in the background):
  the toolbar icon, Alt+V (`commands._execute_action`), and a **Visualize
  button in LeetCode's top bar** (`src/content/leetcode-button.js`, added to
  `#ide-top-btns`, re-added when React re-renders; the user asked for it).
  The background reads the page in its MAIN world (`leetcode-reader.js`),
  bounds everything, stores it in `chrome.storage.session` ("pending"), then
  **reuses the open VisualLeet tab** (updated in place, Python stays warm) or
  opens one. Permissions: `activeTab`, `scripting`, `storage`, host access
  to leetcode.com/.cn (needed by the button; install warning "Read and change
  your data on leetcode.com"). Background is a module worker.
- Bug fixed 2026-11-15: `chrome.runtime.getContexts({documentUrls})` matches
  exact URLs, not patterns; with `…/index.html*` every click opened a new
  VisualLeet tab and restarted Python. Now all TAB contexts are filtered by prefix.
- Bug fixed 2026-11-15 (user hit it): after a Run, LeetCode shows "Test
  Result" and stops rendering the Testcase panel; `innerText` then equals
  `textContent` ("nums =[2,7,11,15]", raw cases run together) and the case
  wasn't read. The reader now reads structure: boxes marked
  `data-e2e-locator="console-testcase-input"`, the label element, `.cm-line` rows.
- **Database files, not runtime generation** (user's decision). Entry kinds:
  `template` (setup/call text with `{box}` slots, filled with the value
  written as Python) and `design` (operations + arguments, typed per method).
  `scripts/lib/entry-writer.mjs` writes entries from LeetCode's metadata at
  build time only. Hand-written entries win; they cover LeetCode's "manual"
  problems (Linked List Cycle `pos`, random pointers, Clone Graph, LCA with
  p/q values, Codec problems) and the 7 premium ones (signed-out collection
  returns nothing for them). Shipped files hold our setup + LeetCode
  signatures only; examples/statements stay in `problems/collected/` (dev).
- **Verdict**: only for unchanged examples (expected output from the
  statement). "Any order" from the statement or `overrides.json`;
  inner order is ignored only when the expected inner lists are sorted
  (groups/triplets yes, permutations no). `multipleAnswers` problems never
  show ✗ for a different answer. Unparseable expected → no verdict.
- **Hidden setup** (`pg_logger.py`, options `visualleet_setup`,
  `visualleet_setup_visible`): exec'd in its own module before tracing, so its
  functions are never stepped (but user methods it calls, e.g. design
  `run_ops`, are). Its names are hidden from the Global frame unless listed
  visible or rebound by the user. Off by default: equivalence unchanged.
- Setup provides what LeetCode's Python3 environment provides without
  imports (`typing`, `collections`, `heapq`, `bisect`, `math`, `itertools`,
  `functools`, …) and prints results with `leet_str` in LeetCode's format.

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
- The renderer skips drawing when `#viz` isn't visible (`updateOutput` checks
  `:visible`): unhide it (`setPlaceholder(null)`) **before** `renderTrace`.
- Component rules like `.placeholder { display: grid }` beat the browser's
  `[hidden]` style; `ui.css` has `[hidden] { display: none !important }`.
- The print-output textarea is sized by the renderer for content-box and
  wrapped by jQuery UI `resizable()`; under this page's global `border-box`
  it came out 9 px tall. `renderer-dark.css` sets it back to content-box.
- LeetCode page facts (checked live 2026-11-14): after in-app navigation
  `window.__NEXT_DATA__` still describes the first problem; the current one is
  in `window.next.router.components` (match `titleSlug`). Metadata params can
  be language-specific (`"lang": "c"`, e.g. Kth Largest's `numsSize`): drop
  them. "manual" also marks problems that are only manual for other languages
  (Number of Islands). Some example outputs span several lines.
- Entries need node-class helpers for the **return** type too: Python 3.14
  annotations are lazy, and a solution annotated `-> Optional[TreeNode]`
  without TreeNode defined made the encoder's `getfullargspec` raise and
  abort the trace. Fixed both ways (helpers added; `pg_encoder._vl_argspec`
  falls back to the code object).
- An empty linked list/tree prints as `[]` on LeetCode, not `null`: the call
  prints by declared return type (`list_values` / `tree_values`).
- The Write tool turned ` ` in regexes into literal NBSP characters; use
  `\xa0`. GNU sed treats `\u` in replacements as "uppercase next char".
- The acceptance "step navigation" timing used to run on Two Sum, whose trace
  ends before 40 "Next" clicks, so it reported 0 ms. It now runs on BFS
  (3.7 ms median, 8.4 ms worst).

## Suggested next steps (spec order; confirm with the user)

1. The user re-tests in real Chrome: one click / Alt+V on LeetCode (signed
   in), the test-case panel, design, arrows. Fix what they find. The design
   track hasn't designed the test-case panel; it uses the v0.1 components.
2. Grow the database beyond the NeetCode 150: add slugs to a list, collect,
   write solutions, build, verify. Premium problems need hand-written entries
   (or collection while signed in, which the scripts don't do).
3. Design follow-ups the design track left open (decide with the user):
   a designed test-case panel; replace the legacy First/Prev/Next/Last +
   slider with the step meter or restyle further; light mode; the renderer's
   red limit text at step 1 duplicates the banner. If `design/` changes,
   re-port `tokens.css` and `renderer-dark.css` (copies with a provenance header).
4. Optional quality items: paste mode could run its Setup tab hidden too
   (LeetCode mode already does); an editor with syntax highlighting (measure
   page-load cost).
5. Bigger, only if measurements call for it: send each heap object once
   (delta traces) for very large inputs; incremental heap rendering for
   expanded huge collections (~178 ms/step at 2,000 items).
6. Spec benchmark procedure in a headed Chrome; Chrome Web Store work is out
   of scope for the prototype.
