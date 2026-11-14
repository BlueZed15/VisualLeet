// Build-time only (scripts/build-db.mjs): writes a database entry for a
// problem from LeetCode's signature metadata. The extension never runs this;
// it reads the files this produces (src/problems/<slug>.json), which can
// also be edited by hand.
import { parseType, isSupported, helpersFor } from "../../src/ui/leet.js";

const PY_RESERVED = new Set([
  "False", "None", "True", "and", "as", "assert", "async", "await", "break", "class", "continue", "def", "del", "elif",
  "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is", "lambda", "nonlocal", "not", "or",
  "pass", "raise", "return", "try", "while", "with", "yield", "match", "case", "type",
  "abs", "all", "any", "bin", "bool", "chr", "dict", "divmod", "enumerate", "filter", "float", "format", "hash", "hex",
  "id", "input", "int", "isinstance", "iter", "len", "list", "map", "max", "min", "next", "object", "oct", "ord", "pow",
  "print", "range", "repr", "reversed", "round", "set", "slice", "sorted", "str", "sum", "tuple", "zip",
  "Solution", "result", "obj", "out", "leet_str", "run_ops", "ops", "args",
]);

/** Variable name that can't shadow anything the user's code needs. */
export function safeName(name) {
  const n = /^[A-Za-z_]\w*$/.test(name) ? name : "arg";
  return PY_RESERVED.has(n) ? n + "_" : n;
}

/** Python statement printing `expr` the way LeetCode shows `type` (an empty list/tree is []). */
export function printExpr(expr, type) {
  const ty = parseType(type || "");
  if (ty.kind === "list" && ty.of.kind === "base" && ty.of.name === "ListNode") return `print(leet_str([list_values(x) for x in ${expr}]))`;
  if (ty.kind === "list" && ty.of.kind === "base" && ty.of.name === "TreeNode") return `print(leet_str([tree_values(x) for x in ${expr}]))`;
  if (ty.kind === "base" && ty.name === "ListNode") return `print(leet_str(list_values(${expr})))`;
  if (ty.kind === "base" && ty.name === "TreeNode") return `print(leet_str(tree_values(${expr})))`;
  return `print(leet_str(${expr}))`;
}

// Parameters marked for one language only (e.g. C's "numsSize") aren't Python's.
const forPython = (ps) => (ps || []).filter((p) => !p.lang || /^python/.test(p.lang));

/** Entry fields for LeetCode metadata, or { error } when it needs a hand-written entry. */
export function entryFromMeta(m) {
  if (m.systemdesign) {
    const methods = { [m.classname]: forPython(m.constructor && m.constructor.params) };
    for (const x of m.methods || []) methods[x.name] = forPython(x.params);
    const bad = Object.values(methods).flat().find((p) => !isSupported(p.type));
    if (bad) return { error: `type ${bad.type} isn't supported` };
    const helpers = new Set(["run_ops"]);
    Object.values(methods).flat().forEach((p) => helpersFor(p.type, helpers));
    // the user's code builds/annotates with the node classes it returns, too
    for (const x of m.methods || []) if (x.return && x.return.type && isSupported(x.return.type)) helpersFor(x.return.type, helpers);
    return {
      kind: "design", className: m.classname,
      methods: Object.fromEntries(Object.entries(methods).map(([k, ps]) => [k, ps.map((p) => ({ name: p.name, type: p.type }))])),
      boxes: [{ name: "operations", type: "string[]" }, { name: "arguments", type: "design-args" }],
      helpers: [...helpers], visible: ["ops", "args"],
      call: `obj = ${m.classname}(*args[0])\nout = [None] + run_ops(obj, ops[1:], args[1:])\nprint(leet_str(out))`,
    };
  }
  if (m.manual) return { error: "LeetCode marks it manual: needs a hand-written entry" };
  const params = forPython(m.params);
  const bad = params.find((p) => !isSupported(p.type));
  if (bad) return { error: `type ${bad.type} (${bad.name}) isn't supported` };
  m = { ...m, params };
  const names = m.params.map((p) => safeName(p.name));
  const ret = (m.return && m.return.type) || "void";
  // node classes the user's code needs: from the inputs (added at fill time) and the return type
  const helpers = ret !== "void" && isSupported(ret) ? [...helpersFor(ret)] : [];
  const call = `Solution().${m.name}(${names.join(", ")})`;
  const out = m.output && Number.isInteger(m.output.paramindex) ? m.output.paramindex : null;
  return {
    kind: "template",
    boxes: m.params.map((p) => ({ name: p.name, type: p.type })),
    helpers,
    setup: m.params.map((p, i) => `${names[i]} = {${p.name}}`).join("\n"),
    visible: names,
    call: ret === "void" && out !== null ? `${call}\n${printExpr(names[out], m.params[out].type)}`
      : ret === "void" ? `${call}\nprint("null")`
      : `result = ${call}\n${printExpr("result", ret)}`,
  };
}
