// VisualLeet replacement for the small part of jsPlumb 1.3.10 that pytutor.ts uses.
//
// Why: profiling showed jsPlumb.connect + jsPlumb.reset taking 70-80% of each
// step (about 4 ms per arrow), because every connect() measures elements and
// creates its own canvas, forcing a layout per arrow. Here connect() only
// records the arrow; flush() reads every endpoint position in one pass, then
// writes all arrows into a single SVG overlay.
//
// API kept compatible with the calls pytutor.ts makes: connect, select(...).each /
// .detach, reset, repaintEverything, importDefaults, and connection fields
// sourceId, targetId, source, canvas, endpoints[i].elementId / setPaintStyle,
// setPaintStyle, setHover.

const SVG_NS = "http://www.w3.org/2000/svg";

type AnchorName = "RightMiddle" | "LeftMiddle" | "TopCenter" | "BottomCenter";

interface ArrowDefaults {
  Endpoint?: any[];
  EndpointStyles?: any[];
  EndpointHoverStyles?: any[];
  Anchors?: AnchorName[];
  PaintStyle?: { lineWidth?: number; strokeStyle?: string };
  HoverPaintStyle?: { lineWidth?: number; strokeStyle?: string };
  Connector?: any[];
  Overlays?: any[];
  Container?: any;
}

interface ConnectOptions {
  source: string;
  target: string;
  scope?: string;
  anchors?: AnchorName[];
  connector?: any[];
  endpoint?: any[];
}

class Endpoint {
  constructor(private conn: Connection, public elementId: string, private index: number) {}
  setPaintStyle(style: { fillStyle?: string }) {
    if (this.index === 0 && style && style.fillStyle !== undefined) {
      this.conn.endpointColor = style.fillStyle;
      this.conn.layer.markDirty();
    }
  }
  setVisible() {}
}

export class Connection {
  readonly endpoints: Endpoint[];
  readonly canvas: SVGGElement;
  strokeColor: string;
  endpointColor: string;
  lineWidth: number;
  hover = false;

  constructor(public layer: ArrowLayer, public sourceId: string, public targetId: string,
              public scope: string, public anchors: AnchorName[], public connector: any[],
              public endpointRadius: number) {
    this.endpoints = [new Endpoint(this, sourceId, 0), new Endpoint(this, targetId, 1)];
    this.canvas = document.createElementNS(SVG_NS, "g");
    const d = layer.defaults;
    this.strokeColor = d.PaintStyle?.strokeStyle ?? "#005583";
    this.lineWidth = d.PaintStyle?.lineWidth ?? 1;
    this.endpointColor = d.EndpointStyles?.[0]?.fillStyle ?? this.strokeColor;
  }

  // jQuery wrapper of the source element (pytutor calls c.source.closest(...)).
  get source() {
    return (globalThis as any).jQuery(document.getElementById(this.sourceId));
  }

  setPaintStyle(style: { lineWidth?: number; strokeStyle?: string }) {
    if (style.strokeStyle !== undefined) this.strokeColor = style.strokeStyle;
    if (style.lineWidth !== undefined) this.lineWidth = style.lineWidth;
    this.layer.markDirty();
  }

  setHover(on: boolean) {
    this.hover = on;
    this.layer.markDirty();
  }

  detach() {
    this.layer.remove(this);
  }
}

class Selection {
  constructor(private conns: Connection[]) {}
  get length() { return this.conns.length; }
  each(fn: (c: Connection) => void) { this.conns.forEach((c) => fn(c)); return this; }
  detach() { this.conns.forEach((c) => c.detach()); return this; }
  setHover(on: boolean) { this.conns.forEach((c) => c.setHover(on)); return this; }
}

interface Point { x: number; y: number; }

function anchorPoint(r: DOMRect, origin: DOMRect, a: AnchorName): Point {
  const left = r.left - origin.left, top = r.top - origin.top;
  switch (a) {
    case "LeftMiddle": return { x: left, y: top + r.height / 2 };
    case "TopCenter": return { x: left + r.width / 2, y: top };
    case "BottomCenter": return { x: left + r.width / 2, y: top + r.height };
    default: return { x: left + r.width, y: top + r.height / 2 };
  }
}

function anchorDir(a: AnchorName): Point {
  switch (a) {
    case "LeftMiddle": return { x: -1, y: 0 };
    case "TopCenter": return { x: 0, y: -1 };
    case "BottomCenter": return { x: 0, y: 1 };
    default: return { x: 1, y: 0 };
  }
}

const f = (n: number) => n.toFixed(1);

export class ArrowLayer {
  defaults: ArrowDefaults;
  private svg: SVGSVGElement;
  private container: HTMLElement;
  private conns: Connection[] = [];
  private dirty = false;
  private rafId = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(defaults: ArrowDefaults) {
    this.defaults = { ...defaults };
    const c = defaults.Container;
    this.container = c && c.jquery ? c[0] : c;
    this.svg = document.createElementNS(SVG_NS, "svg");
    this.svg.setAttribute("class", "vlArrowLayer");
    // Zero-size, overflow visible: arrows are positioned relative to this
    // element's own on-screen position at draw time. The container is made
    // its containing block (see attach), so the arrows then move and scroll
    // together with the elements they connect.
    this.svg.setAttribute("style",
      "position:absolute;left:0;top:0;width:1px;height:1px;overflow:visible;pointer-events:none;z-index:5");
  }

  // VisualLeet fix for arrows drifting off their objects. Arrows are drawn
  // once per step. Before, the SVG had no positioned ancestor, so it stayed
  // put when a scrolling ancestor scrolled or content above the visualizer
  // changed height, while the objects moved (measured: 113 px off after a
  // sideways scroll, 918 px in a stacked narrow layout). Now:
  //  - the container becomes the SVG's containing block, so arrows move and
  //    scroll with the objects (positioning a static table cell changes no
  //    layout; nothing else inside it is absolutely positioned);
  //  - arrows are redrawn when the container or one of its children changes
  //    size (window resize, print-output box resized, panel resized), which
  //    can move objects inside it.
  private attach() {
    const host = this.container;
    if (getComputedStyle(host).position === "static") host.style.position = "relative";
    host.appendChild(this.svg);
    if (!this.resizeObserver && typeof ResizeObserver === "function") {
      // Runs after layout, before paint: redraw in the same frame. Drawing
      // only rewrites the SVG, which has no size, so it can't re-trigger this.
      this.resizeObserver = new ResizeObserver(() => { if (this.conns.length) this.flush(); });
      this.resizeObserver.observe(host);
      for (const child of Array.from(host.children)) if (child !== this.svg) this.resizeObserver.observe(child);
    }
  }

  importDefaults(d: ArrowDefaults) {
    Object.assign(this.defaults, d);
    this.markDirty();
  }

  connect(o: ConnectOptions): Connection {
    const anchors = o.anchors ?? this.defaults.Anchors ?? ["RightMiddle", "LeftMiddle"];
    const connector = o.connector ?? this.defaults.Connector ?? ["StateMachine"];
    const ep = o.endpoint ?? this.defaults.Endpoint ?? ["Dot", { radius: 3 }];
    const conn = new Connection(this, o.source, o.target, o.scope ?? "", anchors, connector, ep?.[1]?.radius ?? 3);
    this.conns.push(conn);
    this.svg.appendChild(conn.canvas);
    this.markDirty();
    return conn;
  }

  select(filter: { scope?: string; source?: string; target?: string } = {}): Selection {
    return new Selection(this.conns.filter((c) =>
      (filter.scope === undefined || c.scope === filter.scope) &&
      (filter.source === undefined || c.sourceId === filter.source) &&
      (filter.target === undefined || c.targetId === filter.target)));
  }

  remove(conn: Connection) {
    const i = this.conns.indexOf(conn);
    if (i >= 0) this.conns.splice(i, 1);
    conn.canvas.remove();
  }

  reset() {
    for (const c of this.conns) c.canvas.remove();
    this.conns = [];
    this.dirty = false;
  }

  repaintEverything() { this.flush(); }

  markDirty() {
    this.dirty = true;
    if (!this.rafId && typeof requestAnimationFrame === "function") {
      this.rafId = requestAnimationFrame(() => { this.rafId = 0; if (this.dirty) this.flush(); });
    }
  }

  /** Draw all arrows now: one pass of layout reads, then DOM writes only. */
  flush() {
    this.dirty = false;
    if (!this.container) return;
    if (this.svg.parentNode !== this.container) this.attach();

    // ---- read phase (one layout) ----
    const origin = this.svg.getBoundingClientRect();
    const geo = this.conns.map((c) => {
      const s = document.getElementById(c.sourceId);
      const t = document.getElementById(c.targetId);
      if (!s || !t || !s.isConnected || !t.isConnected) return null;
      const sr = s.getBoundingClientRect(), tr = t.getBoundingClientRect();
      // hidden elements (display:none) have empty rects: skip like jsPlumb would show nothing useful
      if ((sr.width === 0 && sr.height === 0) || (tr.width === 0 && tr.height === 0)) return null;
      return { s: anchorPoint(sr, origin, c.anchors[0]), t: anchorPoint(tr, origin, c.anchors[1]) };
    });

    // ---- write phase ----
    const hoverColor = this.defaults.HoverPaintStyle?.strokeStyle ?? "#e93f34";
    const overlay = (this.defaults.Overlays?.[0]?.[1]) ?? { length: 10, width: 7, foldback: 0.55 };
    const order: { c: Connection; z: number }[] = [];
    this.conns.forEach((c, i) => {
      const g = geo[i];
      order.push({ c, z: Number(c.canvas.style.zIndex) || 0 });
      if (!g) { c.canvas.replaceChildren(); return; }
      const color = c.hover ? hoverColor : c.strokeColor;
      const dotColor = c.hover ? hoverColor : c.endpointColor;
      c.canvas.innerHTML = this.drawConnection(c, g.s, g.t, color, dotColor, overlay);
    });
    // emulate z-index: draw higher z (highlighted) arrows last, i.e. on top
    if (order.some((o) => o.z !== 0)) {
      order.sort((a, b) => a.z - b.z).forEach((o) => this.svg.appendChild(o.c.canvas));
    }
  }

  private drawConnection(c: Connection, s: Point, t: Point, color: string, dotColor: string,
                         overlay: { length?: number; width?: number; foldback?: number }): string {
    const kind = c.connector?.[0] ?? "StateMachine";
    const opts = c.connector?.[1] ?? {};
    let d: string;
    let tangentFrom: Point; // point the arrowhead direction is measured from
    if (kind === "Straight") {
      d = `M${f(s.x)},${f(s.y)}L${f(t.x)},${f(t.y)}`;
      tangentFrom = s;
    } else if (kind === "Bezier") {
      const k = Number(opts.curviness ?? 150);
      const ds = anchorDir(c.anchors[0]), dt = anchorDir(c.anchors[1]);
      const c1 = { x: s.x + ds.x * k, y: s.y + ds.y * k };
      const c2 = { x: t.x + dt.x * k, y: t.y + dt.y * k };
      d = `M${f(s.x)},${f(s.y)}C${f(c1.x)},${f(c1.y)} ${f(c2.x)},${f(c2.y)} ${f(t.x)},${f(t.y)}`;
      tangentFrom = c2;
    } else if (kind === "Flowchart") {
      const mx = (s.x + t.x) / 2;
      d = `M${f(s.x)},${f(s.y)}L${f(mx)},${f(s.y)}L${f(mx)},${f(t.y)}L${f(t.x)},${f(t.y)}`;
      tangentFrom = { x: mx, y: t.y };
    } else {
      // StateMachine, ported from jsPlumb 1.3.10 as Python Tutor called it
      // (anchor orientation not passed, so only the quadrant rule applies):
      // within proximityLimit (80px) the control point is the midpoint;
      // otherwise the midpoint shifted by `curviness` (10px) depending on
      // which quadrant the target lies in. Drawn as a cubic with both control
      // points at that spot, exactly like jsPlumb's bezierCurveTo(p, p, end).
      const k = Number(opts.curviness ?? 10);
      const mx = (s.x + t.x) / 2, my = (s.y + t.y) / 2;
      let cp = { x: mx, y: my };
      if (Math.hypot(t.x - s.x, t.y - s.y) > 80) {
        const quadrant = (s.x <= t.x && t.y <= s.y) ? 1 : (s.x <= t.x && s.y <= t.y) ? 2
          : (t.x <= s.x && t.y >= s.y) ? 3 : 4;
        cp = (quadrant === 2 || quadrant === 4) ? { x: mx + k, y: my - k } : { x: mx - k, y: my - k };
      }
      d = `M${f(s.x)},${f(s.y)}C${f(cp.x)},${f(cp.y)} ${f(cp.x)},${f(cp.y)} ${f(t.x)},${f(t.y)}`;
      tangentFrom = cp;
    }

    // arrowhead at the target (jsPlumb "Arrow" overlay at location 1)
    const L = Number(overlay.length ?? 10), W = Number(overlay.width ?? 7), fb = Number(overlay.foldback ?? 0.55);
    let ux = t.x - tangentFrom.x, uy = t.y - tangentFrom.y;
    const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
    const bx = t.x - ux * L, by = t.y - uy * L;
    const px = -uy * (W / 2), py = ux * (W / 2);
    const fx = t.x - ux * L * fb, fy = t.y - uy * L * fb;
    const head = `${f(t.x)},${f(t.y)} ${f(bx + px)},${f(by + py)} ${f(fx)},${f(fy)} ${f(bx - px)},${f(by - py)}`;

    return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${c.lineWidth}"/>` +
      `<polygon points="${head}" fill="${color}" stroke="${color}" stroke-width="${c.lineWidth}"/>` +
      `<circle cx="${f(s.x)}" cy="${f(s.y)}" r="${c.endpointRadius}" fill="${dotColor}"/>`;
  }

  destroy() {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.reset();
    this.svg.remove();
  }
}
