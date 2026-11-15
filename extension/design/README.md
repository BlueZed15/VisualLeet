# LeetScope design files

Reference material for the extension's look. None of it ships; the built
extension uses `src/ui/` and `src/icons/`.

| Folder | What it is |
| --- | --- |
| `handover/` | The "Signature" redesign: workspace, LeetCode button, glow, message card. `handover/README.md` has every value; `tokens.css` and `leetcode-button.css` are what `src/` uses. |
| `brand/` | The current logo, the X1 refined mark (a lens with blue, amber and coral cells): app icons at 16, 32, 48 and 128 px, and the mark on a light background. These replace the tree mark in the handover's brand section. |
| `logo/` | `make_logo.py`, which generates the lockup ("Leet" in Spline Sans Mono plus the dot-grid "Scope") and the icon SVGs. Needs the Spline Sans Mono 600 TTF. |

The small icons are drawn per size rather than scaled from the 128 px one:
16 px is hand-tuned, and 32 px (the toolbar on 200% screens) and 48 px (the
`chrome://extensions` card, which Chrome shows at 36 px) put every straight
edge and both edges of the ring on whole pixels. None of the icons have the
light rim; at these sizes it blurs into a grey haze.

To refresh the icons in the extension, render the `brand/icon-*.svg` files to
PNG at 1x and copy them to `src/icons/` (`icon.svg`, the page favicon, is the
32 px design).
