// MV3 service worker. Never runs Python. Responsibilities:
//  - toolbar click: remember the page the user was on (activeTab grants
//    temporary access to it), then open or focus the VisualLeet tab;
//  - imports requested by the VisualLeet page: read the selection, or the
//    LeetCode editor, from that page, validate and bound the result.

const UI_PATH = "ui/index.html";
const MAX_CODE_BYTES = 256 * 1024;
const MAX_EXAMPLES = 5;
const MAX_EXAMPLE_CHARS = 4000;

chrome.action.onClicked.addListener(async (tab) => {
  const uiUrl = chrome.runtime.getURL(UI_PATH);
  const sourceTabId = tab && typeof tab.id === "number" && !(tab.url || "").startsWith(uiUrl) ? tab.id : null;
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"], documentUrls: [uiUrl + "*"] }).catch(() => []);
  const existing = contexts.find((c) => typeof c.tabId === "number" && c.tabId >= 0);
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true });
    if (typeof existing.windowId === "number") await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    if (sourceTabId !== null) {
      chrome.runtime.sendMessage({ type: "source-tab", tabId: sourceTabId, title: tab.title || "", url: tab.url || "" }).catch(() => {});
    }
    return;
  }
  const url = new URL(uiUrl);
  if (sourceTabId !== null) url.searchParams.set("sourceTab", String(sourceTabId));
  await chrome.tabs.create({ url: url.toString(), index: typeof tab?.index === "number" ? tab.index + 1 : undefined });
});

// Only the VisualLeet page may ask for imports.
function fromOurUi(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === "string" &&
         sender.url.startsWith(chrome.runtime.getURL(UI_PATH));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!fromOurUi(sender) || !msg || typeof msg !== "object") return;
  if (msg.type === "import" && typeof msg.tabId === "number" && (msg.mode === "selection" || msg.mode === "leetcode")) {
    (msg.mode === "selection" ? importSelection(msg.tabId) : importLeetCode(msg.tabId)).then(sendResponse);
    return true;   // async response
  }
  if (msg.type === "describe-tab" && typeof msg.tabId === "number") {
    chrome.tabs.get(msg.tabId).then((t) => sendResponse({ title: t.title || "", url: t.url || "" }), () => sendResponse(null));
    return true;
  }
});

function friendlyError(err) {
  const text = String((err && err.message) || err);
  if (/Cannot access|cannot be scripted|chrome:\/\/|extensions gallery|Missing host permission|permission/i.test(text)) {
    return "LeetScope can't read that page. Pages like chrome:// and the Chrome Web Store are protected, and access ends when the page navigates. " +
           "Click the LeetScope toolbar button again on the page you want, or paste your code instead.";
  }
  if (/No tab with id/i.test(text)) return "That page was closed. Open it again, click the LeetScope toolbar button, or paste your code instead.";
  return "Import failed: " + text;
}

const utf8Length = (s) => new TextEncoder().encode(s).length;

// ---- selection ----

// Runs in the page (isolated world). Returns the selected text, preserving
// line breaks; handles selections inside text fields too.
function readSelection() {
  const active = document.activeElement;
  if (active && (active.tagName === "TEXTAREA" || (active.tagName === "INPUT" && active.type === "text")) &&
      typeof active.selectionStart === "number" && active.selectionEnd > active.selectionStart) {
    return active.value.slice(active.selectionStart, active.selectionEnd);
  }
  const sel = window.getSelection();
  return sel ? sel.toString() : "";
}

async function importSelection(tabId) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, func: readSelection });
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
  // prefer the top frame, then the first frame with a selection
  const texts = results.map((r) => (typeof r.result === "string" ? r.result : "")).filter((t) => t.trim());
  const text = (texts[0] || "").replace(/\r\n?/g, "\n").replace(/ /g, " ");
  if (!text.trim()) {
    return { ok: false, error: "Nothing is selected on that page. Select your code there first (or paste it here). Your current code was kept." };
  }
  if (utf8Length(text) > MAX_CODE_BYTES) return { ok: false, error: "The selection is larger than 256 KiB." };
  return { ok: true, text };
}

// ---- LeetCode editor ----

// Runs in the page's main world, because the editor (Monaco) lives there.
// It only reads: the code model of the editor, its language, the problem
// title, and the example inputs from the description.
function readLeetCodeEditor() {
  const host = location.hostname;
  if (!/(^|\.)leetcode\.(com|cn)$/.test(host)) return { ok: false, reason: "not-leetcode" };
  const monaco = window.monaco;
  if (!monaco || !monaco.editor || typeof monaco.editor.getModels !== "function") return { ok: false, reason: "no-editor" };
  const models = monaco.editor.getModels().filter((m) => m.getLanguageId() !== "plaintext" && !m.isDisposed());
  if (!models.length) return { ok: false, reason: "no-editor" };
  // the code editor is the model attached to a visible editor; fall back to the largest model
  let model = null;
  if (typeof monaco.editor.getEditors === "function") {
    const ed = monaco.editor.getEditors().find((e) => {
      const m = e.getModel();
      const node = e.getContainerDomNode && e.getContainerDomNode();
      return m && m.getLanguageId() !== "plaintext" && node && node.offsetParent !== null;
    });
    if (ed) model = ed.getModel();
  }
  if (!model) model = models.slice().sort((a, b) => b.getValueLength() - a.getValueLength())[0];
  const examples = [];
  const desc = document.querySelector('[data-track-load="description_content"]');
  if (desc) {
    const text = desc.innerText;
    const re = /Input:\s*([\s\S]*?)\s*Output:/g;
    let m;
    while ((m = re.exec(text)) && examples.length < 5) examples.push(m[1]);
  }
  const titleEl = document.querySelector('a[href^="/problems/"][class*="truncate"], div.text-title-large a, .text-title-large');
  return {
    ok: true,
    code: model.getValue(),                 // whole model, including lines scrolled out of view
    language: model.getLanguageId(),
    title: (titleEl && titleEl.textContent.trim()) || document.title.replace(/\s*-\s*LeetCode.*$/, ""),
    examples,
  };
}

async function importLeetCode(tabId) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readLeetCodeEditor });
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
  // The page is not trusted: check the shape and bound everything.
  const r = results && results[0] && results[0].result;
  if (!r || typeof r !== "object") return { ok: false, error: "Couldn't read the LeetCode editor. Use Import selection or paste your code instead." };
  if (!r.ok) {
    const why = {
      "not-leetcode": "That page isn't a LeetCode problem. Use Import selection or paste your code instead.",
      "no-editor": "Couldn't find LeetCode's code editor on that page (it may still be loading). Try again, use Import selection, or paste your code.",
    }[r.reason] || "Couldn't read the LeetCode editor.";
    return { ok: false, error: why };
  }
  if (typeof r.code !== "string" || typeof r.language !== "string") return { ok: false, error: "The LeetCode page returned unexpected data." };
  if (utf8Length(r.code) > MAX_CODE_BYTES) return { ok: false, error: "The editor contains more than 256 KiB of code." };
  if (!r.code.trim()) return { ok: false, error: "The LeetCode editor is empty." };
  return {
    ok: true,
    code: r.code.replace(/\r\n?/g, "\n"),
    language: r.language.slice(0, 40),
    title: typeof r.title === "string" ? r.title.slice(0, 200) : "",
    examples: Array.isArray(r.examples)
      ? r.examples.filter((e) => typeof e === "string").slice(0, MAX_EXAMPLES).map((e) => e.slice(0, MAX_EXAMPLE_CHARS))
      : [],
  };
}
