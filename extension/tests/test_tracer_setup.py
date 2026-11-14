"""Untraced setup code (tracer options visualleet_setup / visualleet_setup_visible)."""
import io, json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src", "python"))
import pg_logger  # the fork

SETUP = """
class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next

def build_list(values):
    head = None
    for v in reversed(values):
        head = ListNode(v, head)
    return head

def run_ops(obj, ops, args):
    return [getattr(obj, op)(*a) for op, a in zip(ops, args)]

head = build_list([1, 2, 3])
nums = [4, 5]
"""


def trace(code, setup=None, visible=()):
    out = {}
    options = {"cumulative_mode": False, "heap_primitives": False, "show_only_outputs": False}
    if setup is not None:
        options.update(visualleet_setup=setup, visualleet_setup_visible=list(visible))
    real = sys.stdout
    sys.stdout = io.StringIO()
    try:
        pg_logger.exec_script_str(code, None, json.dumps(options), lambda c, t: out.setdefault("t", t))
    finally:
        sys.stdout = real
    return out["t"]


def shown_globals(t):
    names = set()
    for step in t:
        names.update((step.get("globals") or {}).keys())
    return names


class Setup(unittest.TestCase):
    def test_setup_is_not_traced_and_helpers_are_hidden(self):
        code = "total = 0\nnode = head\nwhile node:\n    total += node.val\n    node = node.next\nprint(total)\n"
        t = trace(code, SETUP, ["head", "nums"])
        self.assertEqual(t[-1]["stdout"], "6\n")
        names = shown_globals(t)
        self.assertIn("head", names)
        self.assertIn("nums", names)
        for hidden in ("ListNode", "build_list", "run_ops"):
            self.assertNotIn(hidden, names)
        # every step is a line of the user's code (6 lines), none from setup
        self.assertTrue(all(1 <= s["line"] <= 6 for s in t))
        # the inputs are on the heap from the first step
        first = t[0]
        self.assertEqual(first["globals"]["head"][0], "REF")

    def test_calls_into_setup_helpers_add_no_steps(self):
        with_helper = trace("x = build_list([1, 2, 3, 4, 5, 6, 7, 8])\nprint(x.val)\n", SETUP, [])
        self.assertEqual(with_helper[-1]["stdout"], "1\n")
        self.assertTrue(all(s.get("func_name") == "<module>" for s in with_helper))
        self.assertLessEqual(len(with_helper), 4)

    def test_user_methods_called_from_setup_are_traced(self):
        code = ("class Counter:\n    def __init__(self):\n        self.n = 0\n"
                "    def add(self, k):\n        self.n += k\n        return self.n\n"
                "obj = Counter()\nout = run_ops(obj, ['add', 'add'], [[2], [3]])\nprint(out)\n")
        t = trace(code, SETUP, [])
        self.assertEqual(t[-1]["stdout"], "[2, 5]\n")
        add_steps = [s for s in t if s.get("func_name") == "add"]
        self.assertTrue(add_steps, "add() should be traced")
        frames = {f["func_name"] for s in add_steps for f in s["stack_to_render"]}
        self.assertNotIn("run_ops", frames)

    def test_user_rebinding_a_hidden_name_is_shown(self):
        t = trace("ListNode = 5\nprint(ListNode)\n", SETUP, [])
        self.assertIn("ListNode", shown_globals(t))

    def test_error_in_setup_is_reported(self):
        t = trace("print(1)\n", "x = 1 / 0\n", [])
        self.assertEqual(len(t), 1)
        self.assertEqual(t[0]["event"], "uncaught_exception")
        self.assertIn("setup", t[0]["exception_msg"])
        self.assertIn("ZeroDivisionError", t[0]["exception_msg"])

    def test_undefined_annotation_does_not_break_the_trace(self):
        # Python 3.14+: annotations are lazy, so this program is legal
        t = trace("def f(x: Missing) -> Missing:\n    return x\nprint(f(2))\n")
        self.assertEqual(t[-1]["stdout"], "2\n")
        self.assertFalse(any(s["event"] == "uncaught_exception" for s in t))
        self.assertTrue(any(s.get("func_name") == "f" for s in t))

    def test_without_setup_nothing_changes(self):
        code = "a = [1, 2]\nb = a\nprint(b)\n"
        plain = trace(code)
        with_empty = trace(code, None)
        self.assertEqual(json.dumps(plain), json.dumps(with_empty))


if __name__ == "__main__":
    unittest.main()
