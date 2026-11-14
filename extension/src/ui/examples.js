// Starter helpers and examples. Helpers are plain, editable Python that the
// user can insert into Setup; they are not hidden adapters.

export const HELPERS = {
  "Linked list (ListNode)": `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def build_list(values):
    """[1, 2, 3] -> 1 -> 2 -> 3"""
    head = None
    for v in reversed(values):
        head = ListNode(v, head)
    return head

def list_values(head):
    out = []
    while head:
        out.append(head.val)
        head = head.next
    return out`,

  "Binary tree (TreeNode)": `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def build_tree(values):
    """LeetCode level order, e.g. [4, 2, 6, 1, 3, None, 7]"""
    if not values or values[0] is None:
        return None
    root = TreeNode(values[0])
    queue = [root]
    i = 1
    while i < len(values):
        node = queue.pop(0)
        if i < len(values) and values[i] is not None:
            node.left = TreeNode(values[i])
            queue.append(node.left)
        i += 1
        if i < len(values) and values[i] is not None:
            node.right = TreeNode(values[i])
            queue.append(node.right)
        i += 1
    return root`,

  // Implements: isInteger, getInteger, setInteger, add, getList.
  "NestedInteger": `class NestedInteger:
    def __init__(self, value=None):
        self._int = value
        self._list = []

    def isInteger(self):
        return self._int is not None

    def getInteger(self):
        return self._int

    def setInteger(self, value):
        self._int = value

    def add(self, elem):
        self._list.append(elem)

    def getList(self):
        return self._list

def build_nested(value):
    """[1, [4, [6]]] -> list of NestedInteger"""
    def make(v):
        if isinstance(v, int):
            return NestedInteger(v)
        ni = NestedInteger()
        for x in v:
            ni.add(make(x))
        return ni
    return [make(v) for v in value]`,

  "Typing imports": `from typing import List, Optional, Dict, Set, Tuple`,
};

export const EXAMPLES = {
  "Two Sum": {
    setup: HELPERS["Typing imports"],
    solution: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        seen = {}
        for i, n in enumerate(nums):
            if target - n in seen:
                return [seen[target - n], i]
            seen[n] = i`,
    call: `print(Solution().twoSum([2, 7, 11, 15], 9))`,
  },
  "BFS": {
    setup: "",
    solution: `def bfs(graph, start):
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
    return order`,
    call: `graph = {
    "A": ["B", "C"],
    "B": ["A", "D"],
    "C": ["A", "D"],
    "D": ["B", "C"]
}
print(bfs(graph, "A"))`,
  },
  "Sliding window": {
    setup: "",
    solution: `def longest_unique_substring(s):
    seen = set()
    left = 0
    best = 0
    for right in range(len(s)):
        while s[right] in seen:
            seen.remove(s[left])
            left += 1
        seen.add(s[right])
        best = max(best, right - left + 1)
    return best`,
    call: `print(longest_unique_substring("abcabcbb"))`,
  },
  "Recursion": {
    setup: "",
    solution: `def fact(n):
    if n <= 1:
        return 1
    return n * fact(n - 1)`,
    call: `print(fact(5))`,
  },
  "Linked list": {
    setup: HELPERS["Linked list (ListNode)"],
    solution: `class Solution:
    def reverseList(self, head):
        prev = None
        cur = head
        while cur:
            nxt = cur.next
            cur.next = prev
            prev = cur
            cur = nxt
        return prev`,
    call: `head = build_list([1, 2, 3])
print(list_values(Solution().reverseList(head)))`,
  },
  "Tree": {
    setup: HELPERS["Binary tree (TreeNode)"],
    solution: `class Solution:
    def inorderTraversal(self, root):
        out = []
        def walk(node):
            if node:
                walk(node.left)
                out.append(node.val)
                walk(node.right)
        walk(root)
        return out`,
    call: `root = build_tree([4, 2, 6, 1, 3, 5, 7])
print(Solution().inorderTraversal(root))`,
  },
  "NestedInteger": {
    setup: HELPERS["NestedInteger"],
    solution: `def flatten(nested):
    out = []
    for ni in nested:
        if ni.isInteger():
            out.append(ni.getInteger())
        else:
            out.extend(flatten(ni.getList()))
    return out`,
    call: `print(flatten(build_nested([1, [4, [6]]])))`,
  },
  "Dynamic programming": {
    setup: "",
    solution: `def climb_stairs(n):
    dp = [0] * (n + 1)
    dp[0] = 1
    dp[1] = 1
    for i in range(2, n + 1):
        dp[i] = dp[i - 1] + dp[i - 2]
    return dp[n]`,
    call: `print(climb_stairs(6))`,
  },
  "Input()": {
    setup: "",
    solution: `name = input("Your name? ")
times = int(input("How many times? "))
for _ in range(times):
    print("hi", name)`,
    call: "",
    inputs: "Ada\n2",
  },
};
