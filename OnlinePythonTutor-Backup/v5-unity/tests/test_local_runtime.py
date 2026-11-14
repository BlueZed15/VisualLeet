"""Run from v5-unity: python -m unittest discover -s tests -p test_local_runtime.py"""

import bdb
import unittest
from unittest.mock import patch

import pg_logger


class LocalRuntimeTests(unittest.TestCase):
    def trace(self, code, inputs=None, **options):
        return pg_logger.exec_script_str_local(
            code, inputs, options.get('cumulative_mode', False),
            options.get('heap_primitives', False), lambda code, trace: trace)

    def test_programs(self):
        cases = [
            ('total = 0\nfor i in range(4):\n    total += i\nprint(total)', '6\n'),
            ('def square(n):\n    return n * n\nprint(square(5))', '25\n'),
            ('class Node:\n    def __init__(self, v):\n        self.value = v\n'
             'node = Node(3)\nprint(node.value)', '3\n'),
            ('def outer(x):\n    def inner(y):\n        return x + y\n'
             '    return inner\nadd = outer(2)\nprint(add(3))', '5\n'),
            ('def fact(n):\n    return 1 if n == 0 else n * fact(n - 1)\n'
             'print(fact(5))', '120\n'),
            ('values = [1, 2]\nvalues.append(values)\nprint(len(values))', '3\n'),
            ('import math\nprint(math.sqrt(9))', '3.0\n'),
        ]
        for code, output in cases:
            with self.subTest(code=code):
                trace = self.trace(code)
                self.assertGreater(len(trace), 1)
                self.assertFalse(any('exception' in step['event'] for step in trace), trace)
                self.assertEqual(trace[-1]['stdout'], output)

    def test_input(self):
        trace = self.trace('name = input()\nprint(name)', '["Ada"]')
        self.assertTrue(trace[-1]['stdout'].endswith('Ada\n'))

    def test_hidden_variables(self):
        trace = self.trace('#pythontutor_hide: _*\n_secret = 42\npublic = 1')
        self.assertNotIn('_secret', trace[-1]['globals'])
        self.assertEqual(trace[-1]['globals']['public'], 1)

    def test_custom_module(self):
        logger = pg_logger.PGLogger(
            False, False, False, lambda code, trace: trace,
            disable_security_checks=True, custom_modules={'helper': 'value = 7'})
        try:
            logger._runscript('print(value)')
        except bdb.BdbQuit:
            pass
        finally:
            trace = logger.finalize()
        self.assertEqual(trace[-1]['stdout'], '7\n')

    def test_runtime_error(self):
        with patch.object(pg_logger, 'DEBUG', False):
            trace = self.trace('x = 1 / 0')
        self.assertTrue(any('ZeroDivisionError' in step.get('exception_msg', '')
                            for step in trace))

    def test_execution_limit(self):
        trace = self.trace('while True:\n    pass')
        self.assertEqual(trace[-1]['event'], 'instruction_limit_reached')

    def test_visualization_options(self):
        trace = self.trace('def f(x):\n    return x + 1\ny = f(2)',
                           cumulative_mode=True, heap_primitives=True)
        self.assertTrue(trace[-1]['heap'])
        self.assertTrue(any(frame['is_zombie'] for frame in trace[-1]['stack_to_render']))


if __name__ == '__main__':
    unittest.main()
