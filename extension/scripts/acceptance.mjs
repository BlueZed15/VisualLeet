// Acceptance checks for the LeetScope extension.
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
import { PROGRAMS } from "./lib/programs.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const chromePath = arg("--chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe");
const outDir = path.resolve(arg("--out", path.join(root, "acceptance")));
const headed = process.argv.includes("--headed");

// ---------- fixture pages ----------
const LONG_SOLUTION = ["class Solution:", "    def twoSum(self, nums: List[int], target: int) -> List[int]:", "        seen = {}"]
  .concat(Array.from({ length: 70 }, (_, i) => `        # filler line ${i + 1} so the editor has lines out of view`))
  .concat(["        for i, n in enumerate(nums):", "            if target - n in seen:", "                return [seen[target - n], i]", "            seen[n] = i"]).join("\n");

// Fake LeetCode problem pages with the structure the live site has
// (checked on leetcode.com, 2026-11-14): the problem's data object in
// window.next.router.components (window.__NEXT_DATA__ is stale after in-app
// navigation, so here it describes another problem), window.monaco with the
// code model (the editor only renders a few lines), and the Testcase panel:
// case tabs (button[data-e2e-locator=console-testcase-tag], the selected one
// not "bg-transparent"), one contenteditable box per argument under a
// "name =" label, and a CodeMirror holding every case as raw lines.
const PROBLEMS = {
  "two-sum": {
    title: "Two Sum", id: "1",
    meta: { name: "twoSum", params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }], return: { type: "integer[]" } },
    examples: [["[2,7,11,15]\n9", "[0,1]"], ["[3,2,4]\n6", "[1,2]"], ["[3,3]\n6", "[0,1]"]],
    code: LONG_SOLUTION, anyOrder: true,
  },
  "reverse-linked-list": {
    title: "Reverse Linked List", id: "206",
    meta: { name: "reverseList", params: [{ name: "head", type: "ListNode" }], return: { type: "ListNode" } },
    examples: [["[1,2,3,4,5]", "[5,4,3,2,1]"], ["[1,2]", "[2,1]"], ["[]", "[]"]],
    code: "# Definition for singly-linked list.\n# class ListNode:\n#     def __init__(self, val=0, next=None):\n#         self.val = val\n#         self.next = next\nclass Solution:\n    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        prev = None\n        while head:\n            nxt = head.next\n            head.next = prev\n            prev = head\n            head = nxt\n        return prev",
  },
  "lru-cache": {
    title: "LRU Cache", id: "146",
    meta: { classname: "LRUCache", constructor: { params: [{ type: "integer", name: "capacity" }] }, methods: [{ name: "get", params: [{ type: "integer", name: "key" }], return: { type: "integer" } }, { name: "put", params: [{ type: "integer", name: "key" }, { type: "integer", name: "value" }], return: { type: "void" } }], systemdesign: true },
    examples: [['["LRUCache","put","put","get","put","get","put","get","get","get"]\n[[2],[1,1],[2,2],[1],[3,3],[2],[4,4],[1],[3],[4]]', "[null,null,null,1,null,-1,null,-1,3,4]"]],
    code: "class LRUCache:\n    def __init__(self, capacity: int):\n        self.cap = capacity\n        self.data = OrderedDict()\n\n    def get(self, key: int) -> int:\n        if key not in self.data:\n            return -1\n        self.data.move_to_end(key)\n        return self.data[key]\n\n    def put(self, key: int, value: int) -> None:\n        self.data[key] = value\n        self.data.move_to_end(key)\n        if len(self.data) > self.cap:\n            self.data.popitem(last=False)",
  },
  "not-in-the-database": {
    title: "Not In The Database", id: "9999",
    meta: { name: "f", params: [{ name: "x", type: "integer" }], return: { type: "integer" } },
    examples: [["3", "6"]],
    code: "class Solution:\n    def f(self, x: int) -> int:\n        return 2 * x",
  },
};

function fakeLeetCode(slug, { language = "python3", code, cases, selected = 0, hidden = false, panel = "boxes", tabStyle = "live", boxes: withBoxes = true, dup = false } = {}) {
  const p = PROBLEMS[slug];
  const names = p.meta.systemdesign ? ["operations", "arguments"] : p.meta.params.map((x) => x.name);
  const all = cases || p.examples.map(([input]) => input.split("\n"));
  const content = "<p>Problem statement.</p>\n" + p.examples.map(([input, output], i) =>
    `<p><strong class="example">Example ${i + 1}:</strong></p>\n<pre><strong>Input:</strong> ${input.replace(/\n/g, ", ")}\n<strong>Output:</strong> ${output}\n<strong>Explanation:</strong> because.\n</pre>\n`).join("");
  const question = { titleSlug: slug, questionFrontendId: p.id, questionTitle: p.title, isPaidOnly: false, metaData: JSON.stringify(p.meta), exampleTestcaseList: p.examples.map(([i]) => i), content };
  const stale = { titleSlug: "some-other-problem", metaData: "{}", exampleTestcaseList: [] };
  // case tabs as LeetCode marks them on first load: only the selected one has a background class
  // (checked on leetcode.com 2026-11-17); tabStyle "old": the others say bg-transparent, as after a click
  const tabClass = (on) => tabStyle === "old" ? `tab ${on ? "bg-fill-3" : "bg-transparent"}`
    : `font-medium items-center whitespace-nowrap inline-flex ${on ? "bg-fill-3 dark:bg-dark-fill-3 hover:bg-fill-2" : "hover:bg-fill-2 dark:hover:bg-dark-fill-2 text-label-2"}`;
  const tabs = all.map((_, i) => `<button data-e2e-locator="console-testcase-tag" class="${tabClass(i === selected)}">Case ${i + 1}</button>`).join("");
  const boxesOf = (k) => names.map((n, j) => `<div class="flex flex-col">${p.meta.systemdesign ? "" : `<div>${n} =</div>`}<div class="w-full"><div contenteditable="true" data-e2e-locator="console-testcase-input">${(all[k][j] || "").replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div></div></div>`).join("");
  // boxes=0: no input boxes (the case comes from the tabs and raw lines); dup=1: a hidden
  // second set of boxes for another case, as a page can keep after a Run
  const boxes = (withBoxes ? boxesOf(selected) : "") + (dup ? `<div style="display:none">${boxesOf(selected ? 0 : 1)}</div>` : "");
  return `<!doctype html><html><head><title>${p.title} - LeetCode</title></head><body>
<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { question: stale } } })}</script>
<div class="text-title-large">${p.id}. ${p.title}</div>
<div id="ide-top-btns" class="relative flex gap-2"><div><button data-e2e-locator="console-run-button">Run</button></div><div><button data-e2e-locator="console-submit-button">Submit</button></div></div>
<div data-e2e-locator="console-result"></div>
<div id="editor" style="height:60px;overflow:hidden">(editor shows only a few lines)</div>
${panel !== "boxes" ? "" : `<div id="testcase"${hidden ? " style=\"display:none\"" : ""}>${tabs}<div class="space-y-4">${boxes}</div>
<div class="cm-editor"><div class="cm-content" contenteditable="true">${all.flat().map((l) => `<div class="cm-line">${l.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`).join("")}</div></div></div>`}
<script>
  window.__NEXT_DATA__ = JSON.parse(document.getElementById("__NEXT_DATA__").textContent);
  window.next = ${JSON.stringify({ router: { components: { "/problems/[slug]/[[...tab]]": { props: { pageProps: { dehydratedState: { queries: [{ state: { data: { question } } }] } } } } } } })};
  const code = ${JSON.stringify(code || p.code)};
  const mk = (lang, value) => ({ getLanguageId: () => lang, getValue: () => value, getValueLength: () => value.length, isDisposed: () => false });
  const codeModel = mk(${JSON.stringify(language)}, code), testModel = mk("plaintext", ${JSON.stringify(panel === "text" ? all.flat().join("\n") : "")});
  // LeetCode's Run: a verdict appears in the Test Result panel a moment later
  let runs = 0;
  document.querySelector('[data-e2e-locator="console-run-button"]').addEventListener("click", () =>
    setTimeout(() => { document.querySelector('[data-e2e-locator="console-result"]').textContent = "Accepted (run " + (++runs) + ")"; }, 200));
  const node = document.getElementById("editor");
  window.monaco = { editor: {
    getModels: () => [codeModel, testModel],
    getEditors: () => [{ getModel: () => codeModel, getContainerDomNode: () => node }],
  } };
</script></body></html>`;
}

const PAGES = {
  // a problem page that hasn't loaded its data or editor yet (the top bar is there)
  "/problems/no-editor/": "<!doctype html><title>Loading - LeetCode</title><div id=\"ide-top-btns\"></div><p>loading…</p>",
};

// /problems/<slug>/?case=<i>&custom=<json lines>&lang=<id>
function problemPage(url) {
  const m = /^\/problems\/([a-z0-9-]+)\/$/.exec(url.pathname);
  if (!m || !PROBLEMS[m[1]]) return null;
  const q = url.searchParams;
  const p = PROBLEMS[m[1]];
  let cases = p.examples.map(([input]) => input.split("\n"));
  if (q.get("custom")) cases = cases.concat([JSON.parse(q.get("custom"))]);
  return fakeLeetCode(m[1], { language: q.get("lang") || "python3", cases, selected: Number(q.get("case") || 0), hidden: q.get("hidden") === "1", panel: q.get("panel") || "boxes",
    tabStyle: q.get("tabs") || "live", boxes: q.get("boxes") !== "0", dup: q.get("dup") === "1" });
}

const serve = (req, res) => {
  const url = new URL(req.url, "http://x");
  const body = PAGES[url.pathname] || problemPage(url);
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
  let page = await browser.newPage();
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

  const ev = (fn, ...a) => page.evaluate(fn, ...a);     // always the current LeetScope tab
  // run a whole Python program (visualleet.run): the tracer and renderer checks
  const run = (src) => ev(async (s) => { await visualleet.whenReady(); const r = await visualleet.run(s); r.trace = visualleet.lastTrace(); return r; }, src);
  const example = (name) => run(PROGRAMS[name]);

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
    const r = await run('name = input("name? ")\nprint("hi", name)\n');
    const msg = await ev(() => visualleet.message());
    check("fixtures", "input(): reported, since LeetCode problems don't read input", r.status === "needs input" && /input\(\)/.test(msg), { status: r.status, msg });
  }
  {
    const shown = await ev(() => document.querySelector("#viz #pyCodeOutput") ? [...document.querySelectorAll("#viz #pyCodeOutput td.cod")].map((t) => t.textContent).join("\n") : "");
    await example("Two Sum");
    const code = await ev(() => [...document.querySelectorAll("#viz #pyCodeOutput td.cod")].map((t) => t.textContent.replace(/\u00a0/g, " ")).join("\n"));
    const expected = PROGRAMS["Two Sum"].trimEnd();
    check("fixtures", "Visualizer shows the exact program that ran", code.trimEnd() === expected, { lines: code.split("\n").length, firstLine: code.split("\n")[0], unused: !!shown });
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
    check("limits", "Infinite loop ends at the step limit, labeled incomplete; next run works", inf.status === "limit reached" && inf.steps === 1501 && after.stdout === "ok\n", { status: inf.status, steps: inf.steps });
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
    check("limits", "Native loop killed by the 10 s watchdog; spare takes over at once", busy.status === "timed out" && next.stdout === "after timeout\n" && back < 500, { killedAfterMs: killed, readyAgainMs: back });
    results.timings.watchdogKillMs = killed;
    results.timings.readyAfterTimeoutMs = back;
  }
  {
    await ev(() => new Promise((r) => { const t = setInterval(() => { if (visualleet.runtimeInfo() && visualleet.runtimeInfo().spareReady) { clearInterval(t); r(); } }, 50); }));
    const s = await ev(async () => {
      await visualleet.whenReady();
      const p = visualleet.run("total = sum(range(10**12))");
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
      const p1 = visualleet.run("x = sum(range(3 * 10**6))\nprint('first')");
      visualleet.stop();
      const r1 = await p1;
      await visualleet.whenReady();
      const r2 = await visualleet.run("print('second')");
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
    check("limits", "Trace over 10 MiB stops recording with an explicit reason, keeping the steps that fit", huge.status === "limit reached" && /too large/.test(hmsg) && huge.steps > 1, { steps: huge.steps, msg: hmsg.slice(0, 120) });
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

  // ---------- LeetCode: the Visualize button on a (fixture) problem page ----------
  {
    const lc = await browser.newPage();
    // click LeetScope's Visualize button on the page, then wait for the LeetScope tab to take it
    const open = async (pathAndQuery) => {
      await lc.bringToFront();
      await lc.goto("https://leetcode.com" + pathAndQuery);
      await lc.waitForSelector("#ide-top-btns #visualleet-top-button", { timeout: 5000 });
      const before = await ev(() => visualleet.opens());
      await lc.evaluate(() => document.getElementById("visualleet-top-button").click());
      const r = await ev(async (n) => {
        for (let i = 0; i < 200 && visualleet.opens() === n; i++) await new Promise((x) => setTimeout(x, 50));
        return visualleet.opens() === n ? { status: "not opened" } : await visualleet.lastOpen();
      }, before);
      await page.bringToFront();
      return r;
    };
    const state = () => ev(() => ({
      status: visualleet.status(), message: visualleet.message(), verdict: visualleet.verdict(),
      problem: visualleet.leetcode.problem && visualleet.leetcode.problem.slug, title: document.getElementById("lc-title").textContent,
      selected: visualleet.leetcode.currentCase() && visualleet.leetcode.currentCase().label, solution: visualleet.code(),
      checked: !!(visualleet.leetcode.entry && (visualleet.leetcode.entry.verified || visualleet.leetcode.entry.checked)),
    }));
    const globalsSeen = (trace) => [...new Set(trace.trace.flatMap((s) => Object.keys(s.globals || {})))];

    // one click: code + the case selected in LeetCode's Testcase panel, visualized at once
    const r1 = await open("/problems/two-sum/?case=1");
    const s1 = await state();
    check("leetcode", "One click on Visualize: the selected LeetCode case runs at once", r1.status === "complete" && s1.selected === "Example 2" && /\[1,2\]\n$/.test(r1.stdout), { status: r1.status, selected: s1.selected, stdout: r1.stdout });
    check("leetcode", "Problem found by its name (stale __NEXT_DATA__ ignored), checked database entry", s1.problem === "two-sum" && s1.title === "1. Two Sum" && s1.checked, { title: s1.title, checked: s1.checked });
    check("leetcode", "Whole editor model read, including lines out of view", s1.solution === LONG_SOLUTION, { lines: s1.solution.split("\n").length });
    check("leetcode", "Example case: output compared with the expected output (✓)", s1.verdict && s1.verdict.kind === "match", s1.verdict);
    const t1 = await ev(() => visualleet.lastTrace());
    const g1 = globalsSeen(t1);
    check("leetcode", "Setup is hidden: inputs shown, helpers and imports not, no setup steps",
      g1.includes("nums") && g1.includes("target") && !g1.some((n) => ["leet_str", "deque", "List", "build_list", "Counter"].includes(n)) &&
      t1.code.endsWith("result = Solution().twoSum(nums, target)\nprint(leet_str(result))\n") && t1.code.startsWith(LONG_SOLUTION), { globals: g1, steps: t1.trace.length });

    // a case the user added on LeetCode (not an example): no expected output
    const r2 = await open(`/problems/two-sum/?case=3&custom=${encodeURIComponent(JSON.stringify(["[1,5,9]", "10"]))}`);
    const s2 = await state();
    const s2cases = await ev(() => visualleet.leetcode.problem.cases.map((c) => c.label));
    check("leetcode", "All LeetCode cases imported (examples once, the custom one as \"LeetCode 4\"); the selected one runs; no verdict without an expected output", s2.selected === "LeetCode 4" && JSON.stringify(s2cases) === JSON.stringify(["Example 1", "Example 2", "Example 3", "LeetCode 4"]) && /\[0,2\]\n$/.test(r2.stdout) && s2.verdict && s2.verdict.kind === "output", { selected: s2.selected, cases: s2cases, stdout: r2.stdout, verdict: s2.verdict });

    // a bad value is caught per box before running
    const bad = await ev(async () => {
      const box = document.querySelector("#case-fields textarea");
      box.value = "[1,5,";
      box.dispatchEvent(new Event("input"));
      const r = await visualleet.visualize();
      return { status: r.status, reason: r.reason, error: document.querySelector("#case-fields .field-error").textContent };
    });
    check("leetcode", "Invalid test-case value: explained under its box, not run", bad.status === "rejected" && bad.reason === "case" && /Missing/.test(bad.error), bad);

    // linked list: inputs built by hidden setup, output printed like LeetCode
    const r3 = await open("/problems/reverse-linked-list/?case=1");
    const s3 = await state();
    const t3 = await ev(() => visualleet.lastTrace());
    const codeLines = t3.code.split("\n").length;
    check("leetcode", "Linked list: [1,2] built hidden, reversed output [2,1] ✓, ListNode helpers not shown",
      /\[2,1\]\n$/.test(r3.stdout) && s3.verdict && s3.verdict.kind === "match" && !globalsSeen(t3).includes("build_list") && !globalsSeen(t3).includes("ListNode") &&
      t3.trace[0].globals.head && t3.trace[0].globals.head[0] === "REF" && t3.trace.every((s) => !s.line || s.line <= codeLines), { stdout: r3.stdout, verdict: s3.verdict, globals: globalsSeen(t3) });

    // design problem: operations + arguments
    const r4 = await open("/problems/lru-cache/");
    const s4 = await state();
    check("leetcode", "Design problem (LRU Cache): operations run on the user's class, output ✓", /\[null,null,null,1,null,-1,null,-1,3,4\]\n$/.test(r4.stdout) && s4.verdict && s4.verdict.kind === "match", { stdout: r4.stdout, verdict: s4.verdict });

    // problems found at click time are shown on the LeetCode page, next to the button
    const toastFor = async (pathAndQuery) => {
      await lc.bringToFront();
      await lc.goto("https://leetcode.com" + pathAndQuery);
      await lc.waitForSelector("#visualleet-top-button", { timeout: 5000 });
      await lc.evaluate(() => document.getElementById("visualleet-top-button").click());
      return lc.waitForSelector("#leetscope-toast", { timeout: 5000 }).then(() => lc.evaluate(() => ({
        text: document.querySelector("#leetscope-toast").textContent, action: !!document.querySelector("#leetscope-toast button + button, #leetscope-toast > button"),
      })), () => null);
    };
    // the editor isn't set to Python: explained on LeetCode, nothing run, the code in LeetScope kept
    const before = await ev(() => ({ code: visualleet.code(), opens: visualleet.opens() }));
    const tc2 = await toastFor("/problems/two-sum/?lang=cpp");
    const after = await ev(() => ({ code: visualleet.code(), opens: visualleet.opens() }));
    check("leetcode", "Non-Python editor: explained on LeetCode itself, LeetScope not opened, its code kept", !!tc2 && /set to C\+\+\..*Choose Python3/.test(tc2.text) && after.code === before.code && after.opens === before.opens, tc2);
    // LeetCode's "Python" is Python 2: the same, asking for Python3
    const tcPy2 = await toastFor("/problems/two-sum/?lang=python");
    const afterPy2 = await ev(() => ({ code: visualleet.code(), opens: visualleet.opens() }));
    check("leetcode", "Python 2 editor: explained on LeetCode itself (choose Python3), LeetScope not opened", !!tcPy2 && /Python, which is Python 2.*Choose Python3/.test(tcPy2.text) && afterPy2.code === before.code && afterPy2.opens === before.opens, tcPy2);
    const nd = await toastFor("/problems/not-in-the-database/");
    check("leetcode", "Problem not in the database: explained on LeetCode itself", !!nd && /isn't supported by LeetScope/.test(nd.text), nd);
    const none = await toastFor("/problems/no-editor/");
    check("leetcode", "LeetCode page without data or editor: explained on LeetCode itself", !!none && /couldn't read|isn't supported|reload/i.test(none.text), none);

    // cases are kept per problem; with LeetScope closed, a click opens a new tab that takes the case once
    await open("/problems/two-sum/?case=0");
    await ev(() => { visualleet.leetcode.addCase(); const box = document.querySelector("#case-fields textarea"); box.value = "[4,4]"; box.dispatchEvent(new Event("input")); });
    await page.close();
    await lc.bringToFront();
    await lc.goto("https://leetcode.com/problems/two-sum/?case=0");
    await lc.waitForSelector("#visualleet-top-button", { timeout: 5000 });
    const opened = browser.waitForTarget((t) => t.url().startsWith(ui), { timeout: 15000 });
    await lc.evaluate(() => document.getElementById("visualleet-top-button").click());
    page = await (await opened).page();
    page.on("dialog", async (d) => { dialogs.push(d.message()); await d.dismiss(); });
    page.on("pageerror", (e) => console.log("[pageerror]", e.message));
    await page.waitForFunction(() => window.visualleet && visualleet.started, { timeout: 15000 });
    const handoff = await ev(async () => { const r = await visualleet.started(); return { r, cases: visualleet.leetcode.problem.cases.map((c) => [c.label, c.source]), left: (await chrome.storage.session.get("pending")).pending || null }; });
    check("leetcode", "LeetScope closed: a click opens a new tab that takes the case once and visualizes it", handoff.r && handoff.r.status === "complete" && /\[0,1\]\n$/.test(handoff.r.stdout) && handoff.left === null, { status: handoff.r && handoff.r.status, left: handoff.left });
    check("leetcode", "The user's own cases are kept per problem across reloads", handoff.cases.some(([label, source]) => source === "yours"), { cases: handoff.cases });

    // after a Run, LeetCode shows "Test Result" and the Testcase panel isn't rendered
    const r8 = await open("/problems/two-sum/?case=1&hidden=1");
    const s8 = await state();
    check("leetcode", "Selected case read while LeetCode's Testcase panel is hidden (Test Result shown)", r8.status === "complete" && s8.selected === "Example 2", { status: r8.status, selected: s8.selected, message: s8.message.slice(0, 100) });
    // the selected tab, as LeetCode marks it today and as it used to, when there are no boxes to read
    const r9 = await open("/problems/two-sum/?case=2&boxes=0");
    const s9 = await state();
    const r10 = await open("/problems/two-sum/?case=1&boxes=0&tabs=old");
    const s10 = await state();
    check("leetcode", "Selected tab found from LeetCode's tab marking (today's and the old one)", r9.status === "complete" && s9.selected === "Example 3" && r10.status === "complete" && s10.selected === "Example 2",
      { today: [r9.status, s9.selected], old: [r10.status, s10.selected] });
    // a hidden second set of boxes (another case) doesn't win over the one on screen
    const r11 = await open("/problems/two-sum/?case=1&dup=1");
    const s11 = await state();
    check("leetcode", "Case on screen read even with a hidden second set of boxes in the page", r11.status === "complete" && s11.selected === "Example 2", { status: r11.status, selected: s11.selected });

    // the Visualize button in LeetCode's top bar updates the open LeetScope tab in place
    await ev(() => { window.__notReloaded = true; });
    await lc.bringToFront();
    await lc.goto("https://leetcode.com/problems/two-sum/?case=2");
    const button = await lc.waitForSelector("#ide-top-btns #visualleet-top-button", { timeout: 5000 }).catch(() => null);
    const tabsBefore = (await browser.pages()).length;
    if (button) await lc.evaluate(() => document.getElementById("visualleet-top-button").click());
    const viaButton = await ev(async () => {
      for (let i = 0; i < 100; i++) {
        const c = visualleet.leetcode.currentCase();
        if (c && c.label === "Example 3" && visualleet.status() === "complete") break;
        await new Promise((r) => setTimeout(r, 100));
      }
      return { selected: visualleet.leetcode.currentCase().label, status: visualleet.status(), sameTab: window.__notReloaded === true, verdict: visualleet.verdict() };
    });
    const tabsAfter = (await browser.pages()).length;
    check("leetcode", "LeetCode top bar has a Visualize button", !!button);
    check("leetcode", "Top-bar button: the open LeetScope tab is updated in place (no new tab, no reload)",
      viaButton.selected === "Example 3" && viaButton.status === "complete" && viaButton.sameTab && tabsAfter === tabsBefore && viaButton.verdict && viaButton.verdict.kind === "match",
      Object.assign({ tabsBefore, tabsAfter }, viaButton));
    // the glow when LeetCode finishes a Run, and the setting that turns it off
    const glowAfterRun = () => lc.evaluate(async () => {
      const wrap = document.getElementById("visualleet-top-button").parentElement;
      wrap.classList.remove("ls-vz-glow");
      document.querySelector('[data-e2e-locator="console-run-button"]').click();
      for (let i = 0; i < 30; i++) { if (wrap.classList.contains("ls-vz-glow")) return true; await new Promise((r) => setTimeout(r, 50)); }
      return false;
    });
    const glowDefault = await glowAfterRun();
    await ev(() => chrome.storage.local.set({ glow: false }));
    await new Promise((r) => setTimeout(r, 200));
    const glowOff = await glowAfterRun();
    await ev(() => chrome.storage.local.set({ glow: true }));
    await new Promise((r) => setTimeout(r, 200));
    const glowBack = await glowAfterRun();
    check("leetcode", "Button glows when LeetCode finishes a Run; the glow setting turns it off and on", glowDefault && !glowOff && glowBack, { glowDefault, glowOff, glowBack });
    // Report a problem: the panel shows what it adds, then opens the prefilled Google Form
    const report = await ev(async () => {
      const opened = [];
      const realOpen = window.open;
      window.open = (url) => { opened.push(url); return null; };
      document.getElementById("report-open").click();
      const dlg = document.getElementById("report");
      const shownOpen = dlg.open, details = document.getElementById("report-details").textContent;
      document.getElementById("report-send").click();                 // empty message: stays open
      const blocked = dlg.open && !opened.length;
      document.getElementById("report-msg").value = "The arrows look wrong";
      document.getElementById("report-code").checked = true;
      document.getElementById("report-send").click();
      await new Promise((r) => setTimeout(r, 100));
      window.open = realOpen;
      const q = opened[0] ? new URL(opened[0]).searchParams : null;
      return { shownOpen, blocked, closed: !dlg.open, details, host: opened[0] && new URL(opened[0]).host,
               what: q && q.get("entry.326955045"), code: visualleet.code() };
    });
    check("leetcode", "Report a problem: shows the details it adds, needs a message, opens the prefilled Google Form",
      report.shownOpen && report.blocked && report.closed && report.host === "docs.google.com" && /Problem: .*\(two-sum\)/.test(report.details) &&
      report.what && report.what.startsWith("The arrows look wrong\n\n--- Details ---\nProblem:") && /--- Code( \(first 3000 characters\))? ---\n/.test(report.what) && report.what.includes(" ---\n" + report.code.slice(0, 40)),
      { shownOpen: report.shownOpen, blocked: report.blocked, closed: report.closed, host: report.host, details: report.details });
    const tc1 = await toastFor("/problems/two-sum/?panel=none");
    check("leetcode", "Testcase tab not open: explained on LeetCode itself, no extra options", !!tc1 && /Testcase tab, and that tab isn't open/.test(tc1.text) && !tc1.action, tc1);
    await page.bringToFront();
    await lc.close();
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
  await example("BFS");     // 58 steps: enough for 40 real "Next" steps (Two Sum ends early, so clicks did nothing)
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
  check("lifecycle", "Closing the LeetScope tab disposes its Python workers", workersAfter === 0, { workersBefore, workersAfter });

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
