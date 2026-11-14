// Screenshots of the real extension UI in each state (for design review).
// Loads dist/extension into headless Chrome (fresh temp profile) and drives
// it through its test hooks: starting, empty, complete, limit reached, needs
// input, syntax error, running, stopped, timed out, an error notice over a
// trace, diagnostics, and a narrow window.
//
//   npm run build:extension-dev
//   node scripts/shoot-states.mjs [--out <dir>] [--only state,state]
import puppeteer from "puppeteer-core";
import { mkdtemp, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const outDir = path.resolve(arg("--out", path.join(root, "acceptance", "states")));
const only = arg("--only", "") ? new Set(arg("--only", "").split(",")) : null;
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: arg("--chrome", "C:/Program Files/Google/Chrome/Application/chrome.exe"),
  headless: true, pipe: true, enableExtensions: true,
  userDataDir: await mkdtemp(path.join(os.tmpdir(), "visualleet-states-")),
  defaultViewport: { width: 1400, height: 860 },
});
const LONG = "x = sum(range(10**10))\nprint(x)\n";     // a native loop: only Stop or the watchdog ends it
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

try {
  const id = await browser.installExtension(path.join(root, "dist", "extension-dev"));
  const page = await browser.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const shot = async (name) => {
    if (only && !only.has(name)) return;
    await sleep(900);                                   // line-arrow animations take up to ~450 ms
    await page.screenshot({ path: path.join(outDir, name + ".png") });
    console.log("wrote", name + ".png", "|", (await ev(() => visualleet.status())), "|", (await ev(() => visualleet.message())).replace(/\n/g, " / ").slice(0, 120));
  };
  const runParts = (parts) => ev(async (p) => { await visualleet.whenReady(); visualleet.setProgram(p); return (await visualleet.visualize()).status; }, parts);
  const example = (name, step) => ev(async (n, s) => {
    await visualleet.whenReady();
    const sel = document.getElementById("example"); sel.value = n; sel.dispatchEvent(new Event("change"));
    await visualleet.visualize();
    if (s !== undefined) visualleet.rendered().viz.renderStep(s);
  }, name, step);

  await page.goto(`chrome-extension://${id}/ui/index.html`, { waitUntil: "domcontentloaded" });
  if (!only || only.has("starting")) { await page.screenshot({ path: path.join(outDir, "starting.png") }); console.log("wrote starting.png"); }
  await ev(() => visualleet.whenReady());
  await shot("empty");

  await example("BFS", 20);
  await shot("complete");

  await ev(() => visualleet.importFrom("selection"));          // no source tab in automation: an error notice
  await shot("notice-error");

  await ev(() => document.getElementById("diag-toggle").click());
  await shot("diagnostics");
  await ev(() => document.getElementById("diag-toggle").click());

  await runParts({ setup: "", solution: "i = 0\nwhile True:\n    i += 1\n", call: "", inputs: "" });
  await shot("limit-reached");

  await runParts({ setup: "", solution: 'a = input("first? ")\nb = input("second? ")\nprint(a, b)\n', call: "", inputs: "1" });
  await shot("needs-input");

  await runParts({ setup: "", solution: "def f(:\n    pass\n\nf()\n", call: "", inputs: "" });
  await shot("syntax-error");

  await example("Linked list");
  await ev((src) => { visualleet.setProgram({ setup: "", solution: src, call: "", inputs: "" }); window.__run = visualleet.visualize(); }, LONG);
  await sleep(500);
  await shot("running");
  await ev(async () => { visualleet.stop(); await window.__run; });
  await shot("stopped");

  if (!only || only.has("timed-out")) {
    await ev(async (src) => { await visualleet.whenReady(); visualleet.setProgram({ setup: "", solution: src, call: "", inputs: "" }); await visualleet.visualize(); }, LONG);
    await shot("timed-out");
  }

  // LeetCode mode: what an icon click on a problem page hands over (as the page reader returns it)
  const fromPage = (slug, extra) => Object.assign({ ok: true, slug, language: "python3", selectedIndex: 0, selectedCase: [] }, extra);
  const twoSum = fromPage("two-sum", {
    title: "Two Sum", frontendId: "1", anyOrder: true,
    exampleInputs: ["[2,7,11,15]\n9", "[3,2,4]\n6", "[3,3]\n6"], exampleOutputs: ["[0,1]", "[1,2]", "[0,1]"],
    code: "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        seen = {}\n        for i, n in enumerate(nums):\n            if target - n in seen:\n                return [seen[target - n], i]\n            seen[n] = i",
  });
  await page.setViewport({ width: 1400, height: 860 });
  await ev(async (r) => { await visualleet.openLeetCode(Object.assign({}, r, { selectedIndex: 1, selectedCase: [{ name: "nums", text: "[3,2,4]" }, { name: "target", text: "6" }] }), { autoRun: true }); visualleet.rendered().viz.renderStep(9); }, twoSum);
  await shot("lc-two-sum-match");

  await ev(async (r) => { await visualleet.openLeetCode(Object.assign({}, r, { code: r.code.replace("return [seen[target - n], i]", "return [i, i]"), selectedCase: [{ name: "nums", text: "[3,2,4]" }, { name: "target", text: "6" }] }), { autoRun: true }); }, twoSum);
  await shot("lc-two-sum-mismatch");

  await ev(async (r) => { await visualleet.openLeetCode(Object.assign({}, r, { selectedCase: [{ name: "nums", text: "[1,5,9" }, { name: "target", text: "10" }] }), { autoRun: true }); }, twoSum);
  await shot("lc-bad-value");

  await ev(async (r) => { await visualleet.openLeetCode(r, { autoRun: true }); const v = visualleet.rendered().viz; v.renderStep(Math.floor(v.curTrace.length * 0.6)); }, fromPage("reverse-linked-list", {
    title: "Reverse Linked List", frontendId: "206", exampleInputs: ["[1,2,3,4,5]", "[1,2]", "[]"], exampleOutputs: ["[5,4,3,2,1]", "[2,1]", "[]"],
    selectedCase: [{ name: "head", text: "[1,2,3,4,5]" }],
    code: "class Solution:\n    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        prev = None\n        while head:\n            nxt = head.next\n            head.next = prev\n            prev = head\n            head = nxt\n        return prev",
  }));
  await shot("lc-linked-list");

  await ev(async (r) => { await visualleet.openLeetCode(r, { autoRun: true }); }, fromPage("lru-cache", {
    title: "LRU Cache", frontendId: "146",
    exampleInputs: ['["LRUCache","put","put","get","put","get","put","get","get","get"]\n[[2],[1,1],[2,2],[1],[3,3],[2],[4,4],[1],[3],[4]]'], exampleOutputs: ["[null,null,null,1,null,-1,null,-1,3,4]"],
    code: "class LRUCache:\n    def __init__(self, capacity: int):\n        self.cap = capacity\n        self.data = OrderedDict()\n\n    def get(self, key: int) -> int:\n        if key not in self.data:\n            return -1\n        self.data.move_to_end(key)\n        return self.data[key]\n\n    def put(self, key: int, value: int) -> None:\n        self.data[key] = value\n        self.data.move_to_end(key)\n        if len(self.data) > self.cap:\n            self.data.popitem(last=False)",
  }));
  await shot("lc-design");
  await ev(() => visualleet.setMode("manual"));

  await example("Tree", 30);
  await page.setViewport({ width: 820, height: 1000 });
  await shot("narrow");
} finally {
  await browser.close();
}
