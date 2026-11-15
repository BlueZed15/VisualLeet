"""Print {name: trace JSON} for every test program, using the tracer in argv[1].

Usage: python dump_traces.py <dir with pg_logger.py> <cache: 0|1|default>
Runs in its own process so the archive and the fork never share modules.
"""
import gc, io, json, os, sys
sys.path.insert(0, os.path.abspath(sys.argv[1]))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import pg_logger, pg_encoder
if sys.argv[2] in ("0", "1"):
    pg_encoder.ENABLE_ENCODE_CACHE = sys.argv[2] == "1"
# The fork raises the step limit and rewords its limit messages; compare both
# tracers at the original's limit, with the limit message left out.
pg_logger.MAX_EXECUTED_LINES = 1000
from tracer_programs import PROGRAMS

out = {}
real_stdout = sys.stdout
for name, code in PROGRAMS.items():
    sys.stdout = io.StringIO()  # tracer may echo; keep our JSON clean
    try:
        trace = pg_logger.exec_script_str_local(code, None, False, False, lambda c, t: t)
        # The original tracer keeps some objects alive until a later garbage
        # collection, so a program's __del__ output can land in the next
        # program's trace at a point that depends on allocation counts.
        # Collect here so each program's trace depends only on that program.
        gc.collect()
        if trace and trace[-1].get("event") == "instruction_limit_reached":
            trace[-1]["exception_msg"] = "<limit>"
    finally:
        sys.stdout = real_stdout
    out[name] = json.dumps({"code": code, "trace": trace}, separators=(",", ":"), sort_keys=False)
real_stdout.write(json.dumps(out))
