# VisualLeet design (dark v0.1)

Design dashboard for the VisualLeet extension UI: dark first, IDE-like,
LeetCode's design language with a little flair. Prototype only; nothing here
is loaded by the extension.

Open it: `node extension/scripts/serve-bench.mjs`, then
http://127.0.0.1:8765/design/index.html. The switcher (bottom right) shows
every state; `?state=limit` etc. opens one directly.

| File | What |
| --- | --- |
| `index.html` | Dashboard: live workspace mock, tokens, components, states |
| `tokens.css` | Colors, type, radii, spacing (the part to port first) |
| `dashboard.css` | Components (buttons, status pill, tabs, editor, messages, placeholders, step meter) and the workspace layout |
| `renderer-dark.css` | CSS-only dark restyle of the Python Tutor renderer (no renderer source changes) |
| `_shared/` | Copied renderer bundle, sample traces, fake runtime (`proto.js`), screenshot script |
| `screenshots/` | `workspace-<state>.png`, `dashboard-full.png` (`node extension/design/_shared/shoot.mjs <states>`) |

## Direction

- **Layout** (LeetCode's): 44px top bar (logo, import actions, source-page chip later, status pill right) · left column = Solution editor panel (example picker in its tab bar) over a "testcase" panel with tabs Test call / Setup / input() and an Add-helper picker · action bar (green Visualize with Ctrl+Enter hint, red-outline Stop, ghost Reset, Diagnostics toggle) · right = Visualizer panel with a step meter in its tab bar.
- **Visualizer** uses `verticalStack: true, codeDivHeight: 250` so code sits above frames/objects in the side panel.
- **Flair**: glowing orange `</>` logo mark, orange→gold step-meter bar, pulsing dot in busy status pills, orange current-line arrow.
- **States**: placeholders replace the visualizer (empty, starting, running, timed out, stopped, syntax error); banners sit above a trace that is still shown (limit reached); import results are messages at the top of the visualizer panel.

## Porting notes for `extension/src/ui/`

- Link `tokens.css`, the component rules from `dashboard.css`, and `renderer-dark.css` (all CSP-safe: no inline script, no remote fonts).
- Pass `{ verticalStack: true, codeDivHeight: 250 }` to `renderTrace`.
- **Redraw arrows after anything changes height above the trace** (banner, message, panel resize): `viz.redrawConnectors()` on the next frame. Arrows are drawn once per step, so they drift otherwise.
- Arrow colors are overridden by matching the arrow layer's stroke/fill attribute values (`#005583`, `#cccccc`); keep those in sync if `arrow-layer.ts` defaults change.
