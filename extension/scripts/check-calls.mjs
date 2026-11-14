// Checks that every problem file's call matches LeetCode's starter code.
// For each problem with collected metadata, a stub is written from LeetCode's
// signature (class, method names and parameters) and run with each example
// through the same tracer and hidden setup the extension uses:
//   template - the stub method raises StubCalled as soon as it is entered, so
//              the call must reach it with the right name and argument count.
//   design   - the stub class takes the constructor's parameters and its
//              methods return None; every operation in the example must run.
//
// Hand-written ("manual") problems are skipped here: verify-db.mjs runs them
// with real solutions.
//
//   node scripts/check-calls.mjs [--python <path>] [--only slug,slug]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fill, splitCases } from "../src/ui/harness.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const venv = path.join(root, "..", ".venv", "Scripts", "python.exe");
const python = arg("--python", process.env.PYTHON || (existsSync(venv) ? venv : "python3"));
const only = arg("--only", "") ? new Set(arg("--only", "").split(",")) : null;
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));
const P = (...p) => path.join(root, "problems", ...p);
const DB = (...p) => path.join(root, "src", "problems", ...p);

// LeetCode's metadata also lists C-only length parameters (numsSize, matrixRowSize)
const params = (ps) => {
  const names = (ps || []).map((p) => p.name);
  return ["self", ...names.filter((n) => !names.some((b) => b !== n && /^(Row|Col)?Size$/.test(n.slice(b.length)) && n.startsWith(b)))].join(", ");
};
function stub(meta) {
  if (meta.classname) {
    const methods = (meta.methods || []).map((m) => `    def ${m.name}(${params(m.params)}):\n        return None`);
    return `class ${meta.classname}:\n    def __init__(${params(meta.constructor && meta.constructor.params)}):\n        pass\n${methods.join("\n")}\n`;
  }
  return `class StubCalled(Exception):\n    pass\n\nclass Solution:\n    def ${meta.name}(${params(meta.params)}):\n        raise StubCalled("ok")\n`;
}

const index = readJson(DB("index.json"));
const handwritten = readJson(P("handwritten.json")).problems;
const jobs = [], plan = {}, skipped = [], manual = [];
for (const slug of Object.keys(index.problems)) {
  if (only && !only.has(slug)) continue;
  if (!existsSync(P("collected", slug + ".json"))) { skipped.push(slug); continue; }
  const c = readJson(P("collected", slug + ".json"));
  // hand-written ("manual") problems: LeetCode's signature lists judge-only
  // parameters, so their check is the real solution in verify-db.mjs instead
  if (c.meta.manual) { manual.push(slug); continue; }
  const entry = readJson(DB(slug + ".json"));
  const inputs = handwritten[slug] && Array.isArray(handwritten[slug].tests) ? handwritten[slug].tests.map(([i]) => i) : c.exampleInputs;
  const design = !!c.meta.classname;
  plan[slug] = { design, problems: [] };
  inputs.forEach((input, i) => {
    const texts = splitCases(entry, input)[0];
    const g = texts ? fill(entry, texts) : { ok: false, errors: { input: "couldn't split the example into boxes" } };
    if (!g.ok) { plan[slug].problems.push(`example ${i + 1}: ${JSON.stringify(g.errors)}`); return; }
    jobs.push({ id: `${slug}|${i}`, setup: g.setup, visible: g.visible, source: stub(c.meta) + "\n" + g.code + "\n" });
  });
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "visualleet-calls-"));
writeFileSync(path.join(tmp, "jobs.json"), JSON.stringify(jobs));
const results = JSON.parse(execFileSync(python, ["-W", "ignore", path.join(root, "scripts", "verify_runner.py"), path.join(tmp, "jobs.json")], { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" }));
for (const r of results) {
  const [slug, i] = r.id.split("|");
  const p = plan[slug];
  const failure = r.error || (r.plain && r.plain.exception) || r.exception;
  const ok = p.design ? !failure : /StubCalled/.test(failure || "");
  if (!ok) p.problems.push(`example ${+i + 1}: ${failure || "the call never reached " + "the method"}`);
}

let failed = 0;
for (const [slug, p] of Object.entries(plan)) if (p.problems.length) { failed++; console.log(`failed  ${slug}\n    ${p.problems.join("\n    ")}`); }
console.log(`\n${Object.keys(plan).length - failed} calls ok, ${failed} failed, ${manual.length} manual (checked by solution), ${skipped.length} without LeetCode metadata (${skipped.join(", ")})`);
process.exitCode = failed ? 1 : 0;
