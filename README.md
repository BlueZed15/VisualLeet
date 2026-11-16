# LeetScope

A Chrome extension that runs your Python solution to a LeetCode problem in
the browser and plays it back step by step: your code with the current line,
the stack frames, the objects and the pointers between them. Nothing is sent
to a server.

LeetScope is built on the open source version of
[Python Tutor](https://pythontutor.com) by Philip Guo.

## Install

You need Node.js and Chrome.

```powershell
cd extension
npm ci
npm run build:extension
```

Then open `chrome://extensions`, turn on **Developer mode**, click **Load
unpacked** and pick `extension/dist/extension`.

## Use

1. Open a LeetCode problem, set the editor to **Python3** and pick a case in
   the **Testcase** tab.
2. Click **Visualize** in LeetCode's top bar, click the LeetScope toolbar
   icon, or press **Alt+V**.
3. Step through the run in the LeetScope tab.

The Visualize button glows briefly when one of LeetCode's own Runs finishes.
To turn that off, right-click the LeetScope toolbar icon and untick **Glow on
LeetCode when a Run finishes**.

## What's in this repo

| Folder | What it is |
| --- | --- |
| `extension/` | LeetScope itself. [extension/README.md](extension/README.md) covers how it works, the problem database, the tests and the rules for changes. |
| `OnlinePythonTutor-Backup/` | The original Python Tutor source, kept unchanged as the reference for LeetScope's forked tracer and renderer. The build copies its license, and the benchmarks and tracer tests compare against it. You don't need it to use the extension. |

## License and credits

Python Tutor is © Philip Guo, under the MIT license
(`OnlinePythonTutor-Backup/LICENSE.txt`, shipped in the extension as
`LICENSE-OnlinePythonTutor.txt`). Python runs on
[Pyodide](https://pyodide.org).
