// Automated feasibility check for the MV3 spike.
// Loads dist/extension into the installed Chrome (fresh temporary profile,
// headless), then answers the spike questions with real runs.
//
//   npm run build:extension
//   node scripts/spike-check.mjs [--headed] [--chrome <path>] [--out <dir>]
//
// Writes spike-results.json and a screenshot to --out (default: spike/).
import puppeteer from "puppeteer-core";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const chromePath = arg("--chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const outDir = path.resolve(arg("--out", path.join(root, "spike")));
const headed = process.argv.includes("--headed");

const BFS = `def bfs(graph, start):
    queue = [start]
    seen = {start}
    order = []
    head = 0
    while head < len(queue):
        node = queue[head]
        head += 1
        order.append(node)
        for neighbor in graph[node]:
            if neighbor not in seen:
                seen.add(neighbor)
                queue.append(neighbor)
    return order

graph = {
    "A": ["B", "C"],
    "B": ["A", "D"],
    "C": ["A", "D"],
    "D": ["B", "C"]
}
print(bfs(graph, "A"))
`;
const SLIDING = `def longest_unique_substring(s):
    seen = set()
    left = 0
    best = 0
    for right in range(len(s)):
        while s[right] in seen:
            seen.remove(s[left])
            left += 1
        seen.add(s[right])
        window = s[left:right + 1]
        best = max(best, right - left + 1)
    return best

print(longest_unique_substring("abcabcbb"))
`;
const FACT = `def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)

print(fact(5))
`;
const STDLIB = `from collections import Counter, deque
import heapq, bisect
from functools import lru_cache
c = Counter("abracadabra")
q = deque([1, 2, 3])
q.appendleft(0)
h = [5, 1, 4]
heapq.heapify(h)
smallest = heapq.heappop(h)
arr = [1, 3, 5]
bisect.insort(arr, 4)
@lru_cache(maxsize=None)
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
print(c.most_common(1), list(q), smallest, arr, fib(10))
`;
const INFINITE = "i = 0\nwhile True:\n    i += 1\n";
const BUSY = "total = sum(range(10**12))\nprint(total)\n";
const HTML_OUT = 'print("<img src=x onerror=alert(1)><b>not bold</b>")\ns = "<script>alert(2)</script>"\n';

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const results = { environment: {}, checks: [], timings: {} };
const check = (name, pass, detail) => { results.checks.push({ name, pass: !!pass, detail }); console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`); };

const profile = await mkdtemp(path.join(os.tmpdir(), "visualleet-spike-"));
const browser = await puppeteer.launch({
  executablePath: chromePath, headless: !headed, pipe: true, enableExtensions: true, userDataDir: profile,
  defaultViewport: { width: 1400, height: 900 },
});
const offExtensionRequests = [];
try {
  results.environment = { chrome: await browser.version(), headless: !headed, platform: `${os.type()} ${os.release()}`, cpu: os.cpus()[0].model, date: new Date().toISOString() };
  const id = await browser.installExtension(path.join(root, "dist", "extension"));
  const page = await browser.newPage();
  const dialogs = [];
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  // Record every network request the page or its frames/workers make outside the extension.
  const cdp = await page.createCDPSession();
  await cdp.send("Network.enable");
  cdp.on("Network.requestWillBeSent", (e) => { if (!e.request.url.startsWith("chrome-extension://") && !e.request.url.startsWith("blob:") && !e.request.url.startsWith("data:")) offExtensionRequests.push(e.request.url); });
  const ui = `chrome-extension://${id}/ui/index.html`;

  // 1-2. Packaged Pyodide loads in the sandboxed worker (cold start)
  let t0 = Date.now();
  await page.goto(ui);
  const info = await page.evaluate(() => visualleet.whenReady());
  results.timings.coldInitMs = Date.now() - t0;
  results.environment.pyodide = info.pyodide;
  results.environment.python = info.python;
  check("Packaged Pyodide starts inside the sandboxed worker", info && info.python, `Python ${info.python}, Pyodide ${info.pyodide}, page load → ready ${results.timings.coldInitMs} ms (worker: ${info.timings.total.toFixed(0)} ms)`);

  // 3. Tracer produces correct traces
  // waits for the runtime first (it restarts itself after a stop or timeout)
  const run = (src) => page.evaluate(async (s) => { await visualleet.whenReady(); return visualleet.run(s); }, src);
  const bfs = await run(BFS);
  check("BFS traces and prints A,B,C,D", bfs.status === "complete" && bfs.stdout === "['A', 'B', 'C', 'D']\n", { status: bfs.status, steps: bfs.steps, stdout: bfs.stdout });
  const sl = await run(SLIDING);
  check("Sliding window prints 3", sl.status === "complete" && sl.stdout === "3\n", { steps: sl.steps, stdout: sl.stdout });
  const fact = await run(FACT);
  check("Recursive factorial prints 120", fact.status === "complete" && fact.stdout === "120\n", { steps: fact.steps });
  const std = await run(STDLIB);
  check("collections/heapq/bisect/functools work under the tracer", std.status === "complete" && /\[\('a', 5\)\] \[0, 1, 2, 3\] 1 \[1, 3, 4, 5\] 55/.test(std.stdout || ""), { stdout: std.stdout, exception: std.exception });
  const err = await run("x = [1, 2]\nprint(x[5])\n");
  check("Runtime error is reported with its message", /IndexError/.test(err.exception || ""), { exception: err.exception });
  const syn = await run("def f(:\n  pass\n");
  check("Syntax error is reported", /SyntaxError/.test(syn.exception || ""), { exception: syn.exception });
  const sep1 = await run("leftover = 42\n");
  const sep2 = await run("print('leftover' in globals())\n");
  check("Run A then run B: no globals carried over", sep1.status === "complete" && sep2.stdout === "False\n", { stdout: sep2.stdout });

  // 4. Real visualizer renders the trace, with navigation
  await run(BFS);
  const vis = await page.evaluate(() => {
    const viz = document.getElementById("viz");
    const codeRows = viz.querySelectorAll("#pyCodeOutput tr").length;
    const next = [...viz.querySelectorAll("button")].find((b) => /Next/.test(b.textContent));
    for (let i = 0; i < 20; i++) next && next.click();
    const stepText = (viz.textContent.match(/Step \d+ of \d+/) || [""])[0];
    return { codeRows, stepText, frames: viz.querySelectorAll(".stackFrame").length, heapObjects: viz.querySelectorAll(".heapObject").length, arrows: viz.querySelectorAll(".vlArrowLayer path").length };
  });
  check("Visualizer shows code, frames, objects and arrows; Next steps through history", vis.codeRows > 10 && vis.heapObjects > 0 && vis.arrows > 0 && vis.stepText === "Step 21 of 57", vis);
  await mkdir(outDir, { recursive: true });
  await new Promise((r) => setTimeout(r, 1000));   // let the line-arrow animations finish
  const gutter = await page.evaluate(() => {
    const cur = document.querySelector("#viz #curLineArrow");
    const prev = document.querySelector("#viz #prevLineArrow");
    const vis = (el) => !!el && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 0;
    return { curVisible: vis(cur), prevVisible: vis(prev), curTransform: cur && cur.getAttribute("transform") };
  });
  check("Code panel marks the current and previous line", gutter.curVisible && gutter.prevVisible, gutter);
  await page.screenshot({ path: path.join(outDir, "bfs-step-21.png") });

  const html = await run(HTML_OUT);
  const injected = await page.evaluate(() => document.querySelectorAll("#viz img, #viz script, #viz b").length);
  check("HTML in user output renders as text (no elements, no script)", html.status === "complete" && injected === 0 && dialogs.length === 0, { injectedElements: injected, dialogs });

  // 5. Limits, timeout, stop, recovery
  const inf = await run(INFINITE);
  check("Infinite loop stops at the step limit and is labeled incomplete", inf.status === "limit reached", { status: inf.status, steps: inf.steps });

  t0 = Date.now();
  const busy = await run(BUSY);
  const timeoutMs = Date.now() - t0;
  t0 = Date.now();
  await page.evaluate(() => visualleet.whenReady());
  const recoveryMs = Date.now() - t0;
  const after = await run(BFS);
  check("Native busy loop (few trace events) is killed by the 5 s watchdog; next run works", busy.status === "timed out" && after.status === "complete", { status: busy.status, killedAfterMs: timeoutMs, rebuildMs: recoveryMs });
  results.timings.watchdogKillMs = timeoutMs;
  results.timings.restartAfterKillMs = recoveryMs;

  const stopResult = await page.evaluate(async (src) => {
    const p = visualleet.run(src);
    await new Promise((r) => setTimeout(r, 1000));
    const t = performance.now();
    visualleet.stop();
    const res = await p;
    return { res, stopToStoppedMs: performance.now() - t };
  }, BUSY);
  await page.evaluate(() => visualleet.whenReady());
  const afterStop = await run(FACT);
  check("Stop terminates a running job quickly; next run works", stopResult.res.status === "stopped" && afterStop.status === "complete" && stopResult.stopToStoppedMs < 500, { stopToStoppedMs: Math.round(stopResult.stopToStoppedMs), next: afterStop.status });
  results.timings.stopToStoppedMs = Math.round(stopResult.stopToStoppedMs);

  // stale result: a run that finishes after being stopped must not appear
  const stale = await page.evaluate(async (src) => {
    const p1 = visualleet.run(src);              // slow-ish run
    visualleet.stop();                           // discard it immediately
    const r1 = await p1;
    await visualleet.whenReady();
    const r2 = await visualleet.run("print('second')\n");
    return { r1: r1.status, r2: r2.status, r2out: r2.stdout };
  }, SLIDING);
  check("Stopped run cannot overwrite the next run's result", stale.r1 === "stopped" && stale.r2out === "second\n", stale);

  // 6. Isolation
  const probe = await page.evaluate(() => visualleet.probe());
  const r = probe.report || {};
  const networkBlocked = ["sync XHR to example.com", "original fetch to example.com", "importScripts from example.com"].every((k) => /blocked/.test(r[k] || "")) &&
    !/opened/.test(r["WebSocket to example.com"] || "opened") &&
    /connect-src/.test(r["CSP violations reported in worker"] || "");
  check("Python's JS bridge has no extension APIs", r["typeof chrome"] === "undefined" && r["typeof document"] === "undefined", { "typeof chrome": r["typeof chrome"], "chrome.runtime.id": r["chrome.runtime.id"], "typeof document": r["typeof document"], origin: r["self.origin"] });
  check("Python's JS bridge cannot reach the network", networkBlocked, r);
  const stats = await page.evaluate(() => visualleet.sandboxStats());
  check("Sandbox drops forged/unknown runner messages", stats.dropped >= 3, stats);
  const imp = await run("import js\nprint(js)\n");
  check("Tracer's import guard also refuses `import js` in user code", /ImportError|not supported|cannot import/i.test(imp.exception || "") || imp.status === "failed", { exception: imp.exception });
  // (CDP on the page sees the UI page and the same-process sandbox frame; the
  // worker's own attempts are covered by the probe's CSP violation reports.)
  check("No network requests from the UI page or sandbox frame during the session", offExtensionRequests.length === 0, offExtensionRequests.slice(0, 5));

  // Offline
  await page.setOfflineMode(true);
  t0 = Date.now();
  await page.reload();
  await page.evaluate(() => visualleet.whenReady());
  const offline = await run(BFS);
  check("Works with the network disabled", offline.status === "complete" && offline.stdout === "['A', 'B', 'C', 'D']\n", { initMs: Date.now() - t0 });
  await page.setOfflineMode(false);

  // Timings: warm runs
  for (const [name, src] of [["bfs", BFS], ["sliding", SLIDING]]) {
    const runs = [];
    for (let i = 0; i < 7; i++) runs.push((await run(src)).metrics);
    const pick = (k) => runs.map((m) => m[k]);
    results.timings[name] = Object.fromEntries(["execMs", "transferMs", "parseMs", "renderMs", "firstViewMs"].map((k) => [k, { median: +median(pick(k)).toFixed(1), worst: +Math.max(...pick(k)).toFixed(1) }]));
    results.timings[name].steps = runs[0].steps;
    results.timings[name].traceKiB = +(runs[0].bytes / 1024).toFixed(0);
  }
  // Step navigation in the extension page
  results.timings.stepNavigation = await page.evaluate(() => {
    const viz = document.getElementById("viz");
    const next = [...viz.querySelectorAll("button")].find((b) => /Next/.test(b.textContent));
    const first = [...viz.querySelectorAll("button")].find((b) => /First/.test(b.textContent));
    first.click();
    const ts = [];
    for (let i = 0; i < 40; i++) { const t = performance.now(); next.click(); document.body.offsetHeight; ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b);
    return { medianMs: +ts[ts.length >> 1].toFixed(1), worstMs: +ts[ts.length - 1].toFixed(1) };
  });
  // Second cold start in the same browser (Chrome may cache compiled wasm)
  t0 = Date.now();
  await page.reload();
  await page.evaluate(() => visualleet.whenReady());
  results.timings.secondPageLoadInitMs = Date.now() - t0;
} finally {
  await browser.close();
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

results.passed = results.checks.filter((c) => c.pass).length;
results.total = results.checks.length;
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "spike-results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.passed}/${results.total} checks passed`);
console.log(JSON.stringify(results.timings, null, 2));
process.exitCode = results.passed === results.total ? 0 : 1;
