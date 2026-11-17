// LeetCode values and types: parse LeetCode's test-case syntax, check a
// value against a parameter type from LeetCode's signature metadata, write
// it as Python source, and compare outputs. Pure functions (no DOM), shared
// by the extension page and the build/verify scripts (Node).
//
// Syntax: JSON-like, as in LeetCode's Testcase panel: [2,7,11,15], "abc",
// [["1","0"]], [1,null,2], true, 2.5. Numbers keep their exact text, so
// values beyond 2^53 survive the trip into Python.

export class LeetNum {
  constructor(text) { this.text = text; }
  get isInteger() { return /^-?\d+$/.test(this.text); }
  get value() { return Number(this.text); }
}

/** Parse one LeetCode value. Returns { ok: true, value } or { ok: false, error }. */
export function parseValue(text) {
  const s = String(text);
  let i = 0;
  const fail = (msg) => { throw new SyntaxError(msg); };
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const value = () => {
    ws();
    const c = s[i];
    if (c === "[") {
      i++;
      const arr = [];
      ws();
      if (s[i] === "]") { i++; return arr; }
      for (;;) {
        arr.push(value());
        ws();
        if (s[i] === ",") { i++; continue; }
        if (s[i] === "]") { i++; return arr; }
        fail(i >= s.length ? "Missing ]" : `Unexpected "${s[i]}" in a list`);
      }
    }
    if (c === '"') {
      let j = i + 1, out = "";
      while (j < s.length && s[j] !== '"') {
        if (s[j] === "\\") {
          const e = s[j + 1];
          const map = { n: "\n", t: "\t", r: "\r", b: "\b", f: "\f", '"': '"', "\\": "\\", "/": "/" };
          if (e === "u" && /^[0-9a-fA-F]{4}$/.test(s.slice(j + 2, j + 6))) { out += String.fromCharCode(parseInt(s.slice(j + 2, j + 6), 16)); j += 6; continue; }
          if (!(e in map)) fail("Unknown escape \\" + (e || ""));
          out += map[e]; j += 2; continue;
        }
        out += s[j++];
      }
      if (j >= s.length) fail("Missing closing quote");
      i = j + 1;
      return out;
    }
    const num = /^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/.exec(s.slice(i));
    if (num) { i += num[0].length; return new LeetNum(num[0]); }
    for (const [word, v] of [["null", null], ["true", true], ["false", false]]) {
      if (s.startsWith(word, i)) { i += word.length; return v; }
    }
    fail(i >= s.length ? "Missing a value" : `Unexpected "${s.slice(i, i + 10)}"`);
  };
  try {
    const v = value();
    ws();
    if (i < s.length) fail(`Unexpected "${s.slice(i, i + 10)}" after the value`);
    return { ok: true, value: v };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/** LeetCode metadata type string -> structured type. */
export function parseType(t) {
  t = String(t || "").trim();
  if (t.endsWith("[]")) return { kind: "list", of: parseType(t.slice(0, -2)) };
  const m = /^list<(.+)>$/i.exec(t);
  if (m) return { kind: "list", of: parseType(m[1]) };
  return { kind: "base", name: t };
}

const INT_TYPES = new Set(["integer", "int", "long"]);
const BASE_TYPES = new Set(["integer", "int", "long", "double", "float", "boolean", "string", "String", "character", "char", "ListNode", "TreeNode", "NestedInteger", "any"]);

/** Every base type in `type` is one we can build. */
export function isSupported(type) {
  const ty = typeof type === "string" ? parseType(type) : type;
  return ty.kind === "list" ? isSupported(ty.of) : BASE_TYPES.has(ty.name.replace(/\?$/, ""));
}

/** Check a parsed value against a type. Returns an error message or null. */
export function checkValue(v, type) {
  const ty = typeof type === "string" ? parseType(type) : type;
  if (ty.kind === "list") {
    if (!Array.isArray(v)) return "should be a list, like [1,2,3]";
    for (const [i, e] of v.entries()) {
      const err = checkValue(e, ty.of);
      if (err) return `item ${i}: ${err}`;
    }
    return null;
  }
  let n = ty.name;
  if (n.endsWith("?")) {                    // VisualLeet's own "or null" types, e.g. "integer?"
    if (v === null) return null;
    n = n.slice(0, -1);
  }
  if (INT_TYPES.has(n)) return v instanceof LeetNum && v.isInteger ? null : "should be a whole number";
  if (n === "double" || n === "float") return v instanceof LeetNum ? null : "should be a number";
  if (n === "boolean") return typeof v === "boolean" ? null : "should be true or false";
  if (n === "string" || n === "String") return typeof v === "string" ? null : 'should be a string in double quotes, like "abc"';
  if (n === "character" || n === "char") return typeof v === "string" && [...v].length === 1 ? null : 'should be one character in double quotes, like "a"';
  if (n === "any") return null;          // free-form value (hand-written entries, e.g. employee rows)
  if (n === "NestedInteger") {
    const ok = (x) => (x instanceof LeetNum && x.isInteger) || (Array.isArray(x) && x.every(ok));
    return ok(v) ? null : "should be a whole number or a nested list of them, like [1,[4,[6]]]";
  }
  if (n === "ListNode") {
    if (!Array.isArray(v)) return "should be a list of values, like [1,2,3] ([] for an empty list)";
    return v.every((e) => e instanceof LeetNum) ? null : "a linked list holds numbers only";
  }
  if (n === "TreeNode") {
    if (!Array.isArray(v)) return "should be a level-order list, like [1,null,2] ([] for an empty tree)";
    if (v.length && v[0] === null) return "the root can't be null (use [] for an empty tree)";
    return v.every((e) => e === null || e instanceof LeetNum) ? null : "a tree holds numbers and null only";
  }
  return `type ${n} isn't supported yet`;
}

/** Plain Python literal for a parsed value (no type conversion). */
export function pyLiteral(v) {
  if (v === null) return "None";
  if (v === true) return "True";
  if (v === false) return "False";
  if (v instanceof LeetNum) return v.text;
  if (typeof v === "string") return JSON.stringify(v);     // JSON string escapes are valid Python
  if (Array.isArray(v)) return "[" + v.map(pyLiteral).join(", ") + "]";
  throw new TypeError("not a LeetCode value");
}

/** Python source that builds `v` as `type` (helpers come from leet-helpers.js). */
export function toPython(v, type) {
  const ty = typeof type === "string" ? parseType(type) : type;
  if (ty.kind === "list") return "[" + v.map((e) => toPython(e, ty.of)).join(", ") + "]";
  if (ty.name === "ListNode") return `build_list(${pyLiteral(v)})`;
  if (ty.name === "TreeNode") return `build_tree(${pyLiteral(v)})`;
  if (ty.name === "NestedInteger") return `build_nested(${pyLiteral(v)})`;
  if ((ty.name === "double" || ty.name === "float") && v instanceof LeetNum && v.isInteger) return v.text + ".0";
  return pyLiteral(v);
}

/** Python helpers a type needs ("ListNode", "TreeNode"). */
export function helpersFor(type, into = new Set()) {
  const ty = typeof type === "string" ? parseType(type) : type;
  if (ty.kind === "list") return helpersFor(ty.of, into);
  if (ty.name === "ListNode" || ty.name === "TreeNode" || ty.name === "NestedInteger") into.add(ty.name);
  return into;
}

// ---------- comparing outputs ----------

function canon(v) {          // stable text for sorting
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v instanceof LeetNum) return "n" + v.value;
  return JSON.stringify(v);
}

function equal(a, b) {
  if (a instanceof LeetNum && b instanceof LeetNum) {
    if (a.isInteger && b.isInteger) return BigInt(a.text) === BigInt(b.text);
    return Math.abs(a.value - b.value) <= 1e-5 * Math.max(1, Math.abs(b.value));
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => equal(x, b[i]));
  return a === b;
}

const sortTop = (v) => (Array.isArray(v) ? [...v].sort((x, y) => (canon(x) < canon(y) ? -1 : canon(x) > canon(y) ? 1 : 0)) : v);
const sortDeep = (v) => (Array.isArray(v) ? sortTop(v.map(sortDeep)) : v);
const isSorted = (v) => !Array.isArray(v) || v.every((x, i) => i === 0 || canon(v[i - 1]) <= canon(x));

/**
 * Compare an output with the expected output (both LeetCode text).
 * anyOrder: the problem says "in any order": the outer order is ignored,
 * and inner order too when every inner list of the expected answer is sorted
 * (groups of anagrams, triplets), but not when it isn't (permutations).
 * Returns "match", "mismatch" or "unknown" (unparseable).
 */
export function compareOutputs(actual, expected, { anyOrder = false } = {}) {
  const a = parseValue(String(actual).trim()), e = parseValue(String(expected).trim());
  if (!a.ok || !e.ok) return String(actual).trim() === String(expected).trim() ? "match" : "unknown";
  if (equal(a.value, e.value)) return "match";
  if (anyOrder && Array.isArray(e.value)) {
    if (equal(sortTop(a.value), sortTop(e.value))) return "match";
    if (e.value.every(isSorted) && equal(sortDeep(a.value), sortDeep(e.value))) return "match";
  }
  return "mismatch";
}

// The language of LeetCode's code editor. LeetScope runs Python 3, so only
// "python3" works; "python" is LeetCode's Python 2. Names as in LeetCode's language menu.
const LANG_NAMES = {
  python: "Python", cpp: "C++", java: "Java", c: "C", csharp: "C#", javascript: "JavaScript",
  typescript: "TypeScript", php: "PHP", swift: "Swift", kotlin: "Kotlin", dart: "Dart", golang: "Go", go: "Go",
  ruby: "Ruby", scala: "Scala", rust: "Rust", racket: "Racket", erlang: "Erlang", elixir: "Elixir",
};
/** Shared by the message on LeetCode (background) and LeetScope's fallback (ui). */
export function describeLanguage(languageId) {
  if (languageId === "python3") return { ok: true, note: "" };
  const name = LANG_NAMES[languageId] || languageId || "an unknown language";
  const what = languageId === "python" ? "Python, which is Python 2" : name;
  return { ok: false, note: `LeetCode's code editor is set to ${what}. LeetScope runs Python 3. ` +
    "Choose Python3 in the language menu above LeetCode's code editor, then click Visualize again." };
}
