r"""Generate benchmark traces with the archived tracer (desktop Python).

Run from the workspace root:
  .venv\Scripts\python.exe extension\bench\make_traces.py
"""
import json, os, sys, time
here = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(here, "..", "..", "OnlinePythonTutor-Backup", "v5-unity"))
sys.path.insert(0, here)
import pg_logger
from fixtures import FIXTURES

out = os.path.join(here, "traces")
os.makedirs(out, exist_ok=True)
for name, code in FIXTURES.items():
    t = time.perf_counter()
    tr = pg_logger.exec_script_str_local(code, None, False, False, lambda c, t: t)
    ms = (time.perf_counter() - t) * 1000
    data = json.dumps({"code": code, "trace": tr}, separators=(",", ":"))
    with open(os.path.join(out, name + ".json"), "w", encoding="utf-8") as f:
        f.write(data)
    print(f"{name:22s} steps={len(tr):5d} trace={ms:7.1f}ms size={len(data)/1024:6.0f}KiB last={tr[-1]['event']}")
