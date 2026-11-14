// MV3 service worker (module). Never runs Python. Responsibilities:
//  - toolbar click / Alt+V / the "Visualize" button VisualLeet adds to
//    LeetCode's top bar, on a LeetCode problem: read the code, the problem
//    and the selected test case from that page, hand them to the VisualLeet
//    tab (the open one is reused and updated in place), and focus it;
//  - on any other page: remember it as the source for "Import selection";
//  - imports requested by the VisualLeet page (selection, or re-reading the
//    LeetCode tab), validated and bounded.

import { readLeetCodePage } from "./leetcode-reader.js";

const UI_PATH = "ui/index.html";
const MAX_CODE_BYTES = 256 * 1024;
const MAX_TEXT = 100 * 1024;
const MAX_EXAMPLES = 20;
const PROBLEM_URL = /^https:\/\/leetcode\.(com|cn)\/problems\/[a-z0-9-]+/;

chrome.action.onClicked.addListener((tab) => showFrom(tab));

// The top-bar button (content script on LeetCode): same as clicking the icon on that tab.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (sender.id !== chrome.runtime.id || !sender.tab || !msg || msg.type !== "visualize-page") return;
  if (!PROBLEM_URL.test(sender.tab.url || "")) { sendResponse({ ok: false, error: "Not a LeetCode problem page." }); return; }
  showFrom(sender.tab).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});

async function showFrom(tab) {
  const uiUrl = chrome.runtime.getURL(UI_PATH);
  const onUi = (tab.url || "").startsWith(uiUrl);
  const sourceTabId = tab && typeof tab.id === "number" && !onUi ? tab.id : null;

  // On a LeetCode problem: read it now, while this click's access is fresh.
  let pending = null;
  if (sourceTabId !== null && PROBLEM_URL.test(tab.url || "")) {
    const r = await readLeetCode(sourceTabId);
    pending = { id: crypto.randomUUID(), at: Date.now(), tabId: sourceTabId, url: tab.url, result: r };
    await chrome.storage.session.set({ pending }).catch(() => {});
  }

  // Reuse the open LeetScope tab (its runtime stays warm). documentUrls in
  // getContexts matches exact URLs only, and ours carries ?sourceTab=…, so filter here.
  const contexts = await chrome.runtime.getContexts({ contextTypes: ["TAB"] }).catch(() => []);
  const existing = contexts.find((c) => typeof c.tabId === "number" && c.tabId >= 0 && (c.documentUrl || "").startsWith(uiUrl));
  if (existing) {
    await chrome.tabs.update(existing.tabId, { active: true });
    if (typeof existing.windowId === "number") await chrome.windows.update(existing.windowId, { focused: true }).catch(() => {});
    if (sourceTabId !== null) {
      chrome.runtime.sendMessage({ type: "source-tab", tabId: sourceTabId, title: tab.title || "", url: tab.url || "", pendingId: pending && pending.id }).catch(() => {});
    }
    return;
  }
  const url = new URL(uiUrl);
  if (sourceTabId !== null) url.searchParams.set("sourceTab", String(sourceTabId));
  await chrome.tabs.create({ url: url.toString(), index: typeof tab?.index === "number" ? tab.index + 1 : undefined });
}

// Only the VisualLeet page may ask for imports.
function fromOurUi(sender) {
  return sender.id === chrome.runtime.id && typeof sender.url === "string" &&
         sender.url.startsWith(chrome.runtime.getURL(UI_PATH));
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (!fromOurUi(sender) || !msg || typeof msg !== "object" || msg.type === "visualize-page") return;
  if (msg.type === "import" && typeof msg.tabId === "number" && (msg.mode === "selection" || msg.mode === "leetcode")) {
    (msg.mode === "selection" ? importSelection(msg.tabId) : readLeetCode(msg.tabId)).then(sendResponse);
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
    return "LeetScope can't read that page right now. Pages like chrome:// are protected, and access ends when the page reloads or navigates: " +
           "click the LeetScope icon (or press Alt+V) on that page again, or paste your code instead.";
  }
  if (/No tab with id/i.test(text)) return "That page was closed. Open it again and click the LeetScope icon.";
  return "Reading the page failed: " + text;
}

const utf8Length = (s) => new TextEncoder().encode(s).length;
const str = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");

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
  const texts = results.map((r) => (typeof r.result === "string" ? r.result : "")).filter((t) => t.trim());
  const text = (texts[0] || "").replace(/\r\n?/g, "\n").replace(/\xa0/g, " ");
  if (!text.trim()) {
    return { ok: false, error: "Nothing is selected on that page. Select your code there first (or paste it here). Your current code was kept." };
  }
  if (utf8Length(text) > MAX_CODE_BYTES) return { ok: false, error: "The selection is larger than 256 KiB." };
  return { ok: true, text };
}

// ---- LeetCode page ----

async function readLeetCode(tabId) {
  let results;
  try {
    results = await chrome.scripting.executeScript({ target: { tabId }, world: "MAIN", func: readLeetCodePage });
  } catch (err) {
    return { ok: false, error: friendlyError(err) };
  }
  // The page is not trusted: check the shape and bound everything.
  const r = results && results[0] && results[0].result;
  if (!r || typeof r !== "object") return { ok: false, error: "Couldn't read the LeetCode page." };
  if (!r.ok) {
    return { ok: false, reason: r.reason, error: {
      "not-leetcode": "That page isn't LeetCode.",
      "not-problem": "That LeetCode page isn't a problem. Open a problem and click Visualize or the LeetScope icon there.",
    }[r.reason] || "Couldn't read the LeetCode page." };
  }
  const out = {
    ok: true,
    slug: /^[a-z0-9-]{1,120}$/.test(r.slug) ? r.slug : "",
    title: str(r.title, 200),
    frontendId: str(r.frontendId, 10),
    metaData: str(r.metaData, 64 * 1024),
    exampleInputs: Array.isArray(r.exampleInputs) ? r.exampleInputs.filter((x) => typeof x === "string").slice(0, MAX_EXAMPLES).map((x) => x.slice(0, MAX_TEXT)) : [],
    exampleOutputs: Array.isArray(r.exampleOutputs) ? r.exampleOutputs.filter((x) => typeof x === "string").slice(0, MAX_EXAMPLES).map((x) => x.slice(0, MAX_TEXT)) : [],
    anyOrder: r.anyOrder === true,
    paidOnly: r.paidOnly === true,
    language: str(r.language, 40),
    selectedIndex: Number.isInteger(r.selectedIndex) ? r.selectedIndex : -1,
    selectedCase: Array.isArray(r.selectedCase)
      ? r.selectedCase.filter((f) => f && typeof f.name === "string" && typeof f.text === "string").slice(0, 30)
          .map((f) => ({ name: f.name.slice(0, 60), text: f.text.slice(0, MAX_TEXT) }))
      : [],
    rawCases: str(r.rawCases, 1024 * 1024),
  };
  if (!out.slug) return { ok: false, error: "That page's problem name looks wrong." };
  if (typeof r.code === "string") {
    if (utf8Length(r.code) > MAX_CODE_BYTES) return { ok: false, error: "The editor contains more than 256 KiB of code." };
    out.code = r.code.replace(/\r\n?/g, "\n");
  }
  return out;
}
