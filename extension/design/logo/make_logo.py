# Generates the LeetScope icons and logo SVGs.
# Usage: python3 make_logo.py <SplineSansMono-SemiBold.ttf> <outdir>
# "Leet" is Spline Sans Mono 600 (OFL) converted to outlines; "Scope" is a hand-set dot grid
# (based on Doto, with an open "c"). icon-16/32 are drawn on the pixel grid by hand below.
# PNGs are rasterised from the icon-*.svg files at 1x.
import sys, os
from fontTools.ttLib import TTFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
ttf, out = sys.argv[1], sys.argv[2]
INK_DARK = "#181818"; INK_LIGHT = "#F2F2F2"
AMBER, BLUE, CORAL = "#FFB020", "#2F6BFF", "#FF5B4A"

def f(v): return f"{v:.2f}".rstrip("0").rstrip(".")

# ---- marks, in a 64-unit box ----
def mark_full(ink):
    return (f'<circle cx="28" cy="28" r="19" fill="none" stroke="{ink}" stroke-width="6.5"/>'
            f'<path d="M42 42L51 51" stroke="{ink}" stroke-width="7" stroke-linecap="round"/>'
            f'<path d="M28 21.5L21.5 33M28 21.5L34.5 33" fill="none" stroke="{ink}" stroke-width="2.4" stroke-linecap="round"/>'
            f'<circle cx="28" cy="21.5" r="4.2" fill="{AMBER}"/><circle cx="21.5" cy="33" r="4.2" fill="{BLUE}"/><circle cx="34.5" cy="33" r="4.2" fill="{CORAL}"/>')
def mark_small(ink):
    return (f'<circle cx="28" cy="28" r="19" fill="none" stroke="{ink}" stroke-width="8"/>'
            f'<path d="M42 42L51 51" stroke="{ink}" stroke-width="8.5" stroke-linecap="round"/>'
            f'<circle cx="28" cy="21" r="5.2" fill="{AMBER}"/><circle cx="21" cy="33" r="5.2" fill="{BLUE}"/><circle cx="35" cy="33" r="5.2" fill="{CORAL}"/>')
CENTER_FULL = (5.75 + 54.5) / 2      # bbox centre of ring + handle
CENTER_SMALL = (4 + 55.25) / 2

def placed(markfn, centre, ink, cx, cy, size):
    s = size / 64
    return f'<g transform="translate({f(cx - centre*s)} {f(cy - centre*s)}) scale({f(s)})">{markfn(ink)}</g>'

# ---- app icons: dark rounded tile, per-size tuning ----
# (canvas px, tile inset, corner radius, mark size, small cut?)
SPECS = {128: (16, 22, 78, False), 48: (2, 10, 35, False), 32: (1, 7.5, 25, True), 16: (0, 3.5, 14.5, True)}
for px, (inset, rx, msize, small) in SPECS.items():
    t = px - 2*inset; c = px / 2
    hair = (f'<rect x="{f(inset+.5)}" y="{f(inset+.5)}" width="{f(t-1)}" height="{f(t-1)}" rx="{f(rx-.5)}" fill="none" stroke="#FFFFFF" stroke-opacity=".12"/>'
            if px >= 32 else "")
    body = placed(mark_small if small else mark_full, CENTER_SMALL if small else CENTER_FULL, INK_LIGHT, c, c, msize)
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {px} {px}" width="{px}" height="{px}">'
           f'<rect x="{inset}" y="{inset}" width="{t}" height="{t}" rx="{rx}" fill="{INK_DARK}"/>{hair}{body}</svg>\n')
    open(os.path.join(out, f"icon-{px}.svg"), "w").write(svg)

# ---- standalone mark (no tile), currentColor ink ----
open(os.path.join(out, "mark.svg"), "w").write(
    f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="4 4 52 52" width="52" height="52">{mark_full("currentColor")}</svg>\n')

# ---- lockup: mark + "Leet" (Spline Sans Mono 600 outlines) + dotted "Scope" ----
# units: 1000 = 1em of the "Leet" type. Baseline at y = 0.
font = TTFont(ttf); gs = font.getGlyphSet(); cmap = font.getBestCmap()
EM = 1000; k = EM / font["head"].unitsPerEm
MARK = 1.5*EM; GAP = .26*EM; MARK_CY = -.325*EM            # matches the CSS lockup
x = MARK + GAP; leet = []
for ch in "Leet":
    g = cmap[ord(ch)]; pen = SVGPathPen(gs)
    gs[g].draw(TransformPen(pen, (k, 0, 0, -k, x, 0)))
    leet.append(pen.getCommands()); x += font["hmtx"][g][0]*k
x += .045*EM
G = {'S':[".###.","#...#","#....",".###.","....#","#...#",".###."],
     'c':[".....",".....",".###","#...","#...","#...",".###"],
     'o':[".....",".....",".###.","#...#","#...#","#...#",".###."],
     'p':[".....",".....","#.##.","##..#","#...#","##..#","#.##.","#....","#...."],
     'e':[".....",".....",".###.","#...#","#####","#....",".###."]}
u = 1.07*EM/1000; dot = 94; off = (100-dot)/2; dots = []
for ch in "Scope":
    rows = G[ch]; wc = 5 if ch != 'c' else 4
    for kk, row in enumerate(rows):
        r = 6 - kk
        for c, v in enumerate(row):
            if v == '#':
                dots.append(f'<rect x="{f(x+(c*100+off)*u)}" y="{f((-95-100*r+(90-dot)/2)*u)}" width="{f(dot*u)}" height="{f(dot*u)}" rx="{f(20*u)}"/>')
    x += (wc*100 + 100)*u
right = x - 100*u - (100-dot)/2*u
top = MARK_CY - MARK/2 + 5.75/64*MARK; bottom = max(MARK_CY + MARK/2 - (64-54.5)/64*MARK, 2*100*u)
left = 5.75/64*MARK
mark_g = f'<g transform="translate(0 {f(MARK_CY - MARK/2)}) scale({f(MARK/64)})">{mark_full("currentColor")}</g>'
vb = f"{f(left)} {f(top)} {f(right-left)} {f(bottom-top)}"
lock = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{vb}" width="{f((right-left)/10)}" height="{f((bottom-top)/10)}" role="img" aria-label="LeetScope">'
        f'{mark_g}<path fill="currentColor" d="{" ".join(leet)}"/><g fill="currentColor">{"".join(dots)}</g></svg>\n')
open(os.path.join(out, "logo.svg"), "w").write(lock)
print("viewBox", vb)

# ---- pixel-grid versions for the toolbar sizes (override the scaled ones) ----
HAND = {
16: (f'<rect width="16" height="16" rx="3.5" fill="{INK_DARK}"/>'
     f'<circle cx="7" cy="7" r="4.5" fill="none" stroke="{INK_LIGHT}" stroke-width="1.6"/>'
     f'<path d="M10.4 10.4L13 13" stroke="{INK_LIGHT}" stroke-width="2" stroke-linecap="round"/>'
     f'<rect x="6" y="4" width="2" height="2" rx=".5" fill="{AMBER}"/>'
     f'<rect x="4" y="7" width="2" height="2" rx=".5" fill="{BLUE}"/>'
     f'<rect x="8" y="7" width="2" height="2" rx=".5" fill="{CORAL}"/>'),
32: (f'<rect x="1" y="1" width="30" height="30" rx="7.5" fill="{INK_DARK}"/>'
     f'<rect x="1.5" y="1.5" width="29" height="29" rx="7" fill="none" stroke="#FFFFFF" stroke-opacity=".12"/>'
     f'<circle cx="15" cy="15" r="8.5" fill="none" stroke="{INK_LIGHT}" stroke-width="3"/>'
     f'<path d="M21.5 21.5L25.5 25.5" stroke="{INK_LIGHT}" stroke-width="3.5" stroke-linecap="round"/>'
     f'<rect x="13" y="9" width="4" height="4" rx="1.3" fill="{AMBER}"/>'
     f'<rect x="10" y="15" width="4" height="4" rx="1.3" fill="{BLUE}"/>'
     f'<rect x="16" y="15" width="4" height="4" rx="1.3" fill="{CORAL}"/>'),
}
for px, body in HAND.items():
    open(os.path.join(out, f"icon-{px}.svg"), "w").write(
        f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {px} {px}" width="{px}" height="{px}">{body}</svg>\n')
