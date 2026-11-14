FIXTURES = {
"bfs": '''def bfs(graph, start):
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
''',
"sliding": '''def longest_unique_substring(s):
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
''',
"small_list_200": '''data = list(range(10))
total = 0
for i in range(200):
    total += i
print(total)
''',
"big_list_200": '''data = list(range(2000))
total = 0
for i in range(200):
    total += i
print(total)
''',
"lcs_dp": '''def lcs(a, b):
    dp = [[0] * (len(b) + 1) for _ in range(len(a) + 1)]
    for i in range(1, len(a) + 1):
        for j in range(1, len(b) + 1):
            if a[i-1] == b[j-1]:
                dp[i][j] = dp[i-1][j-1] + 1
            else:
                dp[i][j] = max(dp[i-1][j], dp[i][j-1])
    return dp[-1][-1]
print(lcs("ABCBDAB", "BDCABA"))
''',
"linked_list_40": '''class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
head = None
for v in range(40, 0, -1):
    head = ListNode(v, head)
prev, cur = None, head
while cur:
    nxt = cur.next
    cur.next = prev
    prev = cur
    cur = nxt
print(prev.val)
''',
"fib_recursion": '''def fib(n):
    if n < 2:
        return n
    return fib(n-1) + fib(n-2)
print(fib(9))
''',
}
FIXTURES["stress_1000_list100"] = '''data = list(range(100))
i = 0
while True:
    data[i % 100] += 1
    i += 1
'''

FIXTURES["tree_inorder"] = '''class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right

def build(vals, i=0):
    if i >= len(vals) or vals[i] is None:
        return None
    return TreeNode(vals[i], build(vals, 2*i+1), build(vals, 2*i+2))

def inorder(node, out):
    if node:
        inorder(node.left, out)
        out.append(node.val)
        inorder(node.right, out)
    return out

root = build([4, 2, 6, 1, 3, 5, 7])
print(inorder(root, []))
'''
FIXTURES["nested_lists"] = '''t = [[['a', 'b'], ['c', 'd']], [[1, 2], [3, 4]]]
x = [1, [2, [3, None]]]
y = [4, [5, [6, None]]]
x[1][1] = y[1]
print(t, x)
'''
FIXTURES["alias_cycle"] = '''a = [1]
b = a
b.append(2)
c = []
c.append(c)
d = {"k": a, "self": None}
d["self"] = d
print(a, len(c), d["k"] is b)
'''
FIXTURES["big_dict_set"] = '''counts = {}
for i in range(150):
    counts[i] = i * i
s = set(range(130))
total = 0
for k in range(20):
    total += counts[k]
print(total, len(s))
'''
FIXTURES["reverse_linked_list_3"] = '''class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next
head = ListNode(1, ListNode(2, ListNode(3)))
prev, cur = None, head
while cur:
    nxt = cur.next
    cur.next = prev
    prev = cur
    cur = nxt
print(prev.val, prev.next.val, prev.next.next.val)
'''
