// Runs a LeetCode problem from its database file (src/problems/<slug>.json)
// and one test case. Nothing is generated here: the file already holds the
// input boxes, the hidden setup and the visible call; this module checks
// the box values and fills them in.
//
// Entry kinds:
//   template - setup/call text with {box} slots, replaced by that box's
//              value written as Python (e.g. {head} -> build_list([1, 2])).
//   design   - "operations" + "arguments" boxes; each argument is written
//              with the type the file lists for that method.
//
// fill(entry, texts) returns
//   setup   - hidden Python (imports, helpers, inputs); runs untraced
//   visible - names from setup shown in the visualization (the inputs)
//   code    - the visible call, appended to the user's code and traced
// or { ok: false, errors: { box: message } }.

import { parseValue, checkValue, toPython, helpersFor } from "./leet.js";
import { helperSource } from "./leet-helpers.js";

/** Parse and check every box against the entry's types. */
export function checkCase(entry, texts) {
  const values = {}, errors = {};
  for (const b of entry.boxes) {
    const text = texts[b.name];
    if (text === undefined || String(text).trim() === "") { errors[b.name] = "missing a value"; continue; }
    const r = parseValue(text);
    if (!r.ok) { errors[b.name] = r.error; continue; }
    if (b.type === "design-args") {
      if (!Array.isArray(r.value) || !r.value.every(Array.isArray)) { errors[b.name] = "should be a list of argument lists, like [[2],[1,1]]"; continue; }
    } else {
      const err = checkValue(r.value, b.type);
      if (err) { errors[b.name] = err; continue; }
    }
    values[b.name] = r.value;
  }
  if (entry.kind === "design" && !Object.keys(errors).length) {
    const ops = values.operations, args = values.arguments;
    if (ops.length !== args.length) errors.arguments = `has ${args.length} entries but there are ${ops.length} operations`;
    else if (!ops.length || ops[0] !== entry.className) errors.operations = `should start with "${entry.className}"`;
    else {
      for (const [i, op] of ops.entries()) {
        const ps = i === 0 ? entry.methods[entry.className] : op !== entry.className && entry.methods[op];
        if (!ps) { errors.operations = `item ${i}: ${entry.className} has no method "${op}"`; break; }
        // LeetCode sometimes writes [null] for a call with no arguments (e.g. Throne Inheritance)
        if (!ps.length && args[i].length === 1 && args[i][0] === null) args[i] = [];
        if (args[i].length !== ps.length) { errors.arguments = `item ${i} (${op}): expected ${ps.length} argument${ps.length === 1 ? "" : "s"}, got ${args[i].length}`; break; }
        const bad = ps.map((p, j) => [p, checkValue(args[i][j], p.type)]).find(([, e]) => e);
        if (bad) { errors.arguments = `item ${i} (${op}), ${bad[0].name}: ${bad[1]}`; break; }
      }
    }
  }
  return { values, errors };
}

/** Fill the entry's setup and call with one test case. `texts` maps box name -> LeetCode text. */
export function fill(entry, texts) {
  const { values, errors } = checkCase(entry, texts);
  if (Object.keys(errors).length) return { ok: false, errors };
  const helpers = new Set(entry.helpers || []);

  if (entry.kind === "design") {
    const typed = values.operations.map((op, i) => {
      const ps = i === 0 ? entry.methods[entry.className] : entry.methods[op];
      ps.forEach((p) => helpersFor(p.type, helpers));
      return "[" + ps.map((p, j) => toPython(values.arguments[i][j], p.type)).join(", ") + "]";
    });
    const inputs = `ops = ${JSON.stringify(values.operations)}\nargs = [${typed.join(", ")}]`;
    return { ok: true, setup: helperSource([...helpers]) + "\n\n" + inputs, inputs, visible: entry.visible, code: entry.call };
  }

  const slot = (tpl) => tpl.replace(/\{(\w+)\}/g, (all, name) => {
    const b = entry.boxes.find((x) => x.name === name);
    return b ? toPython(values[name], b.type) : all;
  });
  for (const b of entry.boxes) helpersFor(b.type, helpers);
  const inputs = slot(entry.setup);
  return { ok: true, setup: helperSource([...helpers]) + "\n\n" + inputs, inputs, visible: entry.visible, code: slot(entry.call) };
}

/** Split LeetCode's raw test-case text (one line per box) into cases. */
export function splitCases(entry, raw) {
  const lines = String(raw || "").replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  const n = entry.boxes.length;
  const cases = [];
  for (let i = 0; i + n <= lines.length; i += n) {
    const texts = {};
    entry.boxes.forEach((b, j) => { texts[b.name] = lines[i + j]; });
    cases.push(texts);
  }
  return cases;
}

/** The last line the program printed (the generated call prints the result last). */
export function resultLine(stdout) {
  const lines = String(stdout || "").replace(/\s+$/, "").split("\n");
  return lines[lines.length - 1] || "";
}
