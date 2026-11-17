// Runs in the LeetCode page's main world (injected by the background worker
// on a toolbar click / shortcut). Read-only. Must be self-contained: Chrome
// serializes this one function into the page.
//
// Returns what LeetScope needs to visualize what the user is looking at: the
// problem (slug, title, LeetCode's signature metadata, examples with expected
// outputs), the code in the editor, and the inputs of the test case on screen.
// The background worker validates and bounds the result; nothing here is trusted.
//
// The test case comes from one of two places, whichever LeetCode is showing:
//  - the Testcase tab: one box per input (data-e2e-locator=console-testcase-input),
//    each labelled "name =" (design problems have no labels);
//  - the Test Result tab, after a Run: LeetCode removes the Testcase panel then,
//    and shows the selected case's inputs as "name =" over the value, each in
//    its own box.
//
// Page facts this relies on (checked on leetcode.com, 2026-11-17):
//  - window.monaco: the code editor's model (+ a plaintext model);
//  - the problem's data object (titleSlug, metaData, exampleTestcaseList,
//    content) lives in window.next.router.components after in-app navigation;
//    window.__NEXT_DATA__ only describes the first page loaded, so the slug
//    must match.
export async function readLeetCodePage() {
  const out = { ok: false };
  const host = location.hostname;
  if (!/(^|\.)leetcode\.(com|cn)$/.test(host)) { out.reason = "not-leetcode"; return out; }
  const m = /^\/problems\/([a-z0-9-]+)/.exec(location.pathname);
  if (!m) { out.reason = "not-problem"; return out; }
  out.slug = m[1];

  // ---- problem data ----
  const findQuestion = (root) => {
    const seen = new Set();
    const stack = [root];
    let budget = 200000;
    while (stack.length && budget-- > 0) {
      const x = stack.pop();
      if (!x || typeof x !== "object" || seen.has(x)) continue;
      seen.add(x);
      if (x.titleSlug === out.slug && typeof x.metaData === "string") return x;
      for (const k in x) {
        const v = x[k];
        if (v && typeof v === "object") stack.push(v);
      }
    }
    return null;
  };
  let q = null;
  try { q = findQuestion(window.next && window.next.router && window.next.router.components); } catch (e) { /* keep going */ }
  if (!q) { try { q = findQuestion(window.__NEXT_DATA__); } catch (e) { /* keep going */ } }
  if (q) {
    out.title = String(q.questionTitle || q.title || "");
    out.frontendId = String(q.questionFrontendId || "");
    out.metaData = q.metaData;
    out.exampleInputs = Array.isArray(q.exampleTestcaseList) ? q.exampleTestcaseList.map(String) : [];
    out.paidOnly = !!q.isPaidOnly;
    if (typeof q.content === "string" && q.content) {
      const doc = new DOMParser().parseFromString(q.content, "text/html");
      const text = (doc.body && doc.body.textContent) || "";
      out.exampleOutputs = [];
      // an output may span lines ("[\n[1,1,6],\n[1,2,5]\n]"): read up to the next section or blank line
      const re = /Output:?\s*([\s\S]*?)(?=\n\s*(?:Explanation|Example\s*\d|Constraints|Note|Follow)|\n\s*\n|$)/g;
      let mm;
      while ((mm = re.exec(text)) && out.exampleOutputs.length < 20) {
        out.exampleOutputs.push(mm[1].replace(/\s*\n\s*/g, "").trim());
        if (mm[0].length === 0) re.lastIndex++;
      }
      out.anyOrder = /\bin any order\b/i.test(text);
    }
  }
  if (!out.title) {
    const t = document.querySelector('.text-title-large, a[href^="/problems/"][class*="truncate"]');
    out.title = (t && t.textContent.trim()) || document.title.replace(/\s*-\s*LeetCode.*$/, "");
  }

  // ---- code ----
  const monaco = window.monaco;
  if (monaco && monaco.editor && typeof monaco.editor.getModels === "function") {
    let model = null;
    if (typeof monaco.editor.getEditors === "function") {
      const ed = monaco.editor.getEditors().find((e) => {
        const mo = e.getModel();
        const node = e.getContainerDomNode && e.getContainerDomNode();
        return mo && mo.getLanguageId() !== "plaintext" && node && node.offsetParent !== null;
      });
      if (ed) model = ed.getModel();
    }
    if (!model) {
      const models = monaco.editor.getModels().filter((x) => x.getLanguageId() !== "plaintext" && !x.isDisposed());
      model = models.sort((a, b) => b.getValueLength() - a.getValueLength())[0] || null;
    }
    if (model) { out.code = model.getValue(); out.language = model.getLanguageId(); }
  }

  // ---- the test case on screen ----
  const shown = (el) => el.offsetParent !== null;
  const clean = (t) => String(t || "").replace(/\xa0/g, " ").replace(/\n+$/, "").trim();
  const LABEL = /^\s*([A-Za-z_]\w*)\s*=\s*$/;

  // 1. the Testcase tab: its input boxes, in order, with their "name =" labels.
  // LeetCode builds the panel after the editor: wait for it briefly.
  const findBoxes = () => Array.from(document.querySelectorAll('[data-e2e-locator="console-testcase-input"]')).filter(shown);
  for (let i = 0; i < 15 && !findBoxes().length; i++) await new Promise((r) => setTimeout(r, 100));
  const fields = findBoxes().map((box) => {
    const holder = box.parentElement && box.parentElement.parentElement;
    const labelEl = holder ? Array.from(holder.children).find((c) => !c.contains(box)) : null;
    const label = LABEL.exec(labelEl ? labelEl.textContent : "");
    const lines = box.querySelectorAll("div, p");
    const text = lines.length ? Array.from(lines).map((l) => l.textContent).join("\n") : box.innerText;
    return { name: label ? label[1] : "", text: clean(text) };
  });
  if (fields.length) out.caseFrom = "testcase";

  // 2. else the Test Result tab: each "name =" label on screen (not in the code
  // editor or LeetScope's card) and its value: the lines after the label in the
  // smallest box around it that holds more than the label, up to the next label
  if (!fields.length) {
    const seen = new Set();
    for (const el of document.querySelectorAll("div, span, label")) {
      const m = !el.children.length && LABEL.exec(el.textContent);
      if (!m || seen.has(m[1]) || !shown(el) || el.closest(".monaco-editor, .cm-editor, #leetscope-toast")) continue;
      let box = el.parentElement;
      while (box && clean(box.innerText) === clean(el.textContent)) box = box.parentElement;
      if (!box) continue;
      const lines = clean(box.innerText).split("\n");
      const at = lines.findIndex((l) => { const x = LABEL.exec(l); return x && x[1] === m[1]; });
      if (at < 0) continue;
      const end = lines.findIndex((l, i) => i > at && LABEL.test(l));
      seen.add(m[1]);
      fields.push({ name: m[1], text: clean(lines.slice(at + 1, end < 0 ? undefined : end).join("\n")) });
    }
    if (fields.length) out.caseFrom = "test-result";
  }
  // a case is only usable when every input has a value
  if (fields.length && fields.every((f) => f.text)) out.selectedCase = fields;
  out.caseFound = { from: out.caseFrom || "", inputs: fields.length, empty: fields.filter((f) => !f.text).length };

  out.ok = true;
  return out;
}
