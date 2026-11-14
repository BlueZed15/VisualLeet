r"""The forked tracer must produce exactly the original tracer's output.

Run from the workspace root:
  .venv\Scripts\python.exe -m unittest discover -s extension\tests -p "test_*.py"
"""
import json, os, subprocess, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ARCHIVE = os.path.join(HERE, "..", "..", "OnlinePythonTutor-Backup", "v5-unity")
FORK = os.path.join(HERE, "..", "src", "python")


# The fork deliberately hides two class attributes Python 3.13 added
# (__firstlineno__, __static_attributes__); drop them from the original's
# output so everything else must still match exactly.
HIDDEN_313 = {"__firstlineno__", "__static_attributes__"}


def without_313_class_attrs(trace_json):
    """Drop those attributes (and the objects only they point to), then
    renumber object IDs by first appearance, so the original's extra object
    doesn't shift every later ID."""
    data = json.loads(trace_json)
    for step in data["trace"]:
        heap = step.get("heap") or {}
        dropped = set()
        for obj in heap.values():
            if isinstance(obj, list) and obj and obj[0] == "CLASS":
                keep = []
                for kv in obj[3:]:
                    if isinstance(kv, list) and kv and kv[0] in HIDDEN_313:
                        v = kv[1]
                        if isinstance(v, list) and len(v) == 2 and v[0] == "REF":
                            dropped.add(str(v[1]))
                    else:
                        keep.append(kv)
                obj[3:] = keep
        referenced = set()
        def collect(x):
            if isinstance(x, list):
                if len(x) == 2 and x[0] == "REF":
                    referenced.add(str(x[1]))
                for y in x:
                    collect(y)
            elif isinstance(x, dict):
                for y in x.values():
                    collect(y)
        collect({k: v for k, v in step.items() if k != "heap"})
        collect(list(heap.values()))
        for k in dropped - referenced:
            heap.pop(k, None)
    ids = {}
    def canon(n):
        return ids.setdefault(n, len(ids) + 1)
    def walk(x, key=None):
        if isinstance(x, list):
            if len(x) == 2 and x[0] == "REF" and isinstance(x[1], int):
                return ["REF", canon(x[1])]
            return [walk(y) for y in x]
        if isinstance(x, dict):
            if key == "heap":
                return {str(canon(int(k))): walk(v) for k, v in x.items()}
            return {k: walk(v, k) for k, v in x.items()}
        return x
    return json.dumps(walk(data), separators=(",", ":"))


def dump(tracer_dir, cache):
    # fixed hash seed: set/dict-of-str iteration order must not vary per process
    env = dict(os.environ, PYTHONHASHSEED="0")
    res = subprocess.run([sys.executable, os.path.join(HERE, "dump_traces.py"), tracer_dir, cache],
                         capture_output=True, text=True, timeout=300, env=env)
    if res.returncode != 0:
        raise AssertionError(res.stderr)
    return json.loads(res.stdout)


class TracerEquivalence(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.original = dump(ARCHIVE, "default")
        cls.cached = dump(FORK, "1")
        cls.uncached = dump(FORK, "0")

    def check(self, other, label):
        self.assertEqual(sorted(self.original), sorted(other))
        for name in self.original:
            with self.subTest(program=name, variant=label):
                self.assertEqual(without_313_class_attrs(self.original[name]), without_313_class_attrs(other[name]))

    def test_fork_with_cache_matches_original(self):
        self.check(self.cached, "cache on")

    def test_fork_without_cache_matches_original(self):
        self.check(self.uncached, "cache off")

    def test_programs_finish_as_expected(self):
        last = {n: json.loads(t)["trace"][-1] for n, t in self.cached.items()}
        self.assertEqual(last["bfs"]["stdout"], "['A', 'B', 'C', 'D']\n")
        self.assertEqual(last["sliding"]["stdout"], "3\n")
        self.assertIn("ZeroDivisionError", last["exceptions"].get("exception_msg", ""))
        self.assertEqual(last["stress_1000_list100"]["event"], "instruction_limit_reached")


if __name__ == "__main__":
    unittest.main()
