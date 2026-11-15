// node --test tests/
import test from "node:test";
import assert from "node:assert/strict";
import { composeSource, hasTopLevelCode, parseExampleInput, toPythonLiteral, findSolutionMethod, draftForSolution, describeLanguage } from "../src/ui/prepare.js";

test("composeSource keeps the parts in order and skips empty ones", () => {
  assert.equal(composeSource({ setup: "import x  \n\n", solution: "def f():\n    return 1", call: "print(f())" }),
    "import x\n\ndef f():\n    return 1\n\nprint(f())\n");
  assert.equal(composeSource({ setup: "", solution: "  ", call: "print(1)" }), "print(1)\n");
  assert.equal(composeSource({}), "");
});

test("hasTopLevelCode detects definition-only programs", () => {
  assert.equal(hasTopLevelCode("class Solution:\n    def f(self):\n        return 1\n"), false);
  assert.equal(hasTopLevelCode("from typing import List\n# comment\n@dec\ndef f():\n    pass\n"), false);
  assert.equal(hasTopLevelCode("def f():\n    pass\nprint(f())\n"), true);
  assert.equal(hasTopLevelCode('def f():\n    """doc\nnot code at col 0\n"""\n    pass\n'), false);
  assert.equal(hasTopLevelCode("graph = {}\n"), true);
});

test("example inputs: one per line or comma-separated", () => {
  assert.deepEqual(parseExampleInput("nums = [2, 7, 11, 15]\ntarget = 9"), [{ name: "nums", value: "[2, 7, 11, 15]" }, { name: "target", value: "9" }]);
  assert.deepEqual(parseExampleInput("nums = [2,7,11,15], target = 9"), [{ name: "nums", value: "[2,7,11,15]" }, { name: "target", value: "9" }]);
  assert.deepEqual(parseExampleInput('s = "a, b = c", k = 2'), [{ name: "s", value: '"a, b = c"' }, { name: "k", value: "2" }]);
  assert.equal(parseExampleInput("[1,2,3]"), null);
});

test("JSON literals become Python, but not inside strings", () => {
  assert.equal(toPythonLiteral("[1,null,2,true,false]"), "[1,None,2,True,False]");
  assert.equal(toPythonLiteral('"null true"'), '"null true"');
  assert.equal(toPythonLiteral("nullable"), "nullable");
});

test("finds the Solution method and its typed parameters", () => {
  const code = "class Solution:\n    def _helper(self):\n        pass\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        pass\n";
  assert.deepEqual(findSolutionMethod(code), { name: "twoSum", returns: "List[int]",
    params: [{ name: "nums", annotation: "List[int]" }, { name: "target", annotation: "int" }] });
  assert.equal(findSolutionMethod("def f(): pass"), null);
});

test("drafts a test call from LeetCode's Two Sum", () => {
  const code = "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        pass\n";
  const d = draftForSolution(code, ["nums = [2, 7, 11, 15]\ntarget = 9"]);
  assert.equal(d.call, "nums = [2, 7, 11, 15]\ntarget = 9\nprint(Solution().twoSum(nums, target))");
  assert.match(d.setup, /from typing import List/);
});

test("linked-list problems get helpers and explicit conversions", () => {
  const code = "# Definition for singly-linked list.\n# class ListNode:\n#     ...\nclass Solution:\n    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:\n        pass\n";
  const d = draftForSolution(code, ["head = [1,2,3,4,5]"]);
  assert.equal(d.call, "head = build_list([1,2,3,4,5])\nprint(list_values(Solution().reverseList(head)))");
  assert.match(d.setup, /class ListNode/);
  assert.match(d.setup, /def build_list/);
});

test("tree problems convert null to None and use build_tree", () => {
  const code = "class Solution:\n    def maxDepth(self, root: Optional[TreeNode]) -> int:\n        pass\n";
  const d = draftForSolution(code, ["root = [3,9,20,null,null,15,7]"]);
  assert.equal(d.call, "root = build_tree([3,9,20,None,None,15,7])\nprint(Solution().maxDepth(root))");
});

test("helpers the solution already defines are not added again", () => {
  const code = "class ListNode:\n    pass\nclass Solution:\n    def f(self, head: ListNode) -> int:\n        pass\n";
  assert.doesNotMatch(draftForSolution(code, []).setup, /class ListNode/);
});

test("without examples the call has TODO values", () => {
  const d = draftForSolution("class Solution:\n    def f(self, x: int) -> int:\n        pass\n", []);
  assert.match(d.call, /x = \.\.\.  # TODO/);
});

test("non-Python editors are refused with an explanation", () => {
  assert.equal(describeLanguage("python3").ok, true);
  assert.equal(describeLanguage("cpp").ok, false);
  assert.match(describeLanguage("cpp").note, /LeetScope runs Python 3/);
});
