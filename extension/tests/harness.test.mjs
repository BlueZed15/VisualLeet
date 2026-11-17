// LeetCode values/types (src/ui/leet.js), filling database entries
// (src/ui/harness.js) and writing them at build time (scripts/lib/entry-writer.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { parseValue, checkValue, toPython, compareOutputs, LeetNum, describeLanguage, caseProblem } from "../src/ui/leet.js";
import { fill, splitCases, resultLine } from "../src/ui/harness.js";
import { entryFromMeta, safeName } from "../scripts/lib/entry-writer.mjs";

const meta = {
  twoSum: { name: "twoSum", params: [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }], return: { type: "integer[]" } },
  reverseList: { name: "reverseList", params: [{ name: "head", type: "ListNode" }], return: { type: "ListNode" } },
  rotate: { name: "rotate", params: [{ name: "nums", type: "integer[]" }, { name: "k", type: "integer" }], return: { type: "void" }, output: { paramindex: 0 } },
  lru: { classname: "LRUCache", constructor: { params: [{ type: "integer", name: "capacity" }] }, methods: [{ name: "get", params: [{ type: "integer", name: "key" }], return: { type: "integer" } }, { name: "put", params: [{ type: "integer", name: "key" }, { type: "integer", name: "value" }], return: { type: "void" } }], systemdesign: true },
  cycle: { name: "hasCycle", params: [{ name: "head", type: "ListNode" }, { name: "pos", type: "integer" }], return: { type: "boolean" }, manual: true },
};

test("parses LeetCode values, keeping number text exactly", () => {
  assert.ok(parseValue('[2,-7,1e3, "a\\"b", null, true, [ ]]').ok);
  assert.equal(parseValue("123456789012345678901").value.text, "123456789012345678901");
  assert.equal(parseValue("[1,2").ok, false);
  assert.equal(parseValue("[1,2] x").ok, false);
  assert.match(parseValue('"abc').error, /quote/);
});

test("checks values against types with readable errors", () => {
  const v = (t) => parseValue(t).value;
  assert.equal(checkValue(v("[1,2]"), "integer[]"), null);
  assert.match(checkValue(v("[1,2.5]"), "integer[]"), /item 1: should be a whole number/);
  assert.match(checkValue(v("3"), "integer[]"), /should be a list/);
  assert.equal(checkValue(v('[["1","0"]]'), "character[][]"), null);
  assert.match(checkValue(v('[["10"]]'), "character[][]"), /one character/);
  assert.equal(checkValue(v("[1,null,2]"), "TreeNode"), null);
  assert.match(checkValue(v("[1,null,2]"), "ListNode"), /numbers only/);
  assert.equal(checkValue(v("[[7,null],[1,0]]"), "list<list<integer?>>"), null);
  assert.match(checkValue(v("[1]"), "Interval"), /isn't supported/);
});

test("writes Python for each type", () => {
  const v = (t) => parseValue(t).value;
  assert.equal(toPython(v("[1,null,true]"), "list<integer?>"), "[1, None, True]");
  assert.equal(toPython(v("[1,2]"), "ListNode"), "build_list([1, 2])");
  assert.equal(toPython(v("[[1],[2,3]]"), "ListNode[]"), "[build_list([1]), build_list([2, 3])]");
  assert.equal(toPython(v("[3,9,null]"), "TreeNode"), "build_tree([3, 9, None])");
  assert.equal(toPython(v("2"), "double"), "2.0");
});

test("build time: entries written from LeetCode's signature", () => {
  const two = entryFromMeta(meta.twoSum);
  assert.deepEqual(two.boxes, [{ name: "nums", type: "integer[]" }, { name: "target", type: "integer" }]);
  assert.equal(two.setup, "nums = {nums}\ntarget = {target}");
  assert.equal(two.call, "result = Solution().twoSum(nums, target)\nprint(leet_str(result))");
  assert.equal(entryFromMeta(meta.reverseList).call, "result = Solution().reverseList(head)\nprint(leet_str(list_values(result)))");
  assert.equal(entryFromMeta(meta.rotate).call, "Solution().rotate(nums, k)\nprint(leet_str(nums))");
  assert.match(entryFromMeta(meta.cycle).error, /hand-written/);
  const lru = entryFromMeta(meta.lru);
  assert.equal(lru.kind, "design");
  assert.deepEqual(lru.methods.put, [{ name: "key", type: "integer" }, { name: "value", type: "integer" }]);
  assert.equal(safeName("str"), "str_");
  assert.equal(entryFromMeta({ name: "f", params: [{ name: "str", type: "string" }], return: { type: "integer" } }).setup, "str_ = {str}");
});

test("runtime: a file's setup and call are filled with the case", () => {
  const g = fill(entryFromMeta(meta.twoSum), { nums: "[2,7,11,15]", target: "9" });
  assert.ok(g.ok);
  assert.match(g.setup, /^nums = \[2, 7, 11, 15\]$/m);
  assert.match(g.setup, /^target = 9$/m);
  assert.deepEqual(g.visible, ["nums", "target"]);
  assert.equal(g.code, "result = Solution().twoSum(nums, target)\nprint(leet_str(result))");
  const r = fill(entryFromMeta(meta.reverseList), { head: "[1,2,3]" });
  assert.match(r.setup, /class ListNode/);
  assert.match(r.setup, /^head = build_list\(\[1, 2, 3\]\)$/m);
});

test("runtime: hand-written entries fill their slots and helpers", () => {
  const entry = { kind: "template", boxes: [{ name: "head", type: "integer[]" }, { name: "pos", type: "integer" }], helpers: ["CycleList"],
    setup: "head = build_cycle_list({head}, {pos})", visible: ["head"], call: "result = Solution().hasCycle(head)\nprint(leet_str(result))" };
  const g = fill(entry, { head: "[3,2,0,-4]", pos: "1" });
  assert.match(g.setup, /^head = build_cycle_list\(\[3, 2, 0, -4\], 1\)$/m);
  assert.match(g.setup, /class ListNode/);      // dependency of CycleList
});

test("runtime: design problems are checked against the class in the file", () => {
  const e = entryFromMeta(meta.lru);
  const ok = fill(e, { operations: '["LRUCache","put","get"]', arguments: "[[2],[1,1],[1]]" });
  assert.ok(ok.ok);
  assert.match(ok.setup, /^ops = \["LRUCache","put","get"\]$/m);
  assert.match(ok.setup, /^args = \[\[2\], \[1, 1\], \[1\]\]$/m);
  assert.match(fill(e, { operations: '["LRUCache","pop"]', arguments: "[[2],[]]" }).errors.operations, /no method "pop"/);
  assert.match(fill(e, { operations: '["LRUCache","put"]', arguments: "[[2],[1]]" }).errors.arguments, /expected 2 arguments, got 1/);
  assert.match(fill(e, { operations: '["put"]', arguments: "[[1,1]]" }).errors.operations, /should start with "LRUCache"/);
  // LeetCode writes [null] for a call with no arguments (Throne Inheritance): same as []
  const t = entryFromMeta({ classname: "Counter", constructor: { params: [] }, methods: [{ name: "inc", params: [], return: { type: "integer" } }], systemdesign: true });
  const nul = fill(t, { operations: '["Counter","inc","inc"]', arguments: "[[],[null],[]]" });
  assert.ok(nul.ok, JSON.stringify(nul.errors));
  assert.match(nul.setup, /^args = \[\[\], \[\], \[\]\]$/m);
});

test("bad values are reported per box, nothing filled", () => {
  const g = fill(entryFromMeta(meta.twoSum), { nums: "[2,7,", target: "" });
  assert.equal(g.ok, false);
  assert.match(g.errors.nums, /Missing/);
  assert.match(g.errors.target, /missing a value/);
});

test("splits LeetCode's raw cases into boxes", () => {
  assert.deepEqual(splitCases(entryFromMeta(meta.twoSum), "[2,7,11,15]\n9\n[3,2,4]\n6\n"), [{ nums: "[2,7,11,15]", target: "9" }, { nums: "[3,2,4]", target: "6" }]);
  assert.equal(resultLine("debug\n[0,1]\n"), "[0,1]");
});

test("compares outputs like LeetCode", () => {
  assert.equal(compareOutputs("[0,1]", "[0,1]"), "match");
  assert.equal(compareOutputs("[0, 1]", "[0,1]"), "match");
  assert.equal(compareOutputs("[1,0]", "[0,1]"), "mismatch");
  assert.equal(compareOutputs("[1,0]", "[0,1]", { anyOrder: true }), "match");
  assert.equal(compareOutputs("2.00000", "2.0"), "match");
  assert.equal(compareOutputs("true", "false"), "mismatch");
  assert.equal(compareOutputs('[["tan","nat"],["bat"]]', '[["bat"],["nat","tan"]]', { anyOrder: true }), "match");
  assert.equal(compareOutputs("[[1,2],[1,2]]", "[[1,2],[2,1]]", { anyOrder: true }), "mismatch");
  assert.equal(compareOutputs("[[2,1],[1,2]]", "[[1,2],[2,1]]", { anyOrder: true }), "match");
  assert.ok(new LeetNum("5").isInteger);
});

test("only Python3 runs; other languages and Python 2 are refused with an explanation", () => {
  assert.equal(describeLanguage("python3").ok, true);
  assert.equal(describeLanguage("python3").note, "");
  assert.equal(describeLanguage("python").ok, false);
  assert.match(describeLanguage("python").note, /set to Python, which is Python 2.*Choose Python3 in the language menu above LeetCode's code editor/);
  assert.equal(describeLanguage("cpp").ok, false);
  assert.match(describeLanguage("cpp").note, /^LeetCode's code editor is set to C\+\+\. LeetScope runs Python 3\./);
  assert.match(describeLanguage("").note, /an unknown language/);
});

test("test case messages: neither tab, Test Result unreadable, Testcase empty or wrong count", () => {
  assert.match(caseProblem({ from: "", inputs: 0, empty: 0 }, 2), /^LeetScope reads the test case from LeetCode's Testcase tab, or from Test Result after you press Run, and neither is showing one\. .*or press Run, then click Visualize again\.$/);
  assert.match(caseProblem(null, 2), /neither is showing one/);
  assert.match(caseProblem({ from: "test-result", inputs: 2, empty: 1 }, 2), /^LeetScope couldn't read the input values in LeetCode's Test Result\. Open the Testcase tab, select the case, and click Visualize again\.$/);
  assert.match(caseProblem({ from: "test-result", inputs: 3, empty: 0 }, 2), /found 3 inputs in LeetCode's Test Result, and this problem takes 2 inputs\./);
  assert.match(caseProblem({ from: "testcase", inputs: 2, empty: 1 }, 2), /Testcase tab has an empty input\. Fill it in/);
  assert.match(caseProblem({ from: "testcase", inputs: 1, empty: 0 }, 2), /Testcase tab has 1 input, and this problem takes 2 inputs\. Select the case again and click Visualize\.$/);
});
