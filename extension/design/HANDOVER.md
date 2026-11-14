# VisualLeet design handover

For a new chat picking up the VisualLeet UI design. Read this first, then
`extension/design/README.md`.

## The product in one paragraph

VisualLeet is a Chrome (Manifest V3) extension: open a Python DSA solution
(e.g. on LeetCode), import it, add a small test call, click **Visualize**, and
step through a Python Tutor-style visualization (code with current-line
arrows, stack frames, heap objects, reference arrows, printed output).
Python runs entirely in the browser (Pyodide 314.0.8 / Python 3.14.2) in a
sandboxed worker; nothing is sent to a server. Full requirements:
`VISUALLEET_EXTENSION_SPEC.md` at the workspace root.

## Who and what the user wants (from the user)

- For **users** (LeetCode learners), not just the author.
- **IDE-like**, **slightly playful**, basically **LeetCode's design language
  with some flair**. Basic colors are fine.
- **Dark mode first** (light mode later, not designed yet).
- The user wants to work iteratively from a **design dashboard** and decide
  direction together. They dislike wasted effort: don't build many variants
  unprompted; show, ask, refine.

## Where things stand (dark v0.1)

Open: `node extension/scripts/serve-bench.mjs` (from the workspace root
`C:\Users\rohis\VisualLeet`), then http://127.0.0.1:8765/design/index.html.
Switch states with the control in the bottom-right corner, or `?state=…`
(`complete, empty, initializing, running, limit, timeout, stopped, syntax,
import-ok, import-fail`), and `?example=bfs|reverse_list|two_sum`.

| File | What |
| --- | --- |
| `design/index.html` | Dashboard: live workspace mock, tokens, components, states |
| `design/tokens.css` | Color/type/radius/spacing tokens |
| `design/dashboard.css` | Components + workspace layout |
| `design/renderer-dark.css` | CSS-only dark restyle of the visualizer |
| `design/_shared/proto.js` | Fake runtime: fills editors, replays real traces, simulates states. Not product code |
| `design/_shared/renderer.{js,css}` | **Copy** of the real renderer bundle (from `extension/dist/visualizer/`) |
| `design/_shared/traces/` | Real traces + `examples.json` (setup/solution/call split) |
| `design/_shared/shoot.mjs` | Headless screenshots → `design/screenshots/` (needs the server running) |
| `design/screenshots/` | `workspace-<state>.png`, `dashboard-full.png` |

Decisions in v0.1 (the user has seen it, but hasn't approved any direction yet):

- **Palette** (LeetCode family): page `#1a1a1a`, panels `#262626`, inputs
  `#303030`, hover `#3d3d3d`, lines `#3a3a3a`; text `#eff1f6 / #b6bac2 /
  #8a8f98`; brand orange `#ffa116`; run/success green `#2cbb5d`; warn
  `#ffc01e`; error `#ef4743`; info `#3c9cff`. Visualizer: active frame
  `#2f2a20` with an orange left border, objects `#2e2b25`, arrows `#6cb6ff`,
  strings `#7ee2a8`, numbers `#79b8ff`, None/bools `#d2a8ff`.
- **Type**: system UI font (like LeetCode); code in a monospace stack
  (`JetBrains Mono` → Cascadia → Consolas). No web fonts: they would have to
  be bundled locally (MV3, no CDNs).
- **Layout**: 44px top bar (logo, Import LeetCode editor, Import selection,
  status pill right) · left column: **Solution** panel (example picker in its
  tab bar) over a LeetCode-"testcase"-style panel with tabs **Test call /
  Setup / input()** and an **+ Add helper** picker · action bar: green
  **Visualize** (Ctrl+Enter hint), red-outline **Stop**, ghost **Reset**,
  **Diagnostics** toggle · right: **Visualizer** panel, step meter in its tab bar.
- **Flair**: glowing orange `</>` logo mark, orange→gold step-meter bar,
  pulsing dot in busy status pills, orange current-line arrow.
- **States**: placeholders replace the visualizer (empty, starting Python,
  running, timed out, stopped, syntax error); a banner sits above a trace that
  is still shown (step limit reached); import results show as a message at the
  top of the visualizer panel.

Open questions to raise with the user: layout (is Solution-over-testcase
right? where does the source-page chip go?), how much flair, whether the
visualizer's legacy controls (First/Prev/Next/Last buttons, slider, legend)
should be restyled further or replaced by the step meter, light mode, and
small-screen behaviour.

## Working rules (important)

- **Another Claude session is building the real extension in the same
  folder at the same time** (no git worktree). Stay inside
  `extension/design/`. Do **not** edit `extension/src/`, `scripts/`,
  `bench/`, `tests/`, `package.json`, or the archive
  `OnlinePythonTutor-Backup/`.
- Do **not** run `npm run build:extension`, `build:renderer`,
  `build:baseline`, `spike:check` (they rewrite `extension/dist/`, which the
  other session uses). Reading `extension/dist/` is fine. To refresh the
  renderer copy, copy `extension/dist/visualizer/renderer.{js,css}` into
  `design/_shared/`.
- Don't commit, don't switch branches. Nothing in the repo is committed yet.
- Designs must stay implementable on an MV3 extension page: no inline
  `<script>` or `on…=` handlers, no eval, no remote scripts/fonts/CDNs.
  (Inline `style` attributes are allowed; the dashboard uses a few for swatches.)
- Restyle the visualizer **with CSS only**; its source
  (`extension/src/visualizer/pytutor.ts`, a fork of Online Python Tutor) is
  owned by the other session.
- Windows machine, Git Bash and PowerShell available. Chrome 157 at
  `C:\Program Files\Google\Chrome\Application\chrome.exe`; `puppeteer-core`
  is installed in `extension/node_modules` (used by `shoot.mjs`). The in-app
  browser pane's screenshots were unreliable for this page; `shoot.mjs` works.

## Visualizer facts a designer needs

- It's Python Tutor's `ExecutionVisualizer`, called as
  `VisualLeetRenderer.renderTrace("viz", trace, options)`. The mock passes
  `{ verticalStack: true, codeDivHeight: 250 }` (code above frames/objects,
  which fits a side panel; the default puts them side by side and needs ~1100px).
- It renders its own DOM: `#pyCodeOutput` (code table, `.lineNo`, `.cod`),
  `#leftCodeGutterSVG` with `#curLineArrow` / `#prevLineArrow`, `#vcrControls`
  (First/Prev/Next/Last), jQuery UI `#executionSlider`, `#pyStdout`
  (output), `.stackFrame` / `.highlightedStackFrame` / `.zombieStackFrame`,
  `.heapObject`, `.typeLabel`, `table.listTbl/tupleTbl/setTbl/dictTbl/instTbl`,
  value spans `.stringObj/.numberObj/.boolObj/.nullObj`.
- Arrows are one SVG layer (`.vlArrowLayer`, replaces jsPlumb). Colors come
  from attributes (`#005583` normal, `#cccccc` inactive, `#e93f34` hover);
  `renderer-dark.css` recolors them by matching those attribute values.
- Arrows are drawn once per step. **Anything that changes height above the
  trace (banner, message, panel resize) must be followed by
  `viz.redrawConnectors()` on the next frame**, or arrows drift. `proto.js`
  does this.
- Lists/dicts/sets over 100 items collapse to "showing 60 of N" with a
  "+N more" button (`.vlExpandCollection`, `.vlCollapseCollection`, `.vlCollapsedNote`).
- A syntax error yields a one-step trace; the UI shows an error message
  instead of opening the visualizer.

## The real UI the design will be ported into

`extension/src/ui/index.html` + `ui.css` + `ui.js`, built by the other
session with a plain light style. Its element ids (as of this handover; check
the file, it changes): `status`, `source-tab` (name of the page to import
from), `import-leetcode`, `import-selection`, `example`, `helper`, `setup`,
`solution`, `call`, `inputs` (lines for `input()`), `visualize`, `stop`,
`reset`, `message`, `diag`, `empty`, `viz`. Status values it uses include
`not initialized, initializing, ready, running, preparing visualization,
complete, limit reached, timed out, stopped, failed, needs input`.
The mock's ids differ (`importLeetcode`, `importSelection`, `placeholder`,
`banner`); map them when porting.

Measured speed (for "loading" design decisions): runtime start ~2.4 s once
per tab, restart after Stop/timeout ~2.4 s, click → first view ~30 ms for
small examples, step navigation ~3 ms.

## Done looks like (for the design track)

The user picks a direction on the dashboard; it's written up as a short spec
(tokens, type, spacing, layout, every state) in `extension/design/`, plus
CSS the main session can drop into `extension/src/ui/`. Update
`design/README.md` and screenshots as the design changes.
