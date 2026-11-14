// Builds the unpacked LeetScope extension into dist/extension:
//   manifest, icons, background, UI, sandboxed runner, renderer bundle,
//   the forked tracer (src/python), and the pinned Pyodide runtime files.
// Load dist/extension via chrome://extensions > Developer mode > Load unpacked.
import { build } from "esbuild";
import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// --test: same extension plus host access to http://127.0.0.1 only, so the
// automated checks can import from a local fixture page without a real
// toolbar click (activeTab can't be granted by automation). Never ship it.
const testBuild = process.argv.includes("--test");
const out = path.join(root, "dist", testBuild ? "extension-test" : "extension");
const src = (...p) => path.join(root, "src", ...p);

// Only the core runtime files; no optional packages.
const PYODIDE_FILES = ["pyodide.mjs", "pyodide.asm.mjs", "pyodide.asm.wasm", "python_stdlib.zip", "pyodide-lock.json"];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const dir of ["background", "ui", "runner", "python", "icons"]) {
  await cp(src(dir), path.join(out, dir), { recursive: true });
}
const manifest = JSON.parse(await readFile(src("manifest.json"), "utf8"));
if (testBuild) {
  manifest.name += " (TEST BUILD)";
  // leetcode.com is mapped to a local fixture server by the checks (--host-resolver-rules)
  manifest.host_permissions = ["http://127.0.0.1/*", "https://leetcode.com/*"];
}
await writeFile(path.join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");

await build({
  absWorkingDir: root,
  entryPoints: { renderer: "src/visualizer/index.ts" },
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: path.join(out, "visualizer"),
  minify: true,
  sourcemap: false,
  logLevel: "warning",
  resolveExtensions: [".ts", ".js", ".css"],
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".gif": "dataurl" },
  legalComments: "linked",
});

const pyodideDir = path.join(root, "node_modules", "pyodide");
const pyodideVersion = JSON.parse(await readFile(path.join(pyodideDir, "package.json"), "utf8")).version;
await mkdir(path.join(out, "vendor", "pyodide"), { recursive: true });
const provenance = [
  `Pyodide ${pyodideVersion} (npm package "pyodide", pinned in package-lock.json)`,
  "License: MPL-2.0, https://github.com/pyodide/pyodide/blob/main/LICENSE",
  "Includes CPython (PSF License) and its standard library.",
  "",
  "sha256 of packaged files:",
];
for (const f of PYODIDE_FILES) {
  const from = path.join(pyodideDir, f);
  await cp(from, path.join(out, "vendor", "pyodide", f));
  const sha = createHash("sha256").update(await readFile(from)).digest("hex");
  provenance.push(`${sha}  vendor/pyodide/${f}`);
}
await writeFile(path.join(out, "vendor", "PROVENANCE.txt"), provenance.join("\n") + "\n");
await cp(path.join(root, "..", "OnlinePythonTutor-Backup", "LICENSE.txt"), path.join(out, "LICENSE-OnlinePythonTutor.txt"));
console.log("built", out);
