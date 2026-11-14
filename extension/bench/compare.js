// Steps the original renderer (A) and the VisualLeet fork (B) through the same
// trace and compares, at every step: arrow endpoints, nudge margins of heap
// objects, and the visible text of frames and objects. Collections longer than
// the collapse threshold are expected to differ in text (B collapses them).

function frameReady(f) {
  return new Promise((res) => {
    const check = () => (f.contentWindow && f.contentWindow.renderBench ? res(f.contentWindow) : setTimeout(check, 50));
    check();
  });
}

function arrows(win) {
  const out = [];
  win.getCurrent().viz.dataViz.jsPlumbInstance.select().each((c) => out.push(c.sourceId + "->" + c.targetId));
  return out.sort();
}

function margins(win) {
  const m = {};
  win.document.querySelectorAll("#visualizerDiv .heapObject").forEach((e) => {
    m[e.id] = parseFloat(win.getComputedStyle(e).marginLeft) || 0;
  });
  return m;
}

function text(win, sel) {
  const el = win.document.querySelector("#visualizerDiv " + sel);
  return el ? el.innerText.replace(/\s+/g, " ").trim() : "";
}

async function compareTrace(A, B, name, opts = {}) {
  const trace = await A.loadTrace(name);
  A.renderBench(trace);
  B.renderBench(JSON.parse(JSON.stringify(trace)));
  const n = trace.trace.length;
  const issues = [];
  // opts.sample: compare every k-th step plus the last `tail` steps, jumping
  // with renderStep (used for traces that are slow on the original renderer)
  let steps = [...Array(n).keys()];
  if (opts.sample) {
    const { every, tail } = opts.sample;
    steps = steps.filter((i) => i % every === 0 || i >= n - tail);
  }
  for (const i of steps) {
    if (opts.sample) { A.getCurrent().viz.renderStep(i); B.getCurrent().viz.renderStep(i); }
    else if (i > 0) { A.getCurrent().viz.stepForward(); B.getCurrent().viz.stepForward(); }
    const a = arrows(A), b = arrows(B);
    if (a.join() !== b.join()) issues.push(`step ${i}: arrows differ\n   A=${a}\n   B=${b}`);
    const ma = margins(A), mb = margins(B);
    for (const id of new Set([...Object.keys(ma), ...Object.keys(mb)])) {
      if (!(id in ma) || !(id in mb)) { if (!opts.collapsed) issues.push(`step ${i}: heap object ${id} only in ${id in ma ? "A" : "B"}`); continue; }
      // 0.1px: the original re-reads the computed margin (serialized to 6 significant
      // digits) on every "+=" nudge; the fork adds the same shifts exactly.

      if (Math.abs(ma[id] - mb[id]) > 0.1) issues.push(`step ${i}: margin-left of ${id} A=${ma[id]} B=${mb[id]}`);
    }
    if (!opts.collapsed) {
      for (const sel of ["#stack_td", "#heap"]) {
        const ta = text(A, sel), tb = text(B, sel);
        if (ta !== tb) issues.push(`step ${i}: ${sel} text differs\n   A=${ta.slice(0, 200)}\n   B=${tb.slice(0, 200)}`);
      }
    }
    if (issues.length > 5) break;
  }
  return `${name.padEnd(22)} ${opts.sample ? steps.length + " of " : ""}${n} steps: ${issues.length ? "DIFFERENT\n  " + issues.join("\n  ") : "identical"}`;
}

const COMPARE = [
  ["bfs"], ["sliding"], ["lcs_dp"], ["fib_recursion"], ["tree_inorder"], ["nested_lists"],
  ["alias_cycle"], ["reverse_linked_list_3"], ["small_list_200"],
  ["linked_list_40", { sample: { every: 10, tail: 30 } }],
  ["big_dict_set", { collapsed: true }],
  ["big_list_200", { collapsed: true, sample: { every: 40, tail: 5 } }],
];

window.runCompare = async function (only) {
  const A = await frameReady(document.getElementById("A"));
  const B = await frameReady(document.getElementById("B"));
  const results = [];
  for (const [name, opts] of COMPARE) {
    if (only && !only.includes(name)) continue;
    results.push(await compareTrace(A, B, name, opts));
    document.getElementById("out").textContent = results.join("\n");
  }
  results.push(`fast nudge used ${B.vlFastNudgeStats.fast}x, fell back ${B.vlFastNudgeStats.fallbacks}x`);
  document.getElementById("out").textContent = results.join("\n");
  return results.join("\n");
};
