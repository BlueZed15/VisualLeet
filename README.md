# VisualLeet

This workspace contains a legacy Online Python Tutor backup. The runnable app
is in `OnlinePythonTutor-Backup/v5-unity/`. Its compiled frontend bundles are
included, so **you do not need npm, Webpack, Docker, or a database to run the
Python visualizer**.

## Run on Windows (PowerShell)

From this workspace:

```powershell
cd C:\Users\rohis\VisualLeet
.\.venv\Scripts\python.exe OnlinePythonTutor-Backup\v5-unity\bottle_server.py
```

Open <http://localhost:8003/visualize.html> (step-by-step visualization) or
<http://localhost:8003/live.html> (live editor). The root URL redirects to the
visualizer. Stop the server with Ctrl+C.

The existing `.venv` already has Bottle installed. On a fresh checkout, first run:

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r OnlinePythonTutor-Backup\v5-unity\requirements.txt
```

Calling the virtual environment's executable directly avoids PowerShell
activation-policy problems and ensures you use the interpreter with Bottle installed.
In VS Code, select `.venv\Scripts\python.exe` as the Python interpreter.

Select **Python 3.6** in the old UI. That label is historical: the local server
executes with the Python version used to launch it, including when the Python 2
option is selected. It does not install or switch interpreters.

This is a local development server with unsandboxed execution. Keep it bound to
localhost and run code you trust.

## What was blocking startup

The installed environment reports Python 3.15.2 and Bottle 0.13.4. The original
server failed immediately with `ModuleNotFoundError: No module named 'imp'`.
Python removed `imp` in 3.12; the old `imp.new_module()` call is now replaced by
`types.ModuleType()`. See the [Python migration notes](https://docs.python.org/3.12/whatsnew/3.12.html#imp).

The logger's wildcard filters also placed regex flags at the end of the pattern,
which modern Python rejects. Those flags now precede the pattern. Static files
are resolved relative to `bottle_server.py`, so starting it from the workspace
root or an IDE works without changing into `v5-unity` first.

The local runtime dependency is pinned in `v5-unity/requirements.txt`.

## Codebase map

| Location | Purpose |
| --- | --- |
| `v5-unity/bottle_server.py` | Local HTTP server, static files, Python execution routes |
| `v5-unity/pg_logger.py` | Executes Python under a debugger and records each step |
| `v5-unity/pg_encoder.py` | Converts variables, objects, references, and stack data into JSON |
| `v5-unity/js/` | TypeScript frontend, editor, execution requests, visualization, collaboration |
| `v5-unity/build/` | Included compiled JavaScript; used directly by the HTML pages |
| `v5-unity/css/`, `example-code/` | Styles and example programs |
| `v5-unity/tests/` | Local runtime smoke tests and legacy screenshot tests |
| `v4-cokapi/` | Separate Node service and Docker-based non-Python language tracers |
| `v3/` | Older implementation, developer documentation, and legacy tests |
| `v1-v2/` | Historical implementations; not needed to start v5 |
| `tests/` inside the backup | Older frontend regression infrastructure |

All paths in the table are relative to `OnlinePythonTutor-Backup/`.
The backup is also a separate Git repository inside this workspace; inspect
its changes with `git -C OnlinePythonTutor-Backup status`.

## Remaining dependency limits

**Frontend development:** running the included bundles works without rebuilding.
Editing TypeScript requires a separate build-tool restoration. The archived setup
uses Webpack 3.11 and TypeScript 2.x; neither is declared as a local dependency
in `package.json`. Several loader versions are unspecified, the lockfile uses the
old v1 format, and the `typings/` directory is missing. The README itself says
`tsd install` stopped working. The production script also uses Unix `rm -f`,
which does not work in npm's default Windows shell. A plain `npm install` with
the installed Node 26/npm 11 is not a verified build setup. Puppeteer 1.x is
for legacy browser tests, not for serving the app.

**Other languages:** JavaScript, TypeScript, Java, Ruby, C/C++, and Anaconda
execution are separate from the Bottle server. The frontend points those
requests at historical `cokapi.com`/backup-server endpoints; their availability
has not been verified. The local placeholder routes returning `OK` do not
execute these languages. A self-contained setup needs the language-specific
images in `v4-cokapi/backends/`, the `cokapi.js` service, and updated frontend
endpoint configuration followed by a frontend rebuild. This code assumes Linux
paths such as `/usr/bin/docker`; C/C++ additionally uses a modified Valgrind.
Installing a compiler or running Bottle alone does not enable those visualizers.
These backends have not been restored or tested here.

**Legacy test suites:** the older screenshot/golden tests depend on archived
browser tooling and interpreter-specific output. They are not a modern CI setup.
The compatibility fixes do not guarantee every modern Python feature works.

## Verify the Python runtime

```powershell
cd OnlinePythonTutor-Backup\v5-unity
..\..\.venv\Scripts\python.exe -m unittest discover -s tests -p test_local_runtime.py
```

All seven smoke tests passed on the installed Python 3.15.2 and Python 3.13
interpreters. They cover loops, functions, closures, recursion, objects, cyclic
lists, imports, input, hidden variables, custom modules, runtime errors, the
execution limit, and visualization options. HTTP checks also verified that
both Python execution endpoints return traces and that both HTML pages and
their JavaScript bundles are served when launched from the workspace root.
The automated headless browser check timed out, so visual rendering has not
been independently verified.
