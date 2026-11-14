"""Runs generated VisualLeet programs for scripts/verify-db.mjs.

Usage: python verify_runner.py jobs.json  ->  prints a JSON list of results.

Each job is {"id", "setup", "visible", "source"}. It runs through the forked
tracer exactly like the extension does (setup untraced and hidden, source
traced) and reports the last step: event, printed output, exception, step
count and the names shown in the Global frame. If the trace hits the step
limit, the program is also run without the tracer so the result can still
be checked.
"""
import contextlib
import io
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "src", "python"))
import pg_logger  # noqa: E402


def run_traced(job):
    out = {}

    def finalizer(code, trace):
        out["trace"] = trace

    options = json.dumps({
        "cumulative_mode": False, "heap_primitives": False, "show_only_outputs": False,
        "visualleet_setup": job["setup"], "visualleet_setup_visible": job["visible"],
    })
    pg_logger.exec_script_str(job["source"], None, options, finalizer)
    trace = out.get("trace") or []
    last = trace[-1] if trace else {}
    shown = set()
    for step in trace:
        shown.update((step.get("globals") or {}).keys())
    return {
        "event": last.get("event"), "stdout": last.get("stdout", ""), "exception": last.get("exception_msg"),
        "steps": len(trace), "shown": sorted(shown),
    }


def run_plain(job):
    g = {"__name__": "__main__"}
    buf = io.StringIO()
    try:
        exec(job["setup"], g)
        with contextlib.redirect_stdout(buf):
            exec(job["source"], g)
        return {"stdout": buf.getvalue()}
    except Exception as e:  # report, don't crash the batch
        return {"stdout": buf.getvalue(), "exception": type(e).__name__ + ": " + str(e)}


def main():
    jobs = json.load(open(sys.argv[1], encoding="utf-8"))
    results = []
    for job in jobs:
        r = {"id": job["id"]}
        try:
            r.update(run_traced(job))
            if r["event"] == "instruction_limit_reached":
                r["plain"] = run_plain(job)
        except Exception as e:
            r["error"] = type(e).__name__ + ": " + str(e)
        results.append(r)
    sys.stdout.write(json.dumps(results))


if __name__ == "__main__":
    main()
