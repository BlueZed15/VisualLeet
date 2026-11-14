// Runs in the LeetCode page's main world (injected by the background worker
// on a toolbar click / shortcut). Read-only. Must be self-contained: Chrome
// serializes this one function into the page.
//
// Returns everything VisualLeet needs to visualize what the user is looking
// at: the problem (slug, title, LeetCode's signature metadata, examples with
// expected outputs), the code in the editor, and the test case currently
// selected in LeetCode's Testcase panel. The background worker validates and
// bounds the result; nothing here is trusted.
//
// Page facts this relies on (checked on leetcode.com, 2026-11-14):
//  - window.monaco: the code editor's model (+ a plaintext model);
//  - the problem's data object (titleSlug, metaData, exampleTestcaseList,
//    content) lives in window.next.router.components after in-app navigation;
//    window.__NEXT_DATA__ only describes the first page loaded, so the slug
//    must match;
//  - Testcase panel: case tabs are button[data-e2e-locator=console-testcase-tag]
//    (the selected one is not "bg-transparent"); the selected case shows one
//    contenteditable box per argument, labelled "name ="; a CodeMirror
//    (.cm-content) holds every case as raw lines.
export function readLeetCodePage() {
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

  // ---- the selected test case ----
  const tabs = Array.from(document.querySelectorAll('[data-e2e-locator="console-testcase-tag"]'));
  if (tabs.length) {
    out.caseCount = tabs.length;
    out.selectedIndex = tabs.findIndex((b) => !/\bbg-transparent\b/.test(b.className));
  }
  // Read structure, not rendered text: when the panel isn't shown (collapsed,
  // or "Test Result" is the active tab after a Run), innerText falls back to
  // textContent and runs "nums =" into the value, and lines into each other.
  const textOf = (el) => (el.offsetParent !== null ? el.innerText : el.textContent) || "";
  const fields = [];
  const marked = document.querySelectorAll('[data-e2e-locator="console-testcase-input"]');
  for (const box of Array.from(marked.length ? marked : document.querySelectorAll('[contenteditable="true"]'))) {
    if (box.closest(".cm-editor") || box.closest(".monaco-editor")) continue;
    const holder = box.parentElement && box.parentElement.parentElement;
    if (!holder) continue;
    // the label is the holder's text before the box: "nums ="
    const labelEl = Array.from(holder.children).find((c) => !c.contains(box));
    const label = /^\s*([A-Za-z_]\w*)\s*=\s*$/.exec(labelEl ? labelEl.textContent : "");
    if (!label) continue;
    const lines = box.querySelectorAll("div, p");
    const text = lines.length ? Array.from(lines).map((l) => l.textContent).join("\n") : textOf(box);
    fields.push({ name: label[1], text: text.replace(/\xa0/g, " ").replace(/\n+$/, "") });
  }
  if (fields.length) out.selectedCase = fields;
  const raw = document.querySelector(".cm-content");
  if (raw) {
    const lines = raw.querySelectorAll(".cm-line");
    out.rawCases = (lines.length ? Array.from(lines).map((l) => l.textContent).join("\n") : textOf(raw)).replace(/\xa0/g, " ");
  }

  out.ok = true;
  return out;
}
