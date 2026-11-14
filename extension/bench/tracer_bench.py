r"""Time the original tracer vs the VisualLeet fork on the bench fixtures.

Run from the workspace root:
  .venv\Scripts\python.exe extension\bench\tracer_bench.py
Each tracer runs in its own process; times are the median of 5 runs.
"""
import json, os, statistics, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
TRACERS = {
    "original": os.path.join(HERE, "..", "..", "OnlinePythonTutor-Backup", "v5-unity"),
    "fork": os.path.join(HERE, "..", "src", "python"),
}

CHILD = r'''
import json, sys, time, statistics
sys.path.insert(0, sys.argv[1]); sys.path.insert(0, sys.argv[2])
import pg_logger
from fixtures import FIXTURES
out = {}
for name, code in FIXTURES.items():
    ts = []
    for _ in range(5):
        t = time.perf_counter()
        tr = pg_logger.exec_script_str_local(code, None, False, False, lambda c, t: t)
        ts.append((time.perf_counter() - t) * 1000)
    out[name] = statistics.median(ts)
print(json.dumps(out))
'''

if __name__ == "__main__":
    res = {}
    for label, d in TRACERS.items():
        p = subprocess.run([sys.executable, "-c", CHILD, os.path.abspath(d), HERE], capture_output=True, text=True,
                           env=dict(os.environ, PYTHONHASHSEED="0"))
        if p.returncode:
            sys.exit(p.stderr)
        res[label] = json.loads(p.stdout)
    print(f"{'program':24s} {'original':>10s} {'fork':>10s} {'speedup':>8s}")
    for name in res["original"]:
        a, b = res["original"][name], res["fork"][name]
        print(f"{name:24s} {a:9.1f}ms {b:9.1f}ms {a / b:7.1f}x")
