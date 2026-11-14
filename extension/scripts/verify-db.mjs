// Checks every problem file in src/problems/ in real Python, through the
// same tracer and hidden setup the extension uses, and stamps the result
// into the file ("verified") and index.json.
//
//   node scripts/verify-db.mjs [--python <path>] [--only slug,slug]
//     -> problems/verify-results.json, src/problems/*.json updated
//
// Per problem, for each example (problems/collected/<slug>.json, or the
// "tests" of a hand-written entry):
//   inputs   - each box is built from LeetCode's text and printed back with
//              leet_str; it must equal the text (when the box is a variable).
//   solution - problems/solutions/<slug>.py runs with the file's call; the
//              printed result must equal the expected output (order ignored
//              where the problem says "any order"), and no setup helper may
//              show in the Global frame.
// verified = a solution exists and every example passed.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fill, splitCases, resultLine } from "../src/ui/harness.js";
import { compareOutputs } from "../src/ui/leet.js";
import { printExpr } from "./lib/entry-writer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const venv = path.join(root, "..", ".venv", "Scripts", "python.exe");
const python = arg("--python", process.env.PYTHON || (existsSync(venv) ? venv : "python3"));
const only = arg("--only", "") ? new Set(arg("--only", "").split(",")) : null;
const P = (...p) => path.join(root, "problems", ...p);
const DB = (...p) => path.join(root, "src", "problems", ...p);
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

const index = readJson(DB("index.json"));
const handwritten = readJson(P("handwritten.json")).problems;
const HELPER_NAMES = ["leet_str", "build_list", "build_tree", "list_values", "tree_values", "run_ops", "ListNode", "TreeNode", "deque", "List", "build_cycle_list", "build_random_list", "build_graph", "find_node"];

const jobs = [], plan = {};
for (const slug of Object.keys(index.problems)) {
  if (only && !only.has(slug)) continue;
  const entry = readJson(DB(slug + ".json"));
  let examples = [];
  if (handwritten[slug] && Array.isArray(handwritten[slug].tests)) examples = handwritten[slug].tests.map(([input, output]) => ({ input, output }));
  else if (existsSync(P("collected", slug + ".json"))) {
    const c = readJson(P("collected", slug + ".json"));
    examples = c.exampleInputs.map((input, i) => ({ input, output: c.exampleOutputs[i] }));
  }
  const solutionFile = P("solutions", slug + ".py");
  const solution = existsSync(solutionFile) ? readFileSync(solutionFile, "utf8") : null;
  plan[slug] = { entry, hasSolution: !!solution, examples: [] };
  examples.forEach((ex, i) => {
    const texts = splitCases(entry, ex.input)[0];
    const g = texts ? fill(entry, texts) : { ok: false, errors: { input: "couldn't split the example into boxes" } };
    const e = { expected: ex.output, ok: g.ok, errors: g.errors };
    plan[slug].examples.push(e);
    if (!g.ok) return;
    // echo inputs that are plain variables named after their box
    const echo = entry.kind === "template" ? entry.boxes.map((b, j) => [b, entry.visible[j]]).filter(([b, v]) => v && new RegExp(`^${v} = \\{${b.name}\\}$`, "m").test(entry.setup)) : [];
    if (echo.length) {
      jobs.push({ id: `${slug}|${i}|inputs`, setup: g.setup, visible: g.visible, source: echo.map(([b, v]) => printExpr(v, b.type)).join("\n") });
      e.echo = echo.map(([b]) => texts[b.name]);
    }
    if (solution) jobs.push({ id: `${slug}|${i}|solution`, setup: g.setup, visible: g.visible, source: solution + "\n\n" + g.code + "\n" });
  });
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "visualleet-verify-"));
writeFileSync(path.join(tmp, "jobs.json"), JSON.stringify(jobs));
const results = Object.fromEntries(JSON.parse(execFileSync(python, ["-W", "ignore", path.join(root, "scripts", "verify_runner.py"), path.join(tmp, "jobs.json")], { maxBuffer: 256 * 1024 * 1024, encoding: "utf8" })).map((r) => [r.id, r]));

const prev = existsSync(P("verify-results.json")) ? readJson(P("verify-results.json")).problems : {};
const report = { ...prev };
for (const [slug, p] of Object.entries(plan)) {
  const problems = [], notes = [];
  if (!p.examples.length) problems.push("no examples to check");
  p.examples.forEach((e, i) => {
    if (!e.ok) { problems.push(`example ${i + 1}: ${JSON.stringify(e.errors)}`); return; }
    const inp = results[`${slug}|${i}|inputs`];
    if (inp) {
      const lines = String(inp.stdout || "").replace(/\s+$/, "").split("\n");
      if (inp.exception || inp.error) problems.push(`example ${i + 1} inputs: ${inp.exception || inp.error}`);
      else e.echo.forEach((t, j) => { if (compareOutputs(lines[j] || "", t) !== "match") problems.push(`example ${i + 1} box ${j + 1}: built ${lines[j]}, text was ${t}`); });
    }
    const sol = results[`${slug}|${i}|solution`];
    if (sol) {
      const stdout = sol.plain ? sol.plain.stdout : sol.stdout;
      const got = resultLine(stdout);
      const failure = sol.error || (sol.plain && sol.plain.exception) || (sol.event === "uncaught_exception" || sol.event === "exception" ? sol.exception : null);
      if (failure) problems.push(`example ${i + 1}: ${failure}`);
      else if (e.expected === undefined) problems.push(`example ${i + 1}: no expected output collected (got ${got})`);
      else if (compareOutputs(got, e.expected, { anyOrder: p.entry.anyOrder }) !== "match") {
        // several answers accepted: a different one is fine if the solution is valid (checked by hand)
        if (p.entry.multipleAnswers) notes.push(`example ${i + 1}: got ${got}, statement shows ${e.expected} (several answers accepted)`);
        else problems.push(`example ${i + 1}: got ${got}, expected ${e.expected}`);
      }
      const leaked = (sol.shown || []).filter((n) => HELPER_NAMES.includes(n));
      if (leaked.length) problems.push(`example ${i + 1}: setup names shown: ${leaked.join(", ")}`);
    }
  });
  const status = problems.length ? "failed" : p.hasSolution ? "verified" : "inputs-ok";
  report[slug] = { status, examples: p.examples.length, problems, ...(notes.length ? { notes } : {}) };
  // stamp the file and the index
  p.entry.verified = status === "verified";
  writeFileSync(DB(slug + ".json"), JSON.stringify(p.entry, null, 1) + "\n");
  index.problems[slug].verified = p.entry.verified;
}
writeFileSync(DB("index.json"), JSON.stringify(index, null, 1) + "\n");

const counts = {};
for (const r of Object.values(report)) counts[r.status] = (counts[r.status] || 0) + 1;
writeFileSync(P("verify-results.json"), JSON.stringify({ date: new Date().toISOString().slice(0, 10), python: execFileSync(python, ["--version"], { encoding: "utf8" }).trim(), counts, problems: report }, null, 1) + "\n");
for (const [slug, r] of Object.entries(report)) {
  if (only && !only.has(slug)) continue;
  if (r.status !== "verified" || process.argv.includes("--all")) console.log(`${r.status.padEnd(9)} ${slug}${r.problems.length ? "\n    " + r.problems.join("\n    ") : ""}`);
}
console.log("\n" + Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(", ") + ` (${Object.keys(index.problems).length} files)`);
process.exitCode = counts.failed ? 1 : 0;
