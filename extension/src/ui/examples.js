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

// Programs that put many different diagrams on screen at once, to see how
// the visualizer lays out lists, trees, graphs, grids, objects and pointers.
export const SHOWCASE_EXAMPLES = {
  "Everything at once": {
    setup: "",
    solution: `# One program, many shapes. Step through and watch each one appear:
# a linked list, a binary tree, a graph, a 2D grid, a stack, a queue,
# a set, a tuple, a dict of lists, then aliasing and a cycle at the end.
from collections import deque

class Node:
    def __init__(self, val, next=None):
        self.val = val
        self.next = next

class TreeNode:
    def __init__(self, val, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

head = Node(1, Node(2, Node(3)))                       # linked list 1 -> 2 -> 3
root = TreeNode(4, TreeNode(2, TreeNode(1), TreeNode(3)), TreeNode(6))
graph = {"A": ["B", "C"], "B": ["D"], "C": ["D"], "D": []}
grid = [[0, 1, 0], [0, 0, 1], [1, 0, 0]]
stack = [10, 20, 30]
queue = deque(["x", "y"])
seen = {"A", "B"}
point = (3, 4)
buckets = {"even": [2, 4], "odd": [1, 3]}

alias = grid[0]          # alias and grid[0] are the SAME list
alias[0] = 9             # ...so this changes grid too
tail = head.next.next
tail.next = head         # the linked list now loops back to the start`,
    call: `print("built", len(graph), "graph nodes")`,
  },
  "LRU cache (dict + doubly linked list)": {
    setup: "",
    solution: `# Lots of pointers: a dict maps keys to nodes, and the nodes form a
# doubly linked list (prev and next) between two sentinel nodes.
# Watch get() move a node to the back and put() evict the oldest.
class DNode:
    def __init__(self, key, val):
        self.key = key
        self.val = val
        self.prev = None
        self.next = None

class LRUCache:
    def __init__(self, capacity):
        self.capacity = capacity
        self.map = {}
        self.head = DNode(0, 0)
        self.tail = DNode(0, 0)
        self.head.next = self.tail
        self.tail.prev = self.head

    def _remove(self, node):
        node.prev.next = node.next
        node.next.prev = node.prev

    def _append(self, node):
        node.prev = self.tail.prev
        node.next = self.tail
        self.tail.prev.next = node
        self.tail.prev = node

    def get(self, key):
        if key not in self.map:
            return -1
        node = self.map[key]
        self._remove(node)
        self._append(node)
        return node.val

    def put(self, key, val):
        if key in self.map:
            self._remove(self.map[key])
        node = DNode(key, val)
        self.map[key] = node
        self._append(node)
        if len(self.map) > self.capacity:
            oldest = self.head.next
            self._remove(oldest)
            del self.map[oldest.key]`,
    call: `cache = LRUCache(2)
cache.put(1, "one")
cache.put(2, "two")
print(cache.get(1))
cache.put(3, "three")   # evicts key 2
print(cache.get(2))`,
  },
  "Tree traversal with a stack": {
    setup: HELPERS["Binary tree (TreeNode)"],
    solution: `# A 7-node tree plus a stack of node references. Watch the stack grow
# down the left side, then pop back up as values are added to out.
def inorder(root):
    out, stack, node = [], [], root
    while stack or node:
        while node:
            stack.append(node)
            node = node.left
        node = stack.pop()
        out.append(node.val)
        node = node.right
    return out`,
    call: `root = build_tree([4, 2, 6, 1, 3, 5, 7])
print(inorder(root))`,
  },
  "Graph BFS with distances": {
    setup: "",
    solution: `# A graph (dict of lists), a queue, and two dicts filled in as the
# search spreads out: dist (steps from the start) and parent (the way back).
def bfs(graph, start):
    dist = {start: 0}
    parent = {start: None}
    queue = [start]
    head = 0
    while head < len(queue):
        node = queue[head]
        head += 1
        for nxt in graph[node]:
            if nxt not in dist:
                dist[nxt] = dist[node] + 1
                parent[nxt] = node
                queue.append(nxt)
    return dist, parent`,
    call: `graph = {
    "A": ["B", "C"],
    "B": ["A", "D", "E"],
    "C": ["A", "F"],
    "D": ["B"],
    "E": ["B", "F"],
    "F": ["C", "E"],
}
dist, parent = bfs(graph, "A")
print(dist)`,
  },
  "Grid DP (unique paths)": {
    setup: "",
    solution: `# A 2D table filled one cell at a time: each cell is the sum of the
# cell above and the cell to the left. Watch the rows fill in.
def unique_paths(rows, cols):
    dp = [[1] * cols for _ in range(rows)]
    for r in range(1, rows):
        for c in range(1, cols):
            dp[r][c] = dp[r - 1][c] + dp[r][c - 1]
    return dp`,
    call: `table = unique_paths(4, 5)
print(table[-1][-1])`,
  },
};

// Programs that crash or give a wrong answer, to see how LeetScope shows
// each kind of failure. The first comment says what to look for.
export const ERROR_EXAMPLES = {
  "IndexError: off by one": {
    setup: "",
    solution: `# Crash: the loop runs one index too far.
# Watch i reach len(nums) on the red line.
def total(nums):
    s = 0
    for i in range(len(nums) + 1):
        s += nums[i]
    return s`,
    call: `print(total([3, 1, 4]))`,
  },
  "KeyError: missing key": {
    setup: "",
    solution: `# Crash: counts[w] += 1 on a word that isn't in the dict yet.
# Fix: counts[w] = counts.get(w, 0) + 1
def word_count(words):
    counts = {}
    for w in words:
        counts[w] += 1
    return counts`,
    call: `print(word_count(["a", "b", "a"]))`,
  },
  "AttributeError: walked off the list": {
    setup: HELPERS["Linked list (ListNode)"],
    solution: `# Crash: the loop runs until cur is None, then reads None.val.
# Watch the cur arrow move along the nodes and fall off the end.
# Fix: loop while cur.next is not None.
def last_value(head):
    cur = head
    while cur is not None:
        cur = cur.next
    return cur.val`,
    call: `head = build_list([1, 2, 3])
print(last_value(head))`,
  },
  "ZeroDivisionError: empty input": {
    setup: "",
    solution: `# Crash: the average of an empty list divides by zero.
def average(nums):
    return sum(nums) / len(nums)`,
    call: `print(average([4, 8]))
print(average([]))`,
  },
  "TypeError: str + int": {
    setup: "",
    solution: `# Crash: joining text and a number without str().
def label(name, score):
    return name + ": " + score`,
    call: `print(label("Ada", 42))`,
  },
  "NameError: typo": {
    setup: "",
    solution: `# Crash: 'reslt' was never defined (typo for 'result').
def squares(n):
    result = []
    for i in range(n):
        result.append(i * i)
    return reslt`,
    call: `print(squares(4))`,
  },
  "SyntaxError: missing colon": {
    setup: "",
    solution: `# Doesn't start: the for line is missing its colon.
def two_sum(nums, target):
    seen = {}
    for i, n in enumerate(nums)
        if target - n in seen:
            return [seen[target - n], i]
        seen[n] = i`,
    call: `print(two_sum([2, 7, 11, 15], 9))`,
  },
  "RecursionError: no base case": {
    setup: "",
    solution: `# Never stops: fact() has no base case, so frames pile up.
# Watch the frame stack grow. Real Python gives up after ~1000
# frames; the depth guard below stops at 12 so the trace stays small.
def fact(n, depth=0):
    if depth == 12:  # demo guard, not part of the bug
        raise RecursionError("maximum recursion depth exceeded")
    return n * fact(n - 1, depth + 1)`,
    call: `print(fact(4))`,
  },
  "Infinite loop: forgot to advance": {
    setup: "",
    solution: `# Never stops: i is never increased, so the loop repeats forever
# and the run ends at the step limit.
def find(nums, target):
    i = 0
    while i < len(nums):
        if nums[i] == target:
            return i
    return -1`,
    call: `print(find([5, 6, 7], 7))`,
  },
  "Bug: shared rows in a grid": {
    setup: "",
    solution: `# Wrong answer, no crash: [[0] * 3] * 3 makes three references to
# ONE row. Watch all three grid arrows point at the same list.
def make_grid(n):
    grid = [[0] * n] * n
    grid[0][0] = 1
    return grid`,
    call: `print(make_grid(3))`,
  },
  "Bug: mutable default argument": {
    setup: "",
    solution: `# Wrong answer: the default list is created once and shared by
# every call, so items pile up between calls.
def add_item(item, bucket=[]):
    bucket.append(item)
    return bucket`,
    call: `print(add_item("a"))
print(add_item("b"))`,
  },
  "Bug: removing while iterating": {
    setup: "",
    solution: `# Wrong answer: removing from a list while looping over it skips
# the element after each removal. Expected [1, 3, 5].
def drop_evens(nums):
    for n in nums:
        if n % 2 == 0:
            nums.remove(n)
    return nums`,
    call: `print(drop_evens([1, 2, 4, 3, 6, 5]))`,
  },
  "Bug: binary search off by one": {
    setup: "",
    solution: `# Wrong answer: hi starts at len(nums) - 2, so the last element
# is never checked. Watch lo/hi close in without reaching it.
def search(nums, target):
    lo, hi = 0, len(nums) - 2
    while lo <= hi:
        mid = (lo + hi) // 2
        if nums[mid] == target:
            return mid
        if nums[mid] < target:
            lo = mid + 1
        else:
            hi = mid - 1
    return -1`,
    call: `print(search([1, 3, 5, 7, 9], 9))`,
  },
};
