// Turning the three editable areas into one program, and drafting a test call
// for an imported LeetCode solution. Everything here produces *visible,
// editable* text; nothing is run or converted behind the user's back.

import { HELPERS } from "./examples.js";

/** The exact program that runs: setup, solution, test call, in that order. */
export function composeSource({ setup = "", solution = "", call = "" }) {
  const parts = [setup, solution, call]
    .map((s) => s.replace(/\s+$/, ""))
    .filter((s) => s.trim() !== "");
  return parts.length ? parts.join("\n\n") + "\n" : "";
}

/** True if the program has any top-level statement besides definitions/imports/comments. */
export function hasTopLevelCode(source) {
  let inTripleQuote = false;
  for (const line of source.split("\n")) {
    const triples = (line.match(/"""|'''/g) || []).length;
    const wasInside = inTripleQuote;
    if (triples % 2 === 1) inTripleQuote = !inTripleQuote;
    if (wasInside) continue;
    if (!line.trim() || /^\s/.test(line)) continue;
    if (/^(def|class|async\s+def|import|from|@|#)\b|^#/.test(line)) continue;
    return true;
  }
  return false;
}

// ---- LeetCode import ----

const PY_LANGS = new Set(["python3", "python"]);

export function describeLanguage(languageId) {
  if (PY_LANGS.has(languageId)) return { ok: true, note: languageId === "python" ? "This editor is set to Python 2. LeetScope runs Python 3. Most solutions work, but Python 2 syntax such as print statements won't." : "" };
  return { ok: false, note: `The LeetCode editor is set to ${languageId || "an unknown language"}. LeetScope runs Python 3. Switch the editor to Python3 and import again. Your current code here is unchanged.` };
}

function splitTopLevel(text, sep) {
  const out = [];
  let depth = 0, quote = null, cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") { cur += text[++i] || ""; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if ("([{".includes(ch)) depth++;
    if (")]}".includes(ch)) depth--;
    if (ch === sep && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** JSON-style literals in LeetCode examples -> Python (outside strings only). */
export function toPythonLiteral(value) {
  let out = "", quote = null;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (quote) { out += ch; if (ch === "\\") out += value[++i] || ""; else if (ch === quote) quote = null; continue; }
    if (ch === '"' || ch === "'") { quote = ch; out += ch; continue; }
    const rest = value.slice(i);
    const m = /^(true|false|null)\b/.exec(rest);
    if (m && !/[A-Za-z0-9_]/.test(value[i - 1] || "")) {
      out += { true: "True", false: "False", null: "None" }[m[1]];
      i += m[1].length - 1;
      continue;
    }
    out += ch;
  }
  return out.trim();
}

/** "nums = [2,7], target = 9" or one assignment per line -> [{name, value}] */
export function parseExampleInput(text) {
  const joined = text.replace(/\r/g, "").split("\n").map((l) => l.trim()).filter(Boolean).join(", ");
  const pieces = [];
  for (const part of splitTopLevel(joined, ",")) {
    const m = /^\s*([A-Za-z_]\w*)\s*=\s*([\s\S]+)$/.exec(part);
    if (m) pieces.push({ name: m[1], value: m[2].trim() });
    else if (pieces.length) pieces[pieces.length - 1].value += ", " + part.trim();  // a comma inside an unbracketed value
    else return null;
  }
  return pieces.length ? pieces : null;
}

/** First public method of `class Solution` and its parameters (with annotations). */
export function findSolutionMethod(code) {
  const cls = /^class\s+Solution\b[^\n]*:\s*$/m.exec(code);
  if (!cls) return null;
  const body = code.slice(cls.index);
  const re = /^\s+def\s+([A-Za-z]\w*)\s*\(\s*self\s*(?:,([^)]*))?\)\s*(?:->\s*([^:]+))?:/gm;
  let m;
  while ((m = re.exec(body))) {
    if (m[1].startsWith("_")) continue;
    const params = m[2] ? splitTopLevel(m[2], ",").map((p) => {
      const [nameAnn] = p.split("=");
      const [name, ann = ""] = nameAnn.split(":");
      return { name: name.trim().replace(/^\*+/, ""), annotation: ann.trim() };
    }).filter((p) => p.name) : [];
    return { name: m[1], params, returns: (m[3] || "").trim() };
  }
  return null;
}

function helperFor(annotation) {
  if (/ListNode/.test(annotation)) return { helper: "Linked list (ListNode)", build: "build_list", show: "list_values" };
  if (/TreeNode/.test(annotation)) return { helper: "Binary tree (TreeNode)", build: "build_tree", show: null };
  if (/NestedInteger/.test(annotation)) return { helper: "NestedInteger", build: "build_nested", show: null };
  return null;
}

/**
 * Draft setup + test call for an imported solution.
 * Returns { setup, call, notes[] }. Always editable; may contain TODOs.
 */
export function draftForSolution(code, examples = []) {
  const notes = [];
  const method = findSolutionMethod(code);
  const usesTyping = /\b(List|Optional|Dict|Set|Tuple)\[/.test(code);
  const helpers = new Set();
  if (usesTyping) helpers.add("Typing imports");
  if (!method) {
    notes.push("No class Solution method was found. Add your own test call below.");
    return { setup: setupFrom(helpers, code), call: "# TODO: call your code here, e.g.\n# print(my_function(...))", notes };
  }
  const parsed = examples.map(parseExampleInput).find(Boolean);
  const lines = [];
  const args = [];
  for (const [i, p] of method.params.entries()) {
    const h = helperFor(p.annotation);
    if (h) helpers.add(h.helper);
    const fromExample = parsed && (parsed.find((x) => x.name === p.name) || parsed[i]);
    const value = fromExample ? toPythonLiteral(fromExample.value) : "...  # TODO: fill in";
    lines.push(`${p.name} = ${h ? `${h.build}(${value})` : value}`);
    args.push(p.name);
  }
  const ret = helperFor(method.returns);
  if (ret) helpers.add(ret.helper);
  const callExpr = `Solution().${method.name}(${args.join(", ")})`;
  lines.push(ret && ret.show ? `print(${ret.show}(${callExpr}))` : `print(${callExpr})`);
  if (parsed) notes.push("Test call drafted from the problem's first example. Check the values before running.");
  else notes.push("LeetScope couldn't read an example input. Fill in the TODO values in the test call.");
  if (ret && !ret.show) notes.push(`${method.name} returns a ${method.returns}; the printed value is the node object. Step through the visualization to see its structure.`);
  return { setup: setupFrom(helpers, code), call: lines.join("\n"), notes };
}

function setupFrom(helpers, code) {
  const parts = [];
  for (const name of ["Typing imports", "Linked list (ListNode)", "Binary tree (TreeNode)", "NestedInteger"]) {
    if (!helpers.has(name)) continue;
    // don't duplicate a class the solution already defines
    const cls = /^class (\w+)/m.exec(HELPERS[name]);
    if (cls && new RegExp("^class\\s+" + cls[1] + "\\b", "m").test(code)) continue;
    parts.push(HELPERS[name]);
  }
  return parts.join("\n\n");
}
