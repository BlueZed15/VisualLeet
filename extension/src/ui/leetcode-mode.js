// LeetCode mode: the test-case panel. Holds the current problem (its
// database file, src/problems/<slug>.json), its test cases (the problem's
// examples, the case copied from LeetCode, the user's own), one box per
// input with live checks, the call (editable) and the hidden setup.
// State is saved per problem in localStorage, so cases survive reloads.

import { fill, splitCases } from "./harness.js";
import { parseValue, compareOutputs } from "./leet.js";

const KEY = "visualleet.lc.v1.";            // + slug
const LAST_KEY = "visualleet.lc.v1:last";

const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked: keep working */ } },
};

// Two texts are the same LeetCode value (ignoring spacing).
function sameValue(a, b) {
  const x = parseValue(a), y = parseValue(b);
  return x.ok && y.ok ? compareOutputs(a, b) === "match" : String(a).trim() === String(b).trim();
}
const sameTexts = (entry, a, b) => !!a && !!b && entry.boxes.every((x) => sameValue(a[x.name] ?? "", b[x.name] ?? ""));

const badgeFor = (entry) => (entry.verified ? ["verified", "✓ checked setup"] : ["unchecked", "setup not checked yet"]);

export function createLeetCodeMode(el, { onChange = () => {}, onSelect = () => {} } = {}) {
  let p = null;          // { slug, title, frontendId, anyOrder, cases: [], selectedId, callOverride }
  let entry = null;      // the problem's database file
  let counter = 1;

  const save = () => { if (p) { store.set(KEY + p.slug, p); store.set(LAST_KEY, p.slug); } };
  const current = () => (p ? p.cases.find((c) => c.id === p.selectedId) || p.cases[0] || null : null);

  /** Load a problem read from LeetCode, with its database entry. Returns { ok, note, fromLeetCode }. */
  function loadFromPage(r, dbEntry) {
    entry = dbEntry;
    const saved = store.get(KEY + r.slug);
    const outputsAligned = r.exampleOutputs && r.exampleOutputs.length === r.exampleInputs.length;
    const examples = (r.exampleInputs || []).map((input, i) => {
      const texts = splitCases(entry, input)[0];
      return texts && { id: "ex" + (i + 1), label: `Example ${i + 1}`, source: "example", texts, orig: { ...texts }, expected: outputsAligned ? r.exampleOutputs[i] : null };
    }).filter(Boolean);
    const yours = saved && saved.cases ? saved.cases.filter((c) => c.source === "yours") : [];

    // the case selected in LeetCode's Testcase panel
    let lc = null;
    const names = entry.boxes.map((x) => x.name);
    const fields = r.selectedCase || [];
    if (fields.length === names.length) {
      lc = {};
      const byName = names.every((n) => fields.some((f) => f.name === n));
      names.forEach((n, i) => { lc[n] = byName ? fields.find((f) => f.name === n).text : fields[i].text; });
    } else if (r.rawCases && r.selectedIndex >= 0) {
      lc = splitCases(entry, r.rawCases)[r.selectedIndex] || null;
    }
    const cases = [...examples];
    let selectedId = examples.length ? examples[0].id : null;
    let note = "";
    if (lc) {
      const ex = examples.find((e) => sameTexts(entry, e.texts, lc));
      if (ex) selectedId = ex.id;
      else { cases.push({ id: "lc", label: "From LeetCode", source: "leetcode", texts: lc }); selectedId = "lc"; }
    } else {
      note = "Couldn't read LeetCode's Testcase panel (is it open?), so the first example is selected.";
    }
    cases.push(...yours);
    if (!cases.length) cases.push({ id: "c" + counter++, label: "Case 1", source: "yours", texts: Object.fromEntries(names.map((n) => [n, ""])) });
    p = {
      slug: r.slug, title: r.title || entry.title, frontendId: r.frontendId || entry.frontendId, anyOrder: !!(r.anyOrder || entry.anyOrder),
      cases, selectedId: selectedId || cases[0].id,
      callOverride: saved && saved.callOverride ? saved.callOverride : null,
    };
    counter = 1 + cases.filter((c) => c.source === "yours").length;
    save();
    render();
    return { ok: true, note, fromLeetCode: !!lc };
  }

  /** The last problem's slug (to restore it without the page). */
  const lastSlug = () => store.get(LAST_KEY);

  /** Restore the last problem with its database entry. */
  function restore(dbEntry) {
    const saved = store.get(KEY + dbEntry.slug);
    if (!saved) return false;
    entry = dbEntry;
    p = saved;
    counter = 1 + p.cases.filter((c) => c.source === "yours").length;
    render();
    return true;
  }

  // ---------- rendering ----------

  function render() {
    if (!p) return;
    const badge = badgeFor(entry);
    el.title.textContent = (p.frontendId ? p.frontendId + ". " : "") + (p.title || p.slug);
    el.badge.textContent = badge[1];
    el.badge.dataset.kind = badge[0];
    el.badge.title = badge[0] === "verified"
      ? "This problem's setup in LeetScope's database was checked against LeetCode's examples."
      : "This problem's setup in LeetScope's database hasn't been checked yet. If the result looks wrong, look at the Call and Setup tabs.";
    renderTabs();
    renderCase();
  }

  function renderTabs() {
    el.tabs.replaceChildren(...p.cases.map((c) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tab";
      b.setAttribute("role", "tab");
      b.dataset.caseId = c.id;
      b.dataset.source = c.source;
      b.setAttribute("aria-selected", String(c.id === p.selectedId));
      b.tabIndex = c.id === p.selectedId ? 0 : -1;
      b.textContent = c.label;
      if (c.source === "leetcode") b.title = "The case that was selected in LeetCode's Testcase panel";
      b.addEventListener("click", () => { const changed = c.id !== p.selectedId; select(c.id); if (changed) onSelect(c.id); });
      return b;
    }));
  }

  function renderCase() {
    const c = current();
    el.fields.replaceChildren();
    if (!c) return;
    for (const prm of entry.boxes) {
      const wrap = document.createElement("div");
      wrap.className = "field";
      wrap.dataset.name = prm.name;
      const id = "box-" + prm.name;
      const label = document.createElement("label");
      label.htmlFor = id;
      label.append(`${prm.label || prm.name} =`);
      if (prm.hint) { const h = document.createElement("span"); h.className = "hint"; h.textContent = prm.hint; label.append(h); }
      const ta = document.createElement("textarea");
      ta.id = id;
      ta.rows = 1;
      ta.spellcheck = false;
      ta.value = c.texts[prm.name] ?? "";
      ta.setAttribute("aria-describedby", id + "-err");
      const err = document.createElement("div");
      err.className = "field-error";
      err.id = id + "-err";
      err.hidden = true;
      ta.addEventListener("input", () => {
        c.texts[prm.name] = ta.value;
        autosize(ta);
        save();
        check();
        onChange();
      });
      wrap.append(label, ta, err);
      el.fields.append(wrap);
    }
    el.fields.querySelectorAll("textarea").forEach(autosize);
    el.del.hidden = c.source === "example";
    el.source.textContent = { example: "From the problem's examples", leetcode: "Copied from LeetCode's Testcase panel", yours: "Your case" }[c.source] || "";
    setVerdict(null);
    check();
  }

  function autosize(ta) {
    ta.style.height = "auto";
    ta.style.height = Math.min(ta.scrollHeight + 2, 220) + "px";
  }

  /** Expected output for the current case, if it's an unchanged example. */
  function expected() {
    const c = current();
    return c && c.source === "example" && c.expected && sameTexts(entry, c.texts, c.orig) ? c.expected : null;
  }

  // Validate the boxes, refresh the expected output, call and setup views.
  function check() {
    const c = current();
    if (!c) return { ok: false, errors: {} };
    const g = fill(entry, c.texts);
    for (const wrap of el.fields.querySelectorAll(".field")) {
      const msg = g.ok ? null : g.errors[wrap.dataset.name];
      wrap.toggleAttribute("data-invalid", !!msg);
      const err = wrap.querySelector(".field-error");
      err.textContent = msg ? msg : "";
      err.hidden = !msg;
    }
    const exp = expected();
    el.expected.hidden = !exp;
    if (exp) { el.expected.replaceChildren("Expected ", Object.assign(document.createElement("code"), { textContent: exp })); }
    if (g.ok) {
      el.setup.value = g.setup;
      if (!p.callOverride) el.call.value = g.code;
    } else {
      el.setup.value = "# Fix the test-case values to see the setup.";
      if (!p.callOverride) el.call.value = "# Fix the test-case values to see the call.";
    }
    el.callReset.hidden = !p.callOverride;
    el.callNote.textContent = p.callOverride ? "Edited: your version runs." : "Generated from the problem's signature. Edit to change what runs.";
    return g;
  }

  function select(id) {
    if (!p || !p.cases.some((c) => c.id === id)) return;
    p.selectedId = id;
    save();
    renderTabs();
    renderCase();
    onChange();
  }

  function addCase() {
    if (!p) return;
    const c = current();
    const n = counter++;
    const id = "c" + Date.now().toString(36) + n;
    p.cases.push({ id, label: `Case ${n}`, source: "yours", texts: { ...(c ? c.texts : {}) } });
    select(id);
    const first = el.fields.querySelector("textarea");
    if (first) first.focus();
  }

  function deleteCase() {
    if (!p) return;
    const c = current();
    if (!c || c.source === "example") return;
    p.cases = p.cases.filter((x) => x.id !== c.id);
    select(p.cases.length ? p.cases[0].id : null);
  }

  el.add.addEventListener("click", addCase);
  el.del.addEventListener("click", deleteCase);
  el.call.addEventListener("input", () => { if (p) { p.callOverride = el.call.value; save(); el.callReset.hidden = false; el.callNote.textContent = "Edited: your version runs."; } });
  el.callReset.addEventListener("click", () => { if (p) { p.callOverride = null; save(); check(); } });

  /** The program for the selected case: { ok, setup, visible, code } or { ok: false, errors }. */
  function program() {
    const g = check();
    if (!g.ok) return g;
    return p.callOverride ? { ...g, code: p.callOverride } : g;
  }

  // ---------- verdict ----------

  function setVerdict(v) {
    if (!v) { el.verdict.hidden = true; el.verdict.replaceChildren(); return; }
    const code = (t) => Object.assign(document.createElement("code"), { textContent: t });
    el.verdict.dataset.kind = v.kind;
    if (v.kind === "match") el.verdict.replaceChildren("✓ Output ", code(v.got), " matches the expected output.");
    else if (v.kind === "mismatch") el.verdict.replaceChildren("✗ Output ", code(v.got || "(nothing)"), "\nexpected ", code(v.expected));
    else el.verdict.replaceChildren(v.text ? v.text : "Output ", ...(v.text ? [] : [code(v.got || "(nothing)")]));
    el.verdict.hidden = false;
  }

  /** Judge a finished run: got = the last printed line (null if no result). */
  function judge(got, problemText) {
    const exp = expected();
    if (problemText) return setVerdict({ kind: "output", text: problemText });   // no result to compare
    if (!exp) return setVerdict({ kind: "output", got });
    const r = compareOutputs(got, exp, { anyOrder: p.anyOrder });
    if (r === "unknown") return setVerdict({ kind: "output", got });     // couldn't read one of them: no verdict
    if (r !== "match" && entry.multipleAnswers) {
      // a different answer can be right here: don't call it wrong
      setVerdict({ kind: "output", text: `Output ${got || "(nothing)"}. LeetCode accepts several answers for this problem; the example shows ${exp}.` });
      return "different";
    }
    setVerdict({ kind: r === "match" ? "match" : "mismatch", got, expected: exp });
    return r;
  }

  return {
    loadFromPage, restore, program, judge, select, addCase,
    get problem() { return p; },
    get entry() { return entry; }, lastSlug,
    currentCase: current,
    expected,
  };
}
