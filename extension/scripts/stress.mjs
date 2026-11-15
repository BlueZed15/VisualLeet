// Stress and performance test for weaker machines.
// Loads dist/extension-test in headless Chrome and runs heavy-but-valid
// programs with the CPU slowed down (Chrome's CPU throttling, applied to the
// page and to every Python worker), measuring time and memory.
//
//   npm run build:extension-test
//   node scripts/stress.mjs [--rates 1,4,6] [--chrome <path>] [--out <dir>]
//
// Rate 4 is roughly an older dual-core laptop CPU next to a current high-end
// one; rate 6 a weak one. Chrome does not throttle the Python worker, so
// "estimatedMs" scales its measured time by the rate. Memory is the sum of the working sets of this
// Chrome's processes (Windows only; elsewhere it is left out).
import puppeteer from "puppeteer-core";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const chromePath = arg("--chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const outDir = path.resolve(arg("--out", path.join(root, "acceptance")));
const rates = arg("--rates", "1,4,6").split(",").map(Number);

// Heavy but valid programs, the kind a LeetCode solution can produce.
const PROGRAMS = {
  "typical (two sum)": `def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums):
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i
print(two_sum([2, 7, 11, 15, 3, 8, 1, 9, 4, 6] * 3, 100))`,
  "step limit, growing list": `a = []
for i in range(2000):
    a.append(i)
print(len(a))`,
  "step limit, growing dict": `d = {}
for i in range(2000):
    d[str(i)] = [i, i * i]
print(len(d))`,
  "recursion (fib 14)": `def fib(n):
    if n < 2:
        return n
    return fib(n - 1) + fib(n - 2)
print(fib(14))`,
  "BFS on a 15x15 grid": `from collections import deque
grid = [[(r * 7 + c * 3) % 5 != 0 for c in range(15)] for r in range(15)]
def bfs(grid):
    seen = {(0, 0)}
    q = deque([(0, 0)])
    while q:
        r, c = q.popleft()
        for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            nr, nc = r + dr, c + dc
            if 0 <= nr < 15 and 0 <= nc < 15 and grid[nr][nc] and (nr, nc) not in seen:
                seen.add((nr, nc))
                q.append((nr, nc))
    return len(seen)
print(bfs(grid))`,
  "tree of 127 nodes, DFS": `class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val, self.left, self.right = val, left, right
def build(lo, hi):
    if lo > hi:
        return None
    mid = (lo + hi) // 2
    return TreeNode(mid, build(lo, mid - 1), build(mid + 1, hi))
def depth(node):
    return 0 if node is None else 1 + max(depth(node.left), depth(node.right))
root = build(1, 127)
print(depth(root))`,
  "big input (2,000-item list)": `nums = list(range(2000))
best = 0
for i in range(0, len(nums), 20):
    best = max(best, nums[i])
print(best)`,
};

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const memoryMb = (profile) => {
  if (process.platform !== "win32") return null;
  try {
    const ps = `(Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object { $_.CommandLine -like '*${path.basename(profile)}*' } | Measure-Object -Property WorkingSetSize -Sum).Sum`;
    return Math.round(Number(execFileSync("powershell", ["-NoProfile", "-Command", ps], { encoding: "utf8" }).trim()) / 1048576);
  } catch { return null; }
};

const results = { environment: { cpu: os.cpus()[0].model, cores: os.cpus().length, ramGb: Math.round(os.totalmem() / 2 ** 30), date: new Date().toISOString() }, rates: {} };

for (const rate of rates) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "visualleet-stress-"));
  const browser = await puppeteer.launch({ executablePath: chromePath, headless: true, pipe: true, enableExtensions: true, userDataDir: profile, defaultViewport: { width: 1366, height: 768 } });
  const out = { programs: {}, failures: [] };
  try {
    const id = await browser.installExtension(path.join(root, "dist", "extension-test"));
    const page = await browser.newPage();
    page.on("pageerror", (e) => out.failures.push("pageerror: " + e.message));
    // throttle every Python worker as it starts (runs swap in a fresh interpreter)
    page.on("workercreated", (w) => { if (rate !== 1) w.client.send("Emulation.setCPUThrottlingRate", { rate }).catch(() => {}); });
    if (rate !== 1) await (await page.createCDPSession()).send("Emulation.setCPUThrottlingRate", { rate });
    const ui = `chrome-extension://${id}/ui/index.html`;
    const ev = (fn, ...a) => page.evaluate(fn, ...a);

    let t0 = Date.now();
    await page.goto(ui);
    await ev(() => visualleet.whenReady());
    out.coldStartMs = Date.now() - t0;
    out.memoryIdleMb = memoryMb(profile);

    let peak = out.memoryIdleMb || 0;
    for (const [name, src] of Object.entries(PROGRAMS)) {
      const runs = [];
      for (let i = 0; i < 3; i++) {
        t0 = Date.now();
        const r = await ev(async (s) => { await visualleet.whenReady(); const r = await visualleet.run(s); return { status: visualleet.status(), steps: (visualleet.lastTrace() || { trace: [] }).trace.length, metrics: r && r.metrics, message: visualleet.message() }; }, src);
        r.wallMs = Date.now() - t0;
        runs.push(r);
        if (r.status !== "complete" && r.status !== "limit reached") out.failures.push(`${name}: ${r.status} (${r.message})`);
        peak = Math.max(peak, memoryMb(profile) || 0);
      }
      const m = (k) => +median(runs.map((r) => (r.metrics ? r.metrics[k] : NaN))).toFixed(0);
      // Chrome doesn't throttle the Python worker, so its time is scaled by the rate for the estimate
      const wallMs = median(runs.map((r) => r.wallMs));
      out.programs[name] = { status: runs[0].status, steps: runs[0].steps, wallMs, worstWallMs: Math.max(...runs.map((r) => r.wallMs)), execMs: m("execMs"), renderMs: m("renderMs"), estimatedMs: Math.round(wallMs + (m("execMs") || 0) * (rate - 1)) };
    }

    // stepping through a full step-limit trace
    await ev((s) => visualleet.run(s), PROGRAMS["step limit, growing list"]);
    out.stepNavigation = await ev(() => {
      if (!document.querySelector("#viz button")) return { error: visualleet.status() + ": " + visualleet.message() };
      const btn = (re) => [...document.querySelectorAll("#viz button")].find((b) => re.test(b.textContent));
      btn(/First/).click();
      const ts = [];
      for (let i = 0; i < 60; i++) { const t = performance.now(); btn(/Next/).click(); document.body.offsetHeight; ts.push(performance.now() - t); }
      let t = performance.now(); btn(/Last/).click(); document.body.offsetHeight; const lastMs = performance.now() - t;
      ts.sort((a, b) => a - b);
      return { medianMs: +ts[ts.length >> 1].toFixed(1), worstMs: +ts[ts.length - 1].toFixed(1), jumpToLastMs: +lastMs.toFixed(1) };
    });

    // one step that never finishes: the 10 s watchdog, then how soon the next run can start
    t0 = Date.now();
    const loop = await ev(async () => { await visualleet.run("x = sum(range(10 ** 11))"); return visualleet.status(); });
    out.endlessLoop = { status: loop, stoppedAfterMs: Date.now() - t0 };
    t0 = Date.now();
    await ev(() => visualleet.whenReady());
    out.endlessLoop.readyAgainMs = Date.now() - t0;

    // three visualizer tabs open at once
    const extra = [];
    for (let i = 0; i < 2; i++) { const p = await browser.newPage(); await p.goto(ui); await p.evaluate(() => visualleet.whenReady()); extra.push(p); }
    out.memoryThreeTabsMb = memoryMb(profile);
    for (const p of extra) await p.close();
    out.memoryPeakMb = Math.max(peak, out.memoryThreeTabsMb || 0);
  } finally {
    await browser.close();
    await rm(profile, { recursive: true, force: true }).catch(() => {});
  }
  results.rates[rate] = out;
  console.log(`\n=== CPU ${rate}x slower ===`);
  console.log(`cold start ${out.coldStartMs} ms; memory idle ${out.memoryIdleMb} MB, peak ${out.memoryPeakMb} MB, 3 tabs ${out.memoryThreeTabsMb} MB`);
  console.table(out.programs);
  console.log("step navigation", out.stepNavigation, "\nendless loop", out.endlessLoop);
  if (out.failures.length) console.log("FAILURES:\n  " + out.failures.join("\n  "));
}

await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "stress-results.json"), JSON.stringify(results, null, 2));
