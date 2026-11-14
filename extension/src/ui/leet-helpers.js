// Python source for the hidden setup code of LeetCode problems. Runs
// untraced before the user's code (tracer option "visualleet_setup"), and
// the names it defines are hidden from the visualization, except the test
// inputs. Composed per problem by harness.js.
//
// Node classes match LeetCode's definitions (the commented-out ones in its
// Python3 starter code), so user code that builds nodes works unchanged.

// What LeetCode's Python3 environment provides without imports.
export const PY_IMPORTS = `from typing import *
import collections, heapq, bisect, math, itertools, functools, string, re, random, operator
from collections import *
from heapq import *
from bisect import *
from math import *
from itertools import *
from functools import *
import json as _vl_json`;

export const PY_HELPERS = {
  // Output in LeetCode's format: [1,2], "abc", true, null, 2.00000.
  leet_str: `def leet_str(x, _depth=0):
    if _depth > 50:
        return "..."
    if x is None:
        return "null"
    if x is True:
        return "true"
    if x is False:
        return "false"
    if isinstance(x, float):
        return "%.5f" % x
    if isinstance(x, int):
        return str(x)
    if isinstance(x, str):
        return _vl_json.dumps(x, ensure_ascii=False)
    if isinstance(x, (list, tuple, deque)):
        return "[" + ",".join(leet_str(e, _depth + 1) for e in x) + "]"
    if hasattr(x, "val") and hasattr(x, "left") and hasattr(x, "right"):
        return leet_str(tree_values(x), _depth + 1)
    if hasattr(x, "val") and hasattr(x, "next") and not hasattr(x, "random"):
        return leet_str(list_values(x), _depth + 1)
    if isinstance(x, (set, frozenset)):
        return "[" + ",".join(sorted(leet_str(e, _depth + 1) for e in x)) + "]"
    if isinstance(x, dict):
        return "{" + ",".join(leet_str(k, _depth + 1) + ":" + leet_str(v, _depth + 1) for k, v in x.items()) + "}"
    return str(x)

def list_values(head, limit=10000):
    out = []
    while head is not None and len(out) < limit:
        out.append(head.val)
        head = head.next
    return out

def tree_values(root, limit=10000):
    out, queue, i = [], [root], 0
    while i < len(queue) and len(out) < limit:
        node = queue[i]
        i += 1
        if node is None:
            out.append(None)
        else:
            out.append(node.val)
            queue.append(node.left)
            queue.append(node.right)
    while out and out[-1] is None:
        out.pop()
    return out`,

  ListNode: `class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def build_list(values):
    head = None
    for v in reversed(values):
        head = ListNode(v, head)
    return head`,

  TreeNode: `class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def build_tree(values):
    if not values or values[0] is None:
        return None
    root = TreeNode(values[0])
    queue, i = deque([root]), 1
    while queue and i < len(values):
        node = queue.popleft()
        if i < len(values) and values[i] is not None:
            node.left = TreeNode(values[i])
            queue.append(node.left)
        i += 1
        if i < len(values) and values[i] is not None:
            node.right = TreeNode(values[i])
            queue.append(node.right)
        i += 1
    return root

def find_node(root, val):
    stack = [root]
    while stack:
        node = stack.pop()
        if node is None:
            continue
        if node.val == val:
            return node
        stack.append(node.left)
        stack.append(node.right)
    return None`,

  // Linked List Cycle: LeetCode's "pos" links the tail back to node #pos.
  CycleList: `def build_cycle_list(values, pos):
    head = build_list(values)
    if pos is not None and pos >= 0 and head is not None:
        target, tail, i = None, head, 0
        node = head
        while node is not None:
            if i == pos:
                target = node
            tail = node
            node = node.next
            i += 1
        tail.next = target
    return head`,

  // Copy List with Random Pointer: [[val, random_index], ...]
  RandomList: `class Node:
    def __init__(self, x, next=None, random=None):
        self.val = int(x)
        self.next = next
        self.random = random

def build_random_list(pairs):
    nodes = [Node(v) for v, _ in pairs]
    for i, (_, r) in enumerate(pairs):
        if i + 1 < len(nodes):
            nodes[i].next = nodes[i + 1]
        nodes[i].random = nodes[r] if r is not None else None
    return nodes[0] if nodes else None

def random_list_values(head):
    nodes, index = [], {}
    while head is not None and len(nodes) < 10000:
        index[id(head)] = len(nodes)
        nodes.append(head)
        head = head.next
    return [[n.val, index.get(id(n.random)) if n.random is not None else None] for n in nodes]`,

  // Clone Graph: adjacency list, node i+1 has neighbors adj[i].
  Graph: `class Node:
    def __init__(self, val=0, neighbors=None):
        self.val = val
        self.neighbors = neighbors if neighbors is not None else []

def build_graph(adj):
    if not adj:
        return None
    nodes = [Node(i + 1) for i in range(len(adj))]
    for i, ns in enumerate(adj):
        nodes[i].neighbors = [nodes[j - 1] for j in ns]
    return nodes[0]

def graph_values(node):
    if node is None:
        return []
    seen, queue = {node.val: node}, [node]
    while queue:
        cur = queue.pop()
        for n in cur.neighbors:
            if n.val not in seen:
                seen[n.val] = n
                queue.append(n)
    return [[n.val for n in seen[v].neighbors] for v in range(1, max(seen) + 1)]`,

  // Design problems: call each operation on the user's object, untraced
  // itself; the user's methods are traced as usual.
  run_ops: `def run_ops(obj, ops, args):
    out = []
    for op, a in zip(ops, args):
        out.append(getattr(obj, op)(*a))
    return out`,
};

// Helpers each one needs first.
export const HELPER_DEPS = {
  leet_str: [],
  ListNode: [],
  TreeNode: [],
  CycleList: ["ListNode"],
  RandomList: [],
  Graph: [],
  run_ops: [],
};

/** Setup source with the imports and the given helpers (dependencies first, each once). */
export function helperSource(names) {
  const order = [];
  const add = (n) => {
    if (!(n in PY_HELPERS)) throw new Error("Unknown helper " + n);
    for (const d of HELPER_DEPS[n] || []) add(d);
    if (!order.includes(n)) order.push(n);
  };
  for (const n of ["leet_str", ...names]) add(n);
  return [PY_IMPORTS, ...order.map((n) => PY_HELPERS[n])].join("\n\n");
}
