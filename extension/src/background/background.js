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
  if (!PROBLEM_URL.test(sender.tab.url || "")) { sendResponse({ ok: false, error: "Open a LeetCode problem to use Visualize." }); return; }
  showFrom(sender.tab).then(() => sendResponse({ ok: true }), (e) => sendResponse({ ok: false, error: String(e && e.message || e) }));
  return true;
});

// LeetScope's problem index (which problems the database has, and their inputs)
let dbIndex = null;
async function problemEntry(slug) {
  try {
    if (!dbIndex) dbIndex = await (await fetch(chrome.runtime.getURL("problems/index.json"))).json();
    if (!dbIndex.problems[slug]) return null;
    return await (await fetch(chrome.runtime.getURL(`problems/${slug}.json`))).json();
  } catch { return null; }
}

/** Problems that stop a click on LeetCode, checked before leaving the page.
 *  Returns { text, action? } for a message on the LeetCode page, or null. */
async function clickProblem(r) {
  if (!r.ok) return { text: r.error || "LeetScope couldn't read this page. Reload it and click Visualize again." };
  if (!/^python3?$/.test(r.language || "")) {
    return { text: r.language ? `LeetCode’s editor is set to ${r.language}. LeetScope runs Python 3. Switch the editor to Python3 and click Visualize again.`
                              : "LeetScope couldn't read the code editor. The page may still be loading. Wait a moment and click Visualize again." };
  }
  if (!r.code) return { text: "LeetScope couldn't read the code editor. The page may still be loading. Wait a moment and click Visualize again." };
  const entry = await problemEntry(r.slug);
  if (!entry) return { text: `"${r.title || r.slug}" isn't supported by LeetScope yet. Support for more problems is on the way.` };
  // the selected test case: its boxes, or its lines in the raw list of cases
  const n = entry.boxes.length;
  const lines = (r.rawCases || "").split("\n").filter((l) => l.trim()).length;
  const found = r.selectedCase.length === n || (r.selectedIndex >= 0 && (r.selectedIndex + 1) * n <= lines);
  if (found) return null;
  const f = r.testcaseFound || {};
  return {
    // nothing of the Testcase panel in the page: LeetCode only renders it while its tab is
    // open (before a first Run, the Test Result tab replaces it entirely)
    text: !f.tabs && !f.boxes && !f.rawLines
      ? "LeetScope reads your test case from LeetCode's Testcase tab, and that tab isn't open. Open the Testcase tab below the editor, select a case, and click Visualize again."
      : "LeetScope couldn't match the selected test case to this problem's inputs. Select the case again in LeetCode's Testcase tab and click Visualize.",
    // what the page reader saw, for debugging (shown in the service worker's console, not in the card)
    detail: `found ${f.tabs || 0} case tabs, ${f.boxes || 0} input boxes for ${n} input${n === 1 ? "" : "s"}, ${f.rawLines || 0} raw lines` +
      `${f.markers && f.markers.length ? "; page markers: " + f.markers.join(", ") : ""}`,
  };
}

// Show a message next to the Visualize button on the LeetCode page (content script).
async function tellPage(tabId, problem) {
  if (problem.detail) console.info("LeetScope:", problem.text, "|", problem.detail);
  const { detail, ...shown } = problem;
  try { await chrome.tabs.sendMessage(tabId, Object.assign({ type: "leetscope-toast" }, shown)); return true; } catch { return false; }
}

async function showFrom(tab) {
  const uiUrl = chrome.runtime.getURL(UI_PATH);
  const onUi = (tab.url || "").startsWith(uiUrl);
  const sourceTabId = tab && typeof tab.id === "number" && !onUi ? tab.id : null;

  // On a LeetCode problem: read it now, while this click's access is fresh.
  let pending = null;
  if (sourceTabId !== null && PROBLEM_URL.test(tab.url || "")) {
    const r = await readLeetCode(sourceTabId);
    // a problem that stops this click: say so on the LeetCode page and stay there
    // (if the page can't show it, e.g. it was open before LeetScope was updated, LeetScope explains instead)
    const problem = await clickProblem(r);
    if (problem && await tellPage(sourceTabId, problem)) return;
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
    return "LeetScope can't read this page. Chrome protects some pages, such as chrome:// pages, and access ends when a page reloads. " +
           "Click the LeetScope icon on the page again.";
  }
  if (/No tab with id/i.test(text)) return "That page was closed. Open it again and click the LeetScope icon.";
  console.warn("LeetScope: reading the page failed", text);
  return "LeetScope couldn't read this page. Reload it and try again.";
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
    return { ok: false, error: "Nothing is selected on that page. Select the code there and try again. Your current code is unchanged." };
  }
  if (utf8Length(text) > MAX_CODE_BYTES) return { ok: false, error: "The selection is larger than 256 KiB, which is more than LeetScope can show." };
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
  if (!r || typeof r !== "object") return { ok: false, error: "LeetScope couldn't read this LeetCode page. Reload it and try again." };
  if (!r.ok) {
    return { ok: false, reason: r.reason, error: {
      "not-leetcode": "This page isn't on LeetCode. Open a LeetCode problem and click the LeetScope icon there.",
      "not-problem": "This LeetCode page isn't a problem. Open a problem and click Visualize.",
    }[r.reason] || "LeetScope couldn't read this LeetCode page. Reload it and try again." };
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
    testcaseFound: r.testcaseFound && typeof r.testcaseFound === "object"
      ? { tabs: Number(r.testcaseFound.tabs) || 0, boxes: Number(r.testcaseFound.boxes) || 0, rawLines: Number(r.testcaseFound.rawLines) || 0,
          markers: Array.isArray(r.testcaseFound.markers) ? r.testcaseFound.markers.filter((x) => typeof x === "string").slice(0, 12).map((x) => x.slice(0, 60)) : [] } : null,
  };
  if (!out.slug) return { ok: false, error: "LeetScope couldn't tell which problem this page is. Reload it and try again." };
  if (typeof r.code === "string") {
    if (utf8Length(r.code) > MAX_CODE_BYTES) return { ok: false, error: "The code in the editor is larger than 256 KiB, which is more than LeetScope can show." };
    out.code = r.code.replace(/\r\n?/g, "\n");
  }
  return out;
}
