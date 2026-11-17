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
//    (the selected one has the class "bg-fill-3"); the selected case shows one
//    contenteditable box per argument, labelled "name ="; a CodeMirror
//    (.cm-content) holds every case as raw lines.
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

  // ---- the test cases in LeetCode's Testcase panel ----
  // Read structure, not rendered text: the panel may be collapsed, or behind
  // "Test Result" after a Run; it's still in the page then, but innerText
  // runs "nums =" into the value and the raw lines into each other.
  // LeetCode builds the panel after the editor: wait for it briefly.
  const findTabs = () => Array.from(document.querySelectorAll('[data-e2e-locator="console-testcase-tag"]'));
  const findBoxes = () => Array.from(document.querySelectorAll('[data-e2e-locator="console-testcase-input"]'));
  for (let i = 0; i < 15 && !findTabs().length && !findBoxes().length; i++) await new Promise((r) => setTimeout(r, 100));
  const tabs = findTabs();
  out.caseCount = tabs.length;
  // the selected tab: LeetCode gives it the bg-fill-3 class (a whole class, not
  // hover:bg-fill-3). The others say bg-transparent only after a tab was clicked
  // (checked on leetcode.com 2026-11-17), so that is just the fallback.
  out.selectedIndex = tabs.findIndex((b) => b.classList.contains("bg-fill-3") || b.getAttribute("aria-selected") === "true");
  if (out.selectedIndex < 0 && tabs.length) out.selectedIndex = tabs.findIndex((b) => !b.classList.contains("bg-transparent"));
  if (tabs.length === 1) out.selectedIndex = 0;

  // the panel that holds the case tabs/boxes: only look for its raw editor in there
  // (a signed-in page can have other CodeMirror editors, e.g. Notes)
  const anchor = tabs[0] || findBoxes()[0] || null;
  let panel = anchor;
  while (panel && panel.parentElement && !panel.querySelector(".cm-content") && !/flexlayout__(tab|layout)\b/.test(panel.className || "")) panel = panel.parentElement;
  const textOf = (el) => (el.offsetParent !== null ? el.innerText : el.textContent) || "";

  // the selected case: one box per input, in order; the "name =" label is optional
  // (design problems have none)
  const fields = [];
  let boxes = findBoxes();
  // more than one set in the page (a hidden copy, e.g. after a Run): the one on screen
  const shown = boxes.filter((b) => b.offsetParent !== null);
  if (shown.length && shown.length < boxes.length) boxes = shown;
  if (!boxes.length && panel) boxes = Array.from(panel.querySelectorAll('[contenteditable="true"]')).filter((b) => !b.closest(".cm-editor"));
  for (const box of boxes) {
    const holder = box.parentElement && box.parentElement.parentElement;
    const labelEl = holder ? Array.from(holder.children).find((c) => !c.contains(box)) : null;
    const label = /^\s*([A-Za-z_]\w*)\s*=\s*$/.exec(labelEl ? labelEl.textContent : "");
    const lines = box.querySelectorAll("div, p");
    const text = lines.length ? Array.from(lines).map((l) => l.textContent).join("\n") : textOf(box);
    fields.push({ name: label ? label[1] : "", text: text.replace(/\xa0/g, " ").replace(/\n+$/, "") });
  }
  if (fields.length) out.selectedCase = fields;

  // every case as raw lines (one line per input), from the panel's own editor
  const raw = (panel && panel.querySelector(".cm-content")) || (document.querySelectorAll(".cm-content").length === 1 ? document.querySelector(".cm-content") : null);
  if (raw) {
    const lines = raw.querySelectorAll(".cm-line");
    out.rawCases = (lines.length ? Array.from(lines).map((l) => l.textContent).join("\n") : textOf(raw)).replace(/\xa0/g, " ");
  }
  // what was found, for the message if the case can't be matched to the inputs
  out.testcaseFound = {
    tabs: tabs.length, boxes: fields.length, rawLines: out.rawCases ? out.rawCases.split("\n").filter((l) => l.trim()).length : 0,
    // page markers near the test cases, to diagnose a LeetCode layout this reader doesn't know
    markers: Array.from(new Set(Array.from(document.querySelectorAll("[data-e2e-locator]")).map((e) => e.getAttribute("data-e2e-locator"))
      .filter((v) => /test|case|console|input/i.test(v)))).slice(0, 12),
  };

  out.ok = true;
  return out;
}
