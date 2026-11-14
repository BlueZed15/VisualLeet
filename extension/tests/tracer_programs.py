"""Programs for tracer equivalence tests: bench fixtures plus cache edge cases."""
import os, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "bench"))
from fixtures import FIXTURES

EDGE = {
"list_mutation": '''a = [3, 1, 2]
a[1] = 5
a.sort()
a.reverse()
a.append(a[0])
a.pop()
a[0], a[1] = a[1], a[0]
print(a)
''',
"equal_but_new_objects": '''a = [[1], [1]]
b = a[0]
a[0] = [1]
a[1] = b
print(a, a[0] is b)
''',
"grid_inner_mutation": '''m = [[0] * 3 for _ in range(3)]
for i in range(3):
    m[i][(i + 1) % 3] = i
row = m[1]
row[0] = 9
print(m)
''',
"dict_changes": '''d = {"a": 1}
d["a"] = 2
del d["a"]
d["a"] = 2
d[(1, 2)] = [1]
d[(1, 2)].append(2)
memo = {}
for i in range(4):
    memo[(i, i + 1)] = i * 2
print(d, memo)
''',
"instances": '''class P:
    def __init__(self, x):
        self.x = x
class Pretty:
    def __init__(self, v):
        self.v = v
    def __str__(self):
        return "Pretty(%d)" % self.v
class R:
    def __init__(self):
        self.n = 0
    def __repr__(self):
        return "R(%d)" % self.n
p = P(1)
p.x = 2
p.y = [p]
q = Pretty(1)
q.v = 5
r = R()
r.n = 3
items = [p, q, r]
items[2].n = 4
print(p.x, q, r)
''',
"tuple_set": '''t = ([1], 2)
t[0].append(3)
s = {1, 2}
s.add(3)
s.discard(1)
s.add(1)
fs = frozenset([1, 2])
print(t, sorted(s), fs)
''',
"id_reuse": '''x = None
for i in range(5):
    x = [i]
    y = {i: x}
print(x, y)
''',
"del_finalizer": '''class D:
    def __init__(self, name):
        self.name = name
    def __del__(self):
        print("del", self.name)
x = D("a")
lst = [D("b")]
x = None
lst.pop()
print("after")
''',
"user_key_eq": '''class K:
    def __init__(self, v):
        self.v = v
    def __eq__(self, other):
        print("eq called")
        return isinstance(other, K) and other.v == self.v
    def __hash__(self):
        return hash(self.v)
d = {K(1): "one"}
d[K(2)] = "two"
print(len(d))
''',
"closures_functions": '''def make(n):
    def add(x):
        return x + n
    return add
fs = [make(1), make(2)]
fs.append(lambda z: z * 2)
total = 0
for f in fs:
    total += f(3)
print(total)
''',
"stdlib": '''from collections import Counter, deque, defaultdict
import heapq, bisect
c = Counter("abracadabra")
q = deque([1, 2])
q.appendleft(0)
q.pop()
dd = defaultdict(list)
dd["a"].append(1)
h = []
for v in [5, 1, 4]:
    heapq.heappush(h, v)
smallest = heapq.heappop(h)
arr = [1, 3, 5]
bisect.insort(arr, 4)
print(c.most_common(1), list(q), dict(dd), smallest, arr)
''',
"exceptions": '''def f(n):
    if n == 0:
        raise ValueError("zero")
    return 10 // n
out = []
for n in [2, 0, 5]:
    try:
        out.append(f(n))
    except ValueError as e:
        out.append(str(e))
print(out)
x = 1 / 0
''',
"cycles_mutating": '''a = []
a.append(a)
b = {"self": None}
b["self"] = b
a.append(b)
b["a"] = a
a.pop()
print(len(a), len(b))
''',
}

PROGRAMS = dict(FIXTURES)
PROGRAMS.update(EDGE)
