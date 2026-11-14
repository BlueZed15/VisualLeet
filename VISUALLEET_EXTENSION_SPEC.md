# VisualLeet Chrome Extension — Implementation Specification

Status: implementation handoff for a working prototype, not an implementation claim.

## 1. Objective

Build a Chrome Manifest V3 extension that takes Python code chosen by the user,
runs it entirely in the browser, records its execution, and displays an
interactive Python Tutor-style visualization. The initial UI can be plain.
Correct execution, reliable tracing, and responsiveness matter more than polish.

The intended workflow is: open a Python DSA solution on LeetCode, import it into
VisualLeet, supply or adjust a small test case and starter code, click Visualize,
then step through variables, stack frames, objects, references, and output.

Deliver an actual unpacked Chrome extension with reproducible build instructions.
Do not stop at a design, static mockup, or Python console that only prints results.
Do not require a Python server, desktop Python installation, or hosted execution
API for end users.

## 2. Agreed product scope

### Included

- Python 3 DSA problems at Easy, Medium, and Hard difficulty.
- Small, concrete example inputs, rather than LeetCode's largest hidden tests.
- Arrays, strings, dictionaries, sets, recursion, linked lists, trees, graphs,
  sliding windows, backtracking, dynamic programming, and similar techniques.
- Selected standard-library tools commonly used in DSA, subject to tested tracer
  support: `collections`, `heapq`, `bisect`, `math`, `functools`, `itertools`,
  `typing`, and other existing allowed modules as appropriate.
- User-supplied helper classes and setup code, including `ListNode`, `TreeNode`,
  and `NestedInteger`. The extension may provide useful starter examples.
- Generic execution visualization. A graph represented as an adjacency dictionary
  may be displayed as a dictionary and lists. That is acceptable.
- Library operations such as `sorted()` may be treated as opaque operations.
  Show their observable effects; exposing their internal algorithms is unnecessary.

### Excluded from this prototype

- MountainArray-style interactive problems and other simulated judge interactions.
- SQL, shell, pandas questions, and languages other than Python.
- NumPy, SciPy, pandas, PyTorch, and third-party package installation.
- Automatic graph layouts, highlighted graph traversal animations, colored
  sliding windows, dedicated DP-table animations, or algorithm recognition.
- Complete multi-file applications, GUI programs, networking, files on the user's
  computer, threading, multiprocessing, and asynchronous application tracing.
- Running LeetCode's hidden tests, submitting solutions, or declaring a solution
  correct for all inputs.
- AI code rewriting, screenshot/OCR ingestion, accounts, cloud storage, analytics,
  multiplayer collaboration, or live-help services.
- Chrome Web Store publication. The result must nevertheless use an MV3-compatible
  architecture and packaged executable assets; store approval is not assumed.

Do not claim universal LeetCode coverage. Difficulty is not the determining
factor: execution length, object size, supported features, and setup are.

## 3. Existing repository and verified baseline

Workspace: `C:\Users\rohis\VisualLeet`.

The actual application is an archived Online Python Tutor project under
`OnlinePythonTutor-Backup/`. That directory is a separate Git repository nested
inside the outer workspace. Inspect both repositories before making changes.
Preserve existing user changes and the working local server workflow.

| File/directory under the backup | Role |
| --- | --- |
| `v5-unity/pg_logger.py` | Python tracing, stack collection, trace entries, execution limits |
| `v5-unity/pg_encoder.py` | Encodes values, objects, aliases, cycles, and heap references |
| `v5-unity/bottle_server.py` | Existing desktop HTTP adapter; unnecessary in the browser runtime |
| `v5-unity/js/pytutor.ts` | `ExecutionVisualizer`, navigation, data rendering, trace layout |
| `v5-unity/js/render-trace.ts` | Example of feeding a trace into `ExecutionVisualizer` |
| `v5-unity/render-trace.html` | Minimal existing trace-rendering page |
| `v5-unity/js/opt-live.ts` | Legacy automatic rerun editor; do not use its rerun behavior for this MVP |
| `v5-unity/build/` | Included compiled bundles, not necessarily suitable unchanged for MV3 |
| `v5-unity/tests/test_local_runtime.py` | Seven local runtime smoke tests |
| `unsupported-features.md` | Historical limitations; distinguish archived claims from current findings |
| `LICENSE.txt` and source headers | Attribution/license obligations for reused code |

Existing compatibility fixes removed `imp`, replaced `imp.new_module()` with
`types.ModuleType()`, and corrected inline regex flag placement. The local server
now resolves static files relative to its source and redirects `/` to the editor.
Bottle is pinned in `v5-unity/requirements.txt` for the desktop workflow only.

Verified before this spec:

- Local Python smoke tests pass on the installed Python 3.15.2 and 3.13 interpreters.
- Both desktop execution endpoints return traces and static bundles are served.
- BFS and sliding-window examples below return the expected results in the tracer.
- A previous headless browser check timed out; no comprehensive visual verification
  or extension/Pyodide verification has been completed.

Do not present these desktop results as evidence of Pyodide compatibility.

The legacy frontend build has missing typings and old Webpack/TypeScript/loader
dependencies. A plain `npm install` is not a verified build strategy. Create a
reproducible frontend build or adapter; do not depend on global legacy tools or
manually editing a minified bundle.

## 4. Runtime decision and feasibility gate

Use a pinned Pyodide release as the first runtime candidate, in a dedicated Web
Worker. Package its required interpreter assets and standard library locally.
Do not package the entire scientific package collection or download optional
packages at runtime. Pyodide supports those packages but does not load them all
by default.

Use Pyodide directly; adding PyScript is unnecessary for this prototype. PyScript
is a framework over interpreters, not a separate faster interpreter. MicroPython
or Brython may be considered only if measured evidence or compatibility failures
justify a different approach. Record that decision and its implications instead
of silently changing runtime or falling back to a server.

Before building extraction features, prove the following inside an unpacked MV3
extension using the intended CSP and execution context:

1. Packaged Pyodide loads without a CDN or external execution service.
2. The chosen worker type and module-loading paths work in Chrome.
3. The tracer imports and produces valid traces using the local execution entry
   point; inspect `bdb`, frame access, `inspect`, exceptions, and object encoding.
4. A simple loop and recursive function render through the real visualizer.
5. A timer outside the Python worker can terminate a stuck execution.
6. The intended isolation boundary prevents Python from acquiring privileged
   extension capabilities through its JavaScript bridge.

If a feasibility item fails, document the concrete error and resolve it before
expanding the product. Do not claim the full existing logger will run unchanged.
Avoid enabling desktop resource-limit/sandbox code that assumes a Unix process;
browser execution requires its own controls.

## 5. Architecture

Use a dedicated extension tab for the initial UI. It gives the existing diagrams
more space than a small popup and remains open while the user works. A side panel
can be added later. Clicking the toolbar action should capture the source tab's
identity before opening or focusing the VisualLeet tab.

Components:

| Component | Responsibility |
| --- | --- |
| MV3 service worker | Toolbar action, source-tab tracking, permitted extraction requests, message routing |
| Content script/page adapter | Reads explicitly requested source code from the chosen page |
| Extension UI/controller | Editable source, setup and test call, run controls, status, trace handoff |
| Isolated runner host | Owns the runtime worker and narrow messaging boundary |
| Dedicated Pyodide worker | Loads tracer, executes one job, returns plain trace data and metrics |
| Visualizer adapter | Passes trace data and options to the reused renderer; cleans up prior views |

The MV3 background service worker is not the long-running Python execution
container. The content script does not execute the user's Python. Do not run
Python on the visualization UI thread.

Proposed data flow:

1. A user gesture identifies source tab and import mode.
2. Extracted text is shown in an editable preview; extraction does not execute it.
3. The user reviews setup/input/call and explicitly chooses Visualize.
4. The controller creates a run ID and sends a bounded execution request.
5. The Python worker produces a trace using the prepared source.
6. The controller validates the response, rejects stale run IDs, and passes the
   trace to the visualizer.
7. Navigation reads recorded state without executing Python again.

## 6. Code ingestion

Implement these paths:

### A. Paste/edit — mandatory baseline

A textarea or lightweight code editor accepts a complete Python program. This
must work independently of any website integration. Preserve whitespace and
indentation. Support replacing the contents and rerunning without reloading the tab.

### B. Selected page text — mandatory

Capture the user's selected text from an ordinary HTTP(S) source page after an
explicit extension action. Preserve line breaks as far as the page selection
allows. Display the result for review. If selection is empty, show a helpful
message and keep the previous editor contents.

Use narrow permissions such as `activeTab` and `scripting` where sufficient.
Extraction must occur while the source tab is authorized; do not assume a button
inside a newly opened extension tab grants access to arbitrary website tabs.
Protected pages such as `chrome://` should fail gracefully and offer paste.

### C. LeetCode editor adapter — mandatory best-effort integration

Inspect the current site and implement an explicit "Import LeetCode editor" path.
Read the complete editor model when accessible, including off-screen lines.
Do not scrape only the rendered lines of a virtualized editor. Do not assume a
particular editor global exists without checking it on the actual site.

If access to the page's JavaScript context is necessary, use a small, packaged
bridge whose only job is to retrieve code/language metadata. Validate and bound
returned data. The page is not trusted to send arbitrary extension commands.

Detect a clearly non-Python language and explain the scope. Never silently convert
languages. If the editor cannot be read reliably, report that and offer selection
or paste. Document the tested page/editor conditions and any fallback used.

Automatic test-case extraction and universal problem metadata parsing are optional
after the core flow works. A paste-only prototype does not satisfy all ingestion
acceptance criteria; report integration gaps honestly.

## 7. Preparing runnable programs

The minimum supported path is a complete Python program with its own invocation.
For LeetCode class solutions, provide three editable areas:

1. **Setup/starter code:** imports, helper classes, and input constructors.
2. **Solution:** the imported or pasted user code.
3. **Test call:** constructs the chosen input if necessary and calls the solution.

Example call: `print(Solution().twoSum([2, 7, 11, 15], 9))`.

Compose these into a deterministic Python source string. For the prototype,
display that exact combined source in the visualizer so trace line numbers
remain correct. Do not concatenate hidden lines and highlight the wrong solution
lines. A later implementation may use separate filenames and explicit line maps.

Provide starter examples for ordinary arguments, linked lists, binary trees, and
`NestedInteger`. They are user-editable helpers, not universal problem adapters.
NestedInteger support should document which methods its example implements.

Do not guess a method or argument conversion and silently run a different program.
Lists representing tree nodes or linked lists require explicit conversion. A
solution with only definitions and no call should prompt the user to add a call;
it should not be reported as a failed algorithm.

Pre-supply input strings through a bounded list if `input()` support is included.
An initial implementation may instead report missing input clearly. Avoid blocking
terminal prompts inside the worker.

The displayed Python version must be the interpreter actually bundled. Do not
reuse the archived "Python 3.6" selector or offer a fictitious Python 2 mode.

## 8. Tracer integration and correctness

Reuse `pg_logger.py` and `pg_encoder.py` with the smallest necessary changes and
preserve their license notices. Avoid writing a new tracer before proving the
existing one unusable. Keep a clear source-of-truth/copy process if Python files
are packaged into extension assets.

Return the existing outer shape: `{ "code": "...", "trace": [...] }`.
Inspect actual fixtures before changing any event or value encoding. The renderer
expects information including line/event, globals, ordered variable names,
stack frames, heap references, and stdout. Errors and instruction-limit events
also have existing representations.

Correctness requirements:

- Forward/backward steps represent historical state, not references to live
  objects subsequently mutated by the program.
- Shared references and cyclic structures retain their identity relationships.
- Recursive calls have distinct frames and sensible call/return navigation.
- Runtime and syntax errors include understandable locations/messages.
- A limit produces an explicit incomplete-result state, never a false success.
- Catching a user exception in their own program continues tracing correctly.
- User code and printed strings are rendered as text, not executable HTML.

Restore tracing hooks, streams, and logger state after execution in `finally`
paths. Fresh globals alone do not reset imported modules or random/global state.
Define and test the runtime reuse policy. On cancellation or timeout, discard
the worker and rebuild it; do not reuse a potentially interrupted interpreter.

For ordinary successful runs, reuse the runtime only with tested cleanup of the
supported execution environment. Include an explicit Reset Runtime control.
Do not promise isolation from deliberately malicious code based only on Python
import restrictions or fresh dictionaries.

## 9. Visualization integration

Start from the standalone trace-rendering path rather than embedding the entire
legacy website, with its servers, collaboration, surveys, and remote endpoints.
`render-trace.ts` demonstrates `new ExecutionVisualizer(...)`, but its existing
URL/file-loading behavior needs an adapter for in-memory trace data.

Provide a clean renderer entry point that accepts a trace and options. Do not
assume Webpack's internal class is already a browser global. Use a reproducible
build, a deliberate export, or another maintainable adapter.

Required UI behavior:

- Source code with current execution position.
- Globals, local variables, function stack frames, and heap/object references.
- Captured stdout and error output.
- First, Previous, Next, Last, and a step-position indicator/slider.
- Proper cleanup when replacing a trace; no accumulated DOM trees or listeners.

Preserve basic object identity/reference visualization. Native graph drawings and
algorithm-specific overlays are not required. Show the limitations plainly.

Audit reused bundles for dynamic JavaScript evaluation, remote script loads,
inline handlers, tracking, and requests to historical Python Tutor services.
Remove irrelevant integrations. Do not weaken a privileged page's CSP or depend
on development bundles that require `eval()`.

## 10. Minimal testing UI

Use a simple two-column layout: source/setup/call controls on one side and the
visualization on the other. Allow enough width or scrolling for the reused renderer.
Plain HTML/CSS and TypeScript/JavaScript are sufficient; no new UI framework is
required unless it demonstrably simplifies the implementation.

Controls and states:

- Import Selection, Import LeetCode Editor, and Paste/Edit.
- Example selector: Two Sum, BFS, Sliding Window, Recursion, Linked List, Tree.
- Visualize, Stop, Reset Runtime, and clear error/status display.
- Status: not initialized, initializing, ready, running, preparing visualization,
  complete, stopped, timed out, limit reached, or failed.
- Small diagnostic area with runtime version, trace count, trace bytes, and
  timing breakdown. Keep detailed developer data out of normal error messages.

Use explicit execution. No automatic reruns after every keystroke. Do not discard
user edits when extraction fails or a runtime resets. Editing while a run is in
progress must not relabel an older trace as belonging to the edited source.

## 11. Worker protocol and lifecycle

Use serializable messages with a protocol version and unique run ID. Suggested
commands: `initialize`, `run`, `reset`; suggested events: `ready`, `result`, `error`.
Cancellation is controlled by the host terminating the worker, not solely by a
message the busy Python interpreter might never process.

An execution request contains source, options, pre-supplied inputs if supported,
and limits. A successful/partial result contains the trace, completion reason,
runtime version, and metrics. Return strings/JSON-compatible data rather than
leaking Pyodide proxy objects. Release proxies explicitly where necessary.

One active run per workspace. Disable duplicate execution or cancel the older
run before starting another. Reject late responses using the run ID and worker
generation. Do not let a result from a terminated generation replace a newer one.

Capture source/options at the moment Visualize is clicked. Treat initialization,
execution, serialization/transfer, and rendering as different measurable phases.

## 12. Responsiveness and resource controls

The promise is bounded, measurable behavior for small DSA examples, not "never
lags" or "all inputs supported". Worker execution prevents Python from blocking
the UI thread; it does not remove CPU contention or rendering costs.

Initial engineering defaults, to be adjusted with documented measurements:

| Budget | Initial value | Behavior on exhaustion |
| --- | --- | --- |
| Recorded trace entries | 1,000 | Stop and label the trace incomplete |
| Execution wall time after runtime ready | 5 seconds | Terminate worker and offer rerun with smaller input |
| Runtime initialization | 30 seconds | Report initialization failure separately from user-code timeout |
| Encoded trace data | 10 MiB | Stop recording with an explicit limit reason |
| Captured stdout | 64 KiB UTF-8 | Mark truncation or stop with an explicit output limit |
| Submitted combined source | 256 KiB UTF-8 | Reject before execution with an explanation |

These are proposed prototype budgets, not existing repository guarantees or
benchmarked universal safe values. Apply bounds during capture where feasible,
not only after constructing an arbitrarily large trace. A single enormous object
can exceed a budget before a full snapshot finishes; use a bounded encoder or
reject unsupported sizes clearly rather than silently presenting partial objects
as complete. There is no assumed portable, precise browser-process RAM quota.

Keep the external wall-clock watchdog even when step limits exist. Native calls
and filtered trace events can consume time without filling the recorded trace.
Do not raise the existing step default merely to make tests pass.

Avoid optimizing by silently dropping algorithm steps. Any sampled or summarized
mode is a separate, clearly labeled future feature.

### Benchmark procedure

Record machine/OS, Chrome version, Pyodide/Python versions, build mode, inputs,
trace sizes, and sample count. Measure one cold startup separately from at least
five warm runs; report median and worst observed times rather than unsupported
percentile claims from tiny samples.

Measure initialization, preparation, trace generation, serialization/transfer,
time to first rendered step, step-navigation delay, and cancellation recovery.
Use browser profiling to distinguish worker CPU from main-thread long tasks.
Record memory metrics when available and describe what they actually measure;
serialized bytes are not equivalent to live memory usage.

Provisional targets on a documented ordinary development laptop:

- UI acknowledges Run/Stop immediately, with a target of under 100 ms.
- Worker termination becomes visible within 500 ms of Stop.
- Warm BFS/sliding-window fixtures reach a usable first view within 1 second.
- Ordinary step navigation has a target of under 100 ms.

Targets are acceptance goals to measure, not current performance claims. Report
misses, identify the bottleneck, and either improve it or document the remaining
limitation. Do not hide initialization inside a warm-run number.

### Optimization order

1. Establish a correct, measured end-to-end baseline.
2. Remove redundant initialization/reruns and renderer leaks.
3. Profile repeated object encoding and whole-trace layout preparation.
4. Consider shared immutable encoded snapshots, deltas with periodic checkpoints,
   and incremental layout only where measurements justify them.

Important: compressing or comparing snapshots after full encoding does not
eliminate capture CPU. Caching mutable objects solely by `id()` is incorrect.
Delta traces require corresponding reconstruction/navigation changes; do not
feed them directly to the legacy full-snapshot renderer. Do not expand all deltas
back into permanent full snapshots and claim browser memory was reduced.

Do not implement a major trace-format rewrite as a prerequisite to the first
working extension. Measure first and retain a correct baseline for comparison.

## 13. Execution isolation, permissions, and packaging

Python from a web page is untrusted input. Pyodide has a JavaScript bridge; a Web
Worker is a concurrency mechanism, not by itself a sufficient privilege boundary.
The old logger's import whitelist is not a security sandbox.

Use an isolated runner context with no extension API access. A manifest sandbox
page hosting a dedicated runtime worker is a candidate design. Prove that the
chosen pinned Pyodide build, module workers, packaged resource URLs, CSP, and
opaque-origin behavior work together during the feasibility gate. Do not assume
that moving an ordinary worker into a sandbox works without adaptation.

If local asset delivery needs a bridge, serve only an explicit packaged-asset
allowlist. Never expose arbitrary fetch, tab access, cookies, storage, filesystem
access, or URL-opening commands to the runner. Do not mount user directories.

Use narrowly scoped messages/ports, source checks, schemas, size limits, and
job IDs. A sandbox's opaque origin cannot be authenticated by `event.origin`
alone; validate the expected window/channel. Do not treat runner messages as
authorization to perform privileged actions.

Constrain network capabilities through the execution context and CSP, not only
by hiding Python import names. Offline operation must be tested, including that
there are no incidental old analytics/collaboration requests. Avoid broad host
permissions and `<all_urls>` unless a documented requirement cannot be met otherwise.

All required JS, Wasm, Python sources, CSS, and other executable dependencies are
packaged at build time and version-pinned. Development may download dependencies;
the built extension may not fetch its runtime from a CDN. Use CSP appropriate to
each context, permitting Wasm where required without enabling arbitrary evaluation
in privileged extension pages.

Keep licenses and attribution for the archived visualizer, Pyodide, and bundled
libraries. No code or test inputs are uploaded. Do not add telemetry.

## 14. Suggested project layout and developer workflow

Create new work under `extension/` in the outer workspace unless repository
instructions require another location. Keep the archive identifiable.

Suggested structure (adapt for the chosen bundler/isolation implementation):

```text
extension/
  package.json
  package-lock.json
  README.md
  src/
    manifest.json
    background/
    content/
    ui/
    runner/
    visualizer/
    python/
  examples/
  scripts/
  tests/
  vendor/
  dist/
```

Use pinned local build dependencies and a lockfile. Document Windows PowerShell
commands from a clean checkout, including dependency installation, runtime-asset
preparation, build, tests, and loading `dist/` through `chrome://extensions`.
Provide a single documented build command after dependencies/assets are prepared.
Do not require global Webpack, TypeScript, or legacy `tsd`.

Keep generated profiles, browser state, caches, and unrelated downloaded packages
out of commits. Record asset provenance and integrity/version information. Explain
which artifacts are generated and how to regenerate them.

## 15. Required fixtures and tests

### Correctness fixtures

| Fixture | Expected evidence |
| --- | --- |
| Two Sum: `[2,7,11,15]`, target `9` | Result `[0,1]`; dictionary grows correctly |
| BFS fixture below | Order `A,B,C,D`; seen/queue/frame states are navigable |
| Sliding-window fixture below | Result `3`; left/right/window changes visible |
| Recursive factorial of 5 | Result `120`; distinct nested frames and returns |
| Reverse a three-node linked list | Correct references before/after each reassignment |
| Binary-tree traversal | Correct node relationships and traversal order |
| NestedInteger helper plus flattening | `[1,[4,[6]]]` flattens to `[1,4,6]` |
| Small DP example | Updates to a shared list/table preserve historical states |
| Aliasing and mutation | `a=[1]; b=a; b.append(2)` shows one shared object |
| Cyclic list | `a=[]; a.append(a)` renders without encoder recursion failure |
| Standard-library operations | Representative `Counter`, `deque`, `heapq`, `bisect`, caching behavior checked and unsupported displays documented |
| Syntax error and caught/uncaught exceptions | Accurate error state and successful recovery |
| Run A then Run B | No unintended variables/output/logger state carried over |

Assert output and relevant trace content, not just that a browser page exists.
Do not compare unstable raw object IDs or assume different Python versions emit
exactly identical event counts. Preserve aliasing semantics and line accuracy.

### Resource/lifecycle tests

- Infinite loop reaches a bound; the UI remains usable and the next run works.
- A computation not producing frequent trace events is stopped by the host timer.
- Stop during a run discards the job; stale results cannot overwrite a newer run.
- Large list/DP/output inputs produce bounded, clearly reported behavior.
- Repeated runs replace previous visuals without accumulating handlers or traces.
- Closing the workspace disposes of its worker and resources.
- Denied/unsupported page access and empty extraction do not erase user edits.
- Complete LeetCode editor extraction includes off-screen code.
- HTML-like printed strings cannot execute script or alter the extension UI.
- The runner cannot request arbitrary privileged extension actions.
- With network disabled after installation, packaged examples still execute and
  render. Importing a website naturally requires that page to be available.

Include automated browser checks where practical and a manual acceptance checklist
for loading the unpacked extension and importing from the live LeetCode editor.
Record Chrome version and exact reproduction steps. If browser testing is blocked,
state that explicitly instead of claiming the extension is verified.

## 16. Benchmark fixtures from this conversation

### BFS

```python
def bfs(graph, start):
    queue = [start]
    seen = {start}
    order = []
    head = 0
    while head < len(queue):
        node = queue[head]
        head += 1
        order.append(node)
        for neighbor in graph[node]:
            if neighbor not in seen:
                seen.add(neighbor)
                queue.append(neighbor)
    return order

graph = {
    "A": ["B", "C"],
    "B": ["A", "D"],
    "C": ["A", "D"],
    "D": ["B", "C"]
}
print(bfs(graph, "A"))
```

Expected stdout: `['A', 'B', 'C', 'D']` followed by a newline.

### Sliding window

```python
def longest_unique_substring(s):
    seen = set()
    left = 0
    best = 0
    for right in range(len(s)):
        while s[right] in seen:
            seen.remove(s[left])
            left += 1
        seen.add(s[right])
        window = s[left:right + 1]  # Inspection aid; not required by algorithm
        best = max(best, right - left + 1)
    return best

print(longest_unique_substring("abcabcbb"))
```

Expected stdout: `3` followed by a newline. The `window` copy adds work and should
be identified as a demonstration aid rather than part of the optimal algorithm.

### Repeated unchanged state

```python
data = list(range(2000))
total = 0
for i in range(200):
    total += i
print(total)
```

Compare with `range(10)` for the input list. Both should print `19900`. Prior
single-run desktop measurements recorded 405 events in both cases: about 8 ms
and 86 KiB compact JSON for the small list, versus 123 ms and 3,586 KiB for the
large list. These are illustrative baseline observations, not browser performance
targets or statistically robust benchmarks.

## 17. Delivery sequence

1. Inspect repository instructions, current changes, licenses, and source paths.
2. Build the smallest MV3 feasibility spike with packaged Pyodide, actual tracing,
   intended isolation, one fixture, and the real visualizer.
3. Establish reproducible build/asset preparation and a clean renderer adapter.
4. Add editable source/setup/call UI, status, cancellation, limits, and runtime reset.
5. Add selected-text import and the verified LeetCode editor adapter.
6. Add fixtures, correctness/resource tests, and recorded performance measurements.
7. Fix measured responsiveness issues without compromising trace semantics.
8. Document installation, usage, architecture decisions, tested scope, and gaps.

Do not spend the initial effort on graphical polish or a complete rewrite. If
the legacy renderer/build or tracer requires substantial changes, explain why
and keep those changes reviewable.

## 18. Definition of done

- A clean build produces an unpacked MV3 extension Chrome can load.
- The user can paste a program, import selected text, and use the LeetCode adapter
  under documented tested conditions, with visible fallbacks when extraction fails.
- The user can edit starter code and a test call and see the exact executed source.
- Python executes locally in the browser with no Bottle/localhost/native/server dependency.
- The real visualizer displays historical variables, frames, references, and output.
- Back/forward navigation works without rerunning Python.
- The fixture suite has documented results, including failure cases and cleanup.
- Stop, timeout, trace-size limits, and stale-result handling work.
- Packaged execution works offline and makes no incidental external requests.
- The runtime isolation and message boundaries have been tested, not merely described.
- Cold/warm execution and rendering timings are reported with environment details.
- Documentation identifies unsupported cases, performance misses, and any unverified behavior.
- Existing desktop startup remains usable unless a necessary change is explicitly documented.

Final handoff from the implementing model should include changed files, exact
build/load/run commands, runtime versions, test results, benchmark results,
limitations, and any remaining blockers. Do not say "complete" if required
ingestion, browser execution, rendering, or acceptance checks are still missing.

## 19. Primary technical references

Check documentation for the exact versions selected during implementation.

- [Pyodide overview](https://pyodide.org/en/stable/) — CPython/WebAssembly runtime.
- [Pyodide package loading](https://pyodide.org/en/stable/usage/loading-packages.html) — optional packages are loaded separately.
- [Pyodide Web Workers](https://pyodide.org/en/stable/usage/webworker.html) — worker execution; worker type depends on the selected release.
- [Pyodide compatibility](https://pyodide.org/en/stable/usage/wasm-constraints.html) — browser-specific Python limitations.
- [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) — page access and isolated worlds.
- [Chrome extension CSP](https://developer.chrome.com/docs/extensions/reference/manifest/content-security-policy) — packaged scripts, Wasm, and execution contexts.
- [Chrome sandbox pages](https://developer.chrome.com/docs/extensions/reference/manifest/sandbox) — unique origin and lack of extension APIs.
- [Chrome remotely hosted code guidance](https://developer.chrome.com/docs/extensions/develop/migrate/remote-hosted-code) — executable asset packaging constraints.

## 20. Copyable instruction for the implementing model

> Implement the VisualLeet prototype described in this specification in the
> existing workspace. Read the spec fully and inspect the repository before
> editing. Preserve the current local Python Tutor workflow and user changes.
> First prove packaged Pyodide, the existing tracer, and the real visualizer work
> together inside Chrome MV3 with the intended isolation and cancellation design.
> Then complete the ingestion, editable starter/test-call UI, resource controls,
> tests, and measured performance checks. Use a basic UI. Do not introduce a
> hosted Python backend, runtime CDN dependencies, scientific packages, or
> algorithm-specific animations. Finish with reproducible build/load instructions
> and an honest account of verification and remaining limitations.
