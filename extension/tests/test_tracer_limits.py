"""VisualLeet-specific tracer behavior (not in the original tracer)."""
import io, json, os, sys, unittest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src", "python"))
import pg_logger  # the fork


def trace(code, inputs=None):
    out = {}
    real = sys.stdout
    sys.stdout = io.StringIO()
    try:
        pg_logger.exec_script_str(code, json.dumps(inputs) if inputs is not None else None, None,
                                  lambda c, t: out.setdefault("t", t))
    finally:
        sys.stdout = real
    return out["t"]


class OutputLimit(unittest.TestCase):
    def test_large_output_stops_with_limit_event(self):
        t = trace("for i in range(100000):\n    print('x' * 1000)\n")
        self.assertEqual(t[-1]["event"], "instruction_limit_reached")
        self.assertIn("KiB of output", t[-1]["exception_msg"])
        self.assertLessEqual(len(t[-2]["stdout"].encode()), pg_logger.MAX_STDOUT_BYTES + 1100)  # stops right after the print that crosses the limit

    def test_normal_output_unaffected(self):
        t = trace("print('hi')\n")
        self.assertEqual(t[-1]["stdout"], "hi\n")


class Input(unittest.TestCase):
    def test_supplied_input_lines(self):
        t = trace("a = input('a? ')\nb = input()\nprint(a + b)\n", ["1", "2"])
        self.assertTrue(t[-1]["stdout"].endswith("12\n"))

    def test_missing_input_ends_with_raw_input_event(self):
        t = trace("a = input('number? ')\nprint(a)\n", [])
        self.assertEqual(t[-1]["event"], "raw_input")
        self.assertEqual(t[-1]["prompt"], "number? ")


if __name__ == "__main__":
    unittest.main()
