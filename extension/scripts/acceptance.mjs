// Acceptance checks for the VisualLeet extension (spec section 15).
// Loads dist/extension-test into the installed Chrome (fresh temp profile,
// headless by default) and drives the real UI through its test hooks.
//
//   npm run build:extension-test
//   node scripts/acceptance.mjs [--headed] [--chrome <path>] [--out <dir>]
//
// The test build is the real extension plus host access to 127.0.0.1 and
// leetcode.com, which this script maps to a local fixture server, because
// automation can't click the toolbar button to grant activeTab.
import puppeteer from "puppeteer-core";
import http from "node:http";
import https from "node:https";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const chromePath = arg("--chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const outDir = path.resolve(arg("--out", path.join(root, "acceptance")));
const headed = process.argv.includes("--headed");

// ---------- fixture pages ----------
const LONG_SOLUTION = ["class Solution:", "    def twoSum(self, nums: List[int], target: int) -> List[int]:", "        seen = {}"]
  .concat(Array.from({ length: 70 }, (_, i) => `        # filler line ${i + 1} so the editor has lines out of view`))
  .concat(["        for i, n in enumerate(nums):", "            if target - n in seen:", "                return [seen[target - n], i]", "            seen[n] = i"]).join("\n");

function fakeLeetCode(language, code) {
  // Mimics what the live site exposes (checked on leetcode.com, 2026-11-14):
  // window.monaco with a code model and a plaintext test-case model; the
  // editor only renders a few visible lines.
  return `<!doctype html><html><head><title>Two Sum - LeetCode</title></head><body>
<div class="text-title-large"><a href="/problems/two-sum/">1. Two Sum</a></div>
<div data-track-load="description_content"><p>Given an array...</p>
<p><strong class="example">Example 1:</strong></p>
<pre><strong>Input:</strong> nums = [2,7,11,15], target = 9
<strong>Output:</strong> [0,1]</pre>
<p><strong class="example">Example 2:</strong></p>
<pre><strong>Input:</strong> nums = [3,2,4], target = 6
<strong>Output:</strong> [1,2]</pre>
</div>
<div id="editor" style="height:60px;overflow:hidden">(editor shows only a few lines)</div>
<script>
  const code = ${JSON.stringify(code)};
  const mk = (lang, value) => ({ getLanguageId: () => lang, getValue: () => value, getValueLength: () => value.length, isDisposed: () => false });
  const codeModel = mk(${JSON.stringify(language)}, code), testModel = mk("plaintext", "[2,7,11,15]\\n9");
  const node = document.getElementById("editor");
  window.monaco = { editor: {
    getModels: () => [codeModel, testModel],
    getEditors: () => [{ getModel: () => codeModel, getContainerDomNode: () => node }],
  } };
</script></body></html>`;
}

const PAGES = {
  "/selection.html": `<!doctype html><html><head><title>Selection fixture</title></head><body>
<p>Some article text.</p>
<pre id="code">def add(a, b):
    return a + b

print(add(2, 3))</pre></body></html>`,
  "/problems/two-sum/": fakeLeetCode("python3", LONG_SOLUTION),
  "/problems/cpp-problem/": fakeLeetCode("cpp", "class Solution {\npublic:\n};"),
  "/problems/no-editor/": "<!doctype html><title>Loading - LeetCode</title><p>loading…</p>",
};

const serve = (req, res) => {
  const body = PAGES[new URL(req.url, "http://x").pathname];
  res.writeHead(body ? 200 : 404, { "content-type": "text/html; charset=utf-8" });
  res.end(body || "not found");
};
const server = http.createServer(serve);
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const port = server.address().port;

// Chrome forces HTTPS for leetcode.com, so the fake LeetCode page is served
// over HTTPS with a throwaway self-signed certificate (accepted only in the
// temporary test profile via --ignore-certificate-errors).
const certDir = await mkdtemp(path.join(os.tmpdir(), "visualleet-cert-"));
execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=leetcode.com",
  "-keyout", path.join(certDir, "key.pem"), "-out", path.join(certDir, "cert.pem")], { stdio: "ignore" });
const tlsServer = https.createServer({ key: await readFile(path.join(certDir, "key.pem")), cert: await readFile(path.join(certDir, "cert.pem")) }, serve);
await new Promise((r) => tlsServer.listen(0, "127.0.0.1", r));
const tlsPort = tlsServer.address().port;

// ---------- helpers ----------
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const results = { environment: {}, checks: [], timings: {} };
const check = (group, name, pass, detail) => {
  results.checks.push({ group, name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  [${group}] ${name}${detail !== undefined ? "  — " + JSON.stringify(detail).slice(0, 300) : ""}`);
};
const refOf = (v) => (Array.isArray(v) && v[0] === "REF" ? v[1] : null);
const frameVar = (step, func, name) => {
  for (const f of step.stack_to_render || []) if (f.func_name === func && f.encoded_locals && name in f.encoded_locals) return f.encoded_locals[name];
  return undefined;
};
const heapOf = (step, v) => (refOf(v) !== null ? step.heap[refOf(v)] : undefined);

const profile = await mkdtemp(path.join(os.tmpdir(), "visualleet-accept-"));
const browser = await puppeteer.launch({
  executablePath: chromePath, headless: !headed, pipe: true, enableExtensions: true, userDataDir: profile,
  defaultViewport: { width: 1400, height: 900 },
  args: [`--host-resolver-rules=MAP leetcode.com 127.0.0.1:${tlsPort}`, "--ignore-certificate-errors"],
});

try {
  results.environment = { chrome: await browser.version(), headless: !headed, platform: `${os.type()} ${os.release()}`, cpu: os.cpus()[0].model, date: new Date().toISOString() };
  const id = await browser.installExtension(path.join(root, "dist", "extension-test"));
  const page = await browser.newPage();
  const dialogs = [];
  page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const ui = `chrome-extension://${id}/ui/index.html`;

  let t0 = Date.now();
  await page.goto(ui);
  const info = await page.evaluate(() => visualleet.whenReady());
  results.timings.coldStartMs = Date.now() - t0;
  results.environment.python = info.python;
  results.environment.pyodide = info.pyodide;
  check("runtime", "Packaged Python starts", !!info.python, { python: info.python, ms: results.timings.coldStartMs, wasmCompiledOnceMs: info.timings.wasmCompiledOnceMs });

  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const runParts = (parts) => ev(async (p) => { await visualleet.whenReady(); visualleet.setProgram(p); const r = await visualleet.visualize(); r.trace = visualleet.lastTrace(); return r; }, parts);
  const run = (src, inputs) => runParts({ setup: "", solution: src, call: "", inputs: inputs ? inputs.join("\n") : "" });
  const example = (name) => ev(async (n) => { await visualleet.whenReady(); const sel = document.getElementById("example"); sel.value = n; sel.dispatchEvent(new Event("change")); const r = await visualleet.visualize(); r.trace = visualleet.lastTrace(); return r; }, name);

  // ---------- correctness fixtures ----------
  {
    const r = await example("Two Sum");
    const sizes = r.trace.trace.map((s) => { const d = heapOf(s, frameVar(s, "twoSum", "seen")); return d ? d.length - 1 : -1; }).filter((n) => n >= 0);
    check("fixtures", "Two Sum: [0, 1]; the dict grows step by step", r.stdout === "[0, 1]\n" && sizes[0] === 0 && Math.max(...sizes) === 1, { stdout: r.stdout, dictSizes: [...new Set(sizes)] });
  }
  {
    const r = await example("BFS");
    const queueSeen = r.trace.trace.filter((s) => frameVar(s, "bfs", "queue") !== undefined && frameVar(s, "bfs", "seen") !== undefined).length;
    check("fixtures", "BFS: order A,B,C,D; queue/seen visible in the frame", r.stdout === "['A', 'B', 'C', 'D']\n" && queueSeen > 10, { stdout: r.stdout, stepsWithQueueAndSeen: queueSeen });
  }
  {
    const r = await example("Sliding window");
    const lefts = new Set(r.trace.trace.map((s) => frameVar(s, "longest_unique_substring", "left")).filter((v) => v !== undefined));
    check("fixtures", "Sliding window: 3; left/right move", r.stdout === "3\n" && lefts.size >= 4, { stdout: r.stdout, leftValues: [...lefts] });
  }
  {
    const r = await example("Recursion");
    const depth = Math.max(...r.trace.trace.map((s) => (s.stack_to_render || []).filter((f) => f.func_name === "fact").length));
    const returns = r.trace.trace.filter((s) => s.event === "return" && s.func_name === "fact").length;
    check("fixtures", "Factorial: 120; five distinct nested frames and returns", r.stdout === "120\n" && depth === 5 && returns === 5, { depth, returns });
  }
  {
    const r = await example("Linked list");
    check("fixtures", "Reverse a 3-node linked list: [3, 2, 1]", r.stdout === "[3, 2, 1]\n", { stdout: r.stdout, steps: r.steps });
  }
  {
    const r = await example("Tree");
    check("fixtures", "Binary tree in-order traversal", r.stdout === "[1, 2, 3, 4, 5, 6, 7]\n", { stdout: r.stdout });
  }
  {
    const r = await example("NestedInteger");
    check("fixtures", "NestedInteger [1,[4,[6]]] flattens to [1, 4, 6]", r.stdout === "[1, 4, 6]\n", { stdout: r.stdout });
  }
  {
    const r = await example("Dynamic programming");
    const dps = r.trace.trace.map((s) => heapOf(s, frameVar(s, "climb_stairs", "dp"))).filter(Boolean).map((l) => JSON.stringify(l.slice(1)));
    check("fixtures", "DP table: 13; earlier steps keep their historical values", r.stdout === "13\n" && dps[0] === "[0,0,0,0,0,0,0]" && dps[dps.length - 1] === "[1,1,2,3,5,8,13]", { first: dps[0], last: dps[dps.length - 1] });
  }
  {
    const r = await run("a = [1]\nb = a\nb.append(2)\n");
    const last = r.trace.trace[r.trace.trace.length - 1];
    check("fixtures", "Aliasing: a and b are one shared list", refOf(last.globals.a) !== null && refOf(last.globals.a) === refOf(last.globals.b) && JSON.stringify(heapOf(last, last.globals.a)) === '["LIST",1,2]', { a: last.globals.a, b: last.globals.b });
  }
  {
    const r = await run("a = []\na.append(a)\nprint(len(a))\n");
    const last = r.trace.trace[r.trace.trace.length - 1];
    const lst = heapOf(last, last.globals.a);
    const arrows = await ev(() => document.querySelectorAll("#viz .vlArrowLayer path").length);
    check("fixtures", "Cyclic list renders without recursion failure", r.status === "complete" && refOf(lst[1]) === refOf(last.globals.a), { list: lst, arrows });
  }
  {
    const r = await run(`from collections import Counter, deque, defaultdict
import heapq, bisect
from functools import lru_cache
c = Counter("abracadabra")
q = deque([1, 2, 3])
q.appendleft(0)
dd = defaultdict(list)
dd["k"].append(1)
h = [5, 1, 4]
heapq.heapify(h)
smallest = heapq.heappop(h)
arr = [1, 3, 5]
bisect.insort(arr, 4)
@lru_cache(maxsize=None)
def fib(n):
    return n if n < 2 else fib(n - 1) + fib(n - 2)
print(c.most_common(1), list(q), dict(dd), smallest, arr, fib(10))
`);
    const last = r.trace.trace[r.trace.trace.length - 1];
    const shown = Object.fromEntries(["c", "q", "dd"].map((k) => [k, (heapOf(last, last.globals[k]) || last.globals[k] || [])[0]]));
    check("fixtures", "Counter / deque / defaultdict / heapq / bisect / lru_cache", r.stdout === "[('a', 5)] [0, 1, 2, 3] {'k': [1]} 1 [1, 3, 4, 5] 55\n", { stdout: r.stdout, encodedAs: shown });
  }
  {
    const syn = await run("def f(:\n    pass\nf()\n");
    const msg = await ev(() => visualleet.message());
    check("fixtures", "Syntax error: status failed, message has the line", syn.status === "failed" && /Line 1: SyntaxError/.test(msg), { msg });
    const caught = await run("try:\n    1 / 0\nexcept ZeroDivisionError:\n    x = 'caught'\nprint(x)\n");
    check("fixtures", "Caught exception: tracing continues", caught.status === "complete" && caught.stdout === "caught\n", { stdout: caught.stdout });
    const unc = await run("def f(n):\n    return [1, 2][n]\nprint(f(5))\n");
    check("fixtures", "Uncaught exception: shown at its line", /IndexError/.test(unc.exception || "") && unc.status === "complete", { exception: unc.exception });
    const ok = await run("print('recovered')\n");
    check("fixtures", "Recovers after errors", ok.stdout === "recovered\n");
  }
  {
    await run("leftover = 42\nimport math\nmath.visualleet_marker = 1\n");
    await ev(() => new Promise((r) => { const t = setInterval(() => { if (visualleet.runtimeInfo() && visualleet.runtimeInfo().spareReady) { clearInterval(t); r(); } }, 50); }));
    const b = await run("import math\nprint('leftover' in globals(), hasattr(math, 'visualleet_marker'))\n");
    check("fixtures", "Run A then run B: no globals, module or output carried over", b.stdout === "False False\n" && b.metrics.interpreterRun === 1, { stdout: b.stdout, interpreterRun: b.metrics.interpreterRun });
  }
  {
    const ok = await runParts({ setup: "", solution: 'name = input("name? ")\nprint("hi", name)', call: "", inputs: "Ada" });
    const missing = await runParts({ setup: "", solution: 'a = input("first? ")\nb = input("second? ")\nprint(a, b)', call: "", inputs: "1" });
    check("fixtures", "input(): supplied lines are used; running out says so", ok.stdout === "name? Ada\nhi Ada\n" && missing.status === "needs input", { ok: ok.stdout, missing: missing.status });
  }
  {
    const r = await runParts({ setup: "from typing import List", solution: "class Solution:\n    def f(self, x: int) -> int:\n        return x", call: "" });
    const msg = await ev(() => visualleet.message());
    check("fixtures", "Definitions without a call prompt for a test call (not run)", r.status === "rejected" && /Add a test call/.test(msg), { msg });
  }
  {
    const shown = await ev(() => document.querySelector("#viz #pyCodeOutput") ? [...document.querySelectorAll("#viz #pyCodeOutput td.cod")].map((t) => t.textContent).join("\n") : "");
    const r = await example("Two Sum");
    const code = await ev(() => [...document.querySelectorAll("#viz #pyCodeOutput td.cod")].map((t) => t.textContent.replace(/\u00a0/g, " ")).join("\n"));
    const prog = await ev(() => visualleet.program());
    const expected = [prog.setup, prog.solution, prog.call].map((s) => s.trimEnd()).filter(Boolean).join("\n\n");
    check("fixtures", "Visualizer shows the exact combined program (setup + solution + call)", code.trimEnd() === expected, { lines: code.split("\n").length, firstLine: code.split("\n")[0], unused: !!shown });
  }

  // ---------- rendering & safety ----------
  {
    const html = await run('print("<img src=x onerror=alert(1)><b>not bold</b>")\ns = "<script>alert(2)</script>"\n');
    await ev(() => { const b = [...document.querySelectorAll("#viz button")].find((x) => /Last/.test(x.textContent)); b && b.click(); });
    const injected = await ev(() => document.querySelectorAll("#viz img, #viz script, #viz b").length);
    check("safety", "HTML in output and strings is text only", html.status === "complete" && injected === 0 && dialogs.length === 0, { injected, dialogs });
  }
  {
    const probe = await ev(async () => { await visualleet.whenReady(); return visualleet.probe(); });
    const r = probe.report || {};
    const blocked = ["sync XHR to example.com", "original fetch to example.com", "importScripts from example.com"].every((k) => /blocked/.test(r[k] || "")) && !/opened/.test(r["WebSocket to example.com"] || "opened");
    check("safety", "Python's JS bridge: no extension APIs, no network", r["typeof chrome"] === "undefined" && r["typeof document"] === "undefined" && blocked, { chrome: r["typeof chrome"], ws: r["WebSocket to example.com"], csp: (r["CSP violations reported in worker"] || "").slice(0, 120) });
    const stats = await ev(() => visualleet.sandboxStats());
    const sandboxChrome = await page.frames().find((f) => f.url().includes("runner/sandbox.html")).evaluate(() => typeof chrome === "undefined" || !chrome.runtime || !chrome.runtime.sendMessage);
    check("safety", "Runner can't reach extension messaging; forged messages dropped", stats.dropped >= 3 && sandboxChrome, { dropped: stats.dropped, sandboxHasNoMessaging: sandboxChrome });
  }

  // ---------- limits & lifecycle ----------
  {
    const inf = await run("i = 0\nwhile True:\n    i += 1\n");
    const after = await run("print('ok')\n");
    check("limits", "Infinite loop ends at the step limit, labeled incomplete; next run works", inf.status === "limit reached" && inf.steps === 1001 && after.stdout === "ok\n", { status: inf.status, steps: inf.steps });
  }
  {
    await ev(() => new Promise((r) => { const t = setInterval(() => { if (visualleet.runtimeInfo() && visualleet.runtimeInfo().spareReady) { clearInterval(t); r(); } }, 50); }));
    t0 = Date.now();
    const busy = await run("total = sum(range(10**12))\n");
    const killed = Date.now() - t0;
    t0 = Date.now();
    await ev(() => visualleet.whenReady());
    const back = Date.now() - t0;
    const next = await run("print('after timeout')\n");
    check("limits", "Native loop killed by the 5 s watchdog; spare takes over at once", busy.status === "timed out" && next.stdout === "after timeout\n" && back < 500, { killedAfterMs: killed, readyAgainMs: back });
    results.timings.watchdogKillMs = killed;
    results.timings.readyAfterTimeoutMs = back;
  }
  {
    await ev(() => new Promise((r) => { const t = setInterval(() => { if (visualleet.runtimeInfo() && visualleet.runtimeInfo().spareReady) { clearInterval(t); r(); } }, 50); }));
    const s = await ev(async () => {
      await visualleet.whenReady();
      visualleet.setProgram({ setup: "", solution: "total = sum(range(10**12))", call: "", inputs: "" });
      const p = visualleet.visualize();
      await new Promise((r) => setTimeout(r, 500));
      const t = performance.now();
      visualleet.stop();
      const res = await p;
      const stoppedMs = performance.now() - t;
      const t2 = performance.now();
      await visualleet.whenReady();
      return { res: res.status, stoppedMs, readyMs: performance.now() - t2 };
    });
    const next = await run("print('after stop')\n");
    check("limits", "Stop: acknowledged fast, ready again immediately", s.res === "stopped" && s.stoppedMs < 500 && next.stdout === "after stop\n", s);
    results.timings.stopMs = Math.round(s.stoppedMs);
    results.timings.readyAfterStopMs = Math.round(s.readyMs);
    const stale = await ev(async () => {
      await visualleet.whenReady();
      visualleet.setProgram({ setup: "", solution: "x = sum(range(3 * 10**6))\nprint('first')", call: "", inputs: "" });
      const p1 = visualleet.visualize();
      visualleet.stop();
      const r1 = await p1;
      await visualleet.whenReady();
      visualleet.setProgram({ setup: "", solution: "print('second')", call: "", inputs: "" });
      const r2 = await visualleet.visualize();
      await new Promise((r) => setTimeout(r, 1500));     // give a stale result time to (not) show up
      const out = visualleet.lastTrace().trace.slice(-1)[0].stdout;
      return { r1: r1.status, r2: r2.status, shownStdout: out };
    });
    check("limits", "A stopped run's result never replaces the newer one", stale.r1 === "stopped" && stale.shownStdout === "second\n", stale);
  }
  {
    const big = await run("data = list(range(5000))\ntotal = sum(data)\nprint(total)\n");
    const cells = await ev(() => { const b = [...document.querySelectorAll("#viz button")].find((x) => /Last/.test(x.textContent)); b && b.click(); return { cells: document.querySelectorAll("#viz td.listElt").length, note: (document.querySelector("#viz .vlCollapsedNote") || {}).textContent }; });
    check("limits", "Large list: runs, display collapsed with a label", big.stdout === "12497500\n" && cells.cells <= 61 && /showing 60 of 5000/.test(cells.note || ""), Object.assign({ steps: big.steps }, cells));
    const out = await run("for i in range(100000):\n    print('x' * 1000)\n");
    const msg = await ev(() => visualleet.message());
    check("limits", "Large output stops with an explicit output limit", out.status === "limit reached" && /KiB of output/.test(msg), { msg: msg.slice(0, 100) });
    const huge = await run("data = list(range(20000))\nfor i in range(200):\n    data[i] += 1\n");
    const hmsg = await ev(() => visualleet.message());
    check("limits", "Trace over 10 MiB is refused with an explanation", huge.status === "failed" && /MiB limit/.test(hmsg), { msg: hmsg });
  }
  {
    const before = await ev(() => ({ iframes: document.querySelectorAll("iframe").length, arrowLayers: document.querySelectorAll(".vlArrowLayer").length }));
    const nodes = [];
    for (let i = 0; i < 12; i++) {
      await example(i % 2 ? "BFS" : "Tree");
      nodes.push(await ev(() => document.querySelectorAll("#viz *").length));
    }
    const after = await ev(() => ({ iframes: document.querySelectorAll("iframe").length, arrowLayers: document.querySelectorAll(".vlArrowLayer").length, vizChildren: document.getElementById("viz").children.length }));
    check("lifecycle", "Repeated runs replace the view (no accumulating DOM, frames or arrow layers)", after.iframes === 1 && after.arrowLayers === 1 && after.vizChildren === 1 && nodes[1] === nodes[11] && nodes[0] === nodes[10], { before, after, domNodesBfs: [nodes[1], nodes[11]], domNodesTree: [nodes[0], nodes[10]] });
    // policy: back-to-back runs may reuse the interpreter (the spare takes ~2 s
    // to boot); once the spare is ready, the used interpreter is swapped out
    const burst = await ev(() => visualleet.sandboxStats());
    const waited = await ev(async () => {
      const t = performance.now();
      for (;;) {
        const s = await visualleet.sandboxStats();
        if (s.activeRuns === 0) return performance.now() - t;
        if (performance.now() - t > 15000) return -1;
        await new Promise((r) => setTimeout(r, 100));
      }
    });
    const nextRun = await run("print('fresh?')\n");
    check("lifecycle", "Burst runs reuse the interpreter; after a pause the next run is fresh", burst.activeRuns > 1 && waited >= 0 && nextRun.metrics.interpreterRun === 1,
      { burstRunsOnOneInterpreter: burst.activeRuns, swappedAfterMs: Math.round(waited), nextRunInterpreterRun: nextRun.metrics.interpreterRun, spareInitErrors: burst.spareInitErrors || 0 });
  }

  // ---------- imports ----------
  const tabIdFor = (url) => ev(async (u) => (await chrome.tabs.query({ url: u }))[0]?.id, url);
  {
    const src = await browser.newPage();
    await src.goto(`http://127.0.0.1:${port}/selection.html`);
    await src.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById("code")); const s = getSelection(); s.removeAllRanges(); s.addRange(r); });
    const tabId = await tabIdFor(`http://127.0.0.1:${port}/selection.html`);
    await page.bringToFront();
    const res = await ev((t) => visualleet.importFrom("selection", t), tabId);
    const prog = await ev(() => visualleet.program());
    check("imports", "Selected text imports with line breaks intact", res.ok && prog.solution === "def add(a, b):\n    return a + b\n\nprint(add(2, 3))", { solution: prog.solution });
    const r = await ev(async () => { const x = await visualleet.visualize(); return x; });
    check("imports", "Imported selection runs", r.stdout === "5\n", { stdout: r.stdout });

    await src.evaluate(() => getSelection().removeAllRanges());
    await ev(() => visualleet.setProgram({ setup: "S", solution: "KEEP ME", call: "C" }));
    const empty = await ev((t) => visualleet.importFrom("selection", t), tabId);
    const kept = await ev(() => visualleet.program());
    check("imports", "Empty selection: helpful message, edits kept", !empty.ok && /Nothing is selected/.test(empty.error) && kept.solution === "KEEP ME" && kept.setup === "S", { error: empty.error });
    await src.close();
  }
  {
    const lc = await browser.newPage();
    await lc.goto("https://leetcode.com/problems/two-sum/");
    const tabId = await tabIdFor("https://leetcode.com/*");
    await page.bringToFront();
    const res = await ev((t) => visualleet.importFrom("leetcode", t), tabId);
    const prog = await ev(() => visualleet.program());
    check("imports", "LeetCode editor: whole model imported, including lines out of view", res.ok && prog.solution.split("\n").length === LONG_SOLUTION.split("\n").length && prog.solution === LONG_SOLUTION, { lines: prog.solution.split("\n").length, language: res.language, title: res.title });
    check("imports", "LeetCode editor: test call drafted from Example 1, typing helper added", prog.call === "nums = [2,7,11,15]\ntarget = 9\nprint(Solution().twoSum(nums, target))" && /from typing import List/.test(prog.setup), { call: prog.call });
    const r = await ev(() => visualleet.visualize());
    check("imports", "Imported LeetCode solution runs", r.stdout === "[0, 1]\n", { stdout: r.stdout });

    await lc.goto("https://leetcode.com/problems/cpp-problem/");
    await page.bringToFront();
    const before = await ev(() => visualleet.program());
    const cpp = await ev((t) => visualleet.importFrom("leetcode", t), tabId);
    const after = await ev(() => visualleet.program());
    check("imports", "Non-Python editor: explained, nothing converted, edits kept", !cpp.ok && cpp.reason === "language" && JSON.stringify(before) === JSON.stringify(after), { msg: await ev(() => visualleet.message()) });

    await lc.goto("https://leetcode.com/problems/no-editor/");
    await page.bringToFront();
    const none = await ev((t) => visualleet.importFrom("leetcode", t), tabId);
    check("imports", "LeetCode page without an editor: fallback offered", !none.ok && /Import selection|paste/.test(none.error), { error: none.error });
    await lc.close();
  }
  {
    const prot = await browser.newPage();
    await prot.goto("chrome://version");
    const tabId = await ev(async () => (await chrome.tabs.query({})).find((t) => !t.url)?.id);
    await page.bringToFront();
    await ev(() => visualleet.setProgram({ setup: "", solution: "STILL HERE", call: "" }));
    const res = await ev((t) => visualleet.importFrom("selection", t), tabId);
    const kept = await ev(() => visualleet.program().solution);
    check("imports", "Protected chrome:// page: graceful refusal, edits kept", !res.ok && /can't read that page|protected/i.test(res.error) && kept === "STILL HERE", { error: res.error });
    await prot.close();
  }

  // ---------- offline ----------
  {
    await page.setOfflineMode(true);
    t0 = Date.now();
    await page.reload();
    await ev(() => visualleet.whenReady());
    const r = await example("BFS");
    check("offline", "Packaged examples run and render with the network off", r.stdout === "['A', 'B', 'C', 'D']\n", { initMs: Date.now() - t0 });
    await page.setOfflineMode(false);
  }

  // ---------- timings ----------
  for (const name of ["BFS", "Sliding window", "Two Sum"]) {
    const ms = [];
    for (let i = 0; i < 7; i++) ms.push((await example(name)).metrics);
    const pick = (k) => ms.map((m) => m[k]);
    results.timings[name] = Object.fromEntries(["execMs", "transferMs", "parseMs", "renderMs", "firstViewMs"].map((k) => [k, { median: +median(pick(k)).toFixed(1), worst: +Math.max(...pick(k)).toFixed(1) }]));
  }
  results.timings.stepNavigation = await ev(() => {
    const btn = (re) => [...document.querySelectorAll("#viz button")].find((b) => re.test(b.textContent));
    btn(/First/).click();
    const ts = [];
    for (let i = 0; i < 40; i++) { const t = performance.now(); btn(/Next/).click(); document.body.offsetHeight; ts.push(performance.now() - t); }
    ts.sort((a, b) => a - b);
    return { medianMs: +ts[ts.length >> 1].toFixed(1), worstMs: +ts[ts.length - 1].toFixed(1) };
  });
  t0 = Date.now();
  await page.reload();
  await ev(() => visualleet.whenReady());
  results.timings.reloadStartMs = Date.now() - t0;

  // closing the workspace disposes the runtime
  const workersBefore = browser.targets().filter((t) => t.type() === "worker").length;
  await page.close();
  await new Promise((r) => setTimeout(r, 1000));
  const workersAfter = browser.targets().filter((t) => t.type() === "worker").length;
  check("lifecycle", "Closing the VisualLeet tab disposes its Python workers", workersAfter === 0, { workersBefore, workersAfter });

  await mkdir(outDir, { recursive: true });
} finally {
  await browser.close();
  server.close();
  tlsServer.close();
  await rm(certDir, { recursive: true, force: true }).catch(() => {});
  await rm(profile, { recursive: true, force: true }).catch(() => {});
}

results.passed = results.checks.filter((c) => c.pass).length;
results.total = results.checks.length;
await mkdir(outDir, { recursive: true });
await writeFile(path.join(outDir, "acceptance-results.json"), JSON.stringify(results, null, 2));
console.log(`\n${results.passed}/${results.total} checks passed`);
console.log(JSON.stringify(results.timings));
process.exitCode = results.passed === results.total ? 0 : 1;
