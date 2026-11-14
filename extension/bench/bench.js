// Renderer benchmark: same method as the baseline measurements.
// Each step is timed including a forced layout (document.body.offsetHeight).
let current = null;

async function load(name) {
  return JSON.parse(await (await fetch("traces/" + name + ".json")).text());
}

function render(trace) {
  if (current) current.destroy();
  const t0 = performance.now();
  current = VisualLeetRenderer.renderTrace("visualizerDiv", trace, {});
  document.body.offsetHeight;
  return performance.now() - t0;
}

function stats(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return { median: s[s.length >> 1], max: s[s.length - 1], n: s.length };
}

// Step forward `count` times starting at step `from`.
async function bench(name, from = 0, count = 60) {
  const trace = await load(name);
  const construct = render(trace);
  const v = current.viz;
  if (from) { v.renderStep(from); document.body.offsetHeight; }
  const times = [];
  for (let i = 0; i < count && from + i + 1 < trace.trace.length; i++) {
    const s = performance.now(); v.stepForward(); document.body.offsetHeight; times.push(performance.now() - s);
  }
  const st = stats(times);
  return `${name.padEnd(22)} steps=${String(trace.trace.length).padStart(4)} construct=${construct.toFixed(0).padStart(4)}ms  from ${String(from).padStart(3)}: median=${st.median.toFixed(1).padStart(6)}ms max=${st.max.toFixed(0).padStart(5)}ms (n=${st.n})  DOM=${document.getElementsByTagName("*").length}`;
}

const SUITE = [
  ["bfs", 0, 60], ["sliding", 0, 70], ["small_list_200", 0, 120], ["lcs_dp", 0, 120],
  ["fib_recursion", 0, 60], ["linked_list_40", 410, 20], ["big_list_200", 0, 15],
  ["stress_1000_list100", 0, 30], ["stress_1000_list100", 960, 30],
];

async function runSuite() {
  const out = [];
  for (const [n, f, c] of SUITE) { out.push(await bench(n, f, c)); document.getElementById("results").textContent = out.join("\n"); }
  return out.join("\n");
}

window.bench = bench;
window.runSuite = runSuite;
window.loadTrace = load;
window.renderBench = render;
window.getCurrent = () => current;
