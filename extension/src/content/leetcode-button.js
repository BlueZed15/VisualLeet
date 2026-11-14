// Content script on LeetCode problem pages: adds a "Visualize" button to
// LeetCode's top bar, next to Run / Submit. Clicking it does what the
// toolbar icon does: the background reads the code and the selected test
// case and shows them in the VisualLeet tab. Reads nothing itself.
//
// The bar is React-rendered and re-rendered on navigation, so the button is
// re-added whenever it goes missing. If LeetCode's bar changes and there is
// no #ide-top-btns, there's simply no button (the icon and Alt+V still work).
(() => {
  const ID = "visualleet-top-button";

  function make() {
    const b = document.createElement("button");
    b.id = ID;
    b.type = "button";
    b.title = "Visualize the selected test case in LeetScope (Alt+V)";
    b.setAttribute("aria-label", "Visualize in LeetScope");
    const mark = document.createElement("span");
    mark.textContent = "</>";
    const text = document.createElement("span");
    text.textContent = "Visualize";
    b.append(mark, text);
    Object.assign(b.style, {
      display: "inline-flex", alignItems: "center", gap: "6px", height: "32px", padding: "0 12px",
      borderRadius: "8px", border: "0", cursor: "pointer", whiteSpace: "nowrap",
      font: "500 14px/21px -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
      color: "#ffa116", background: "rgba(255, 161, 22, 0.14)", transition: "background .12s",
    });
    Object.assign(mark.style, { font: "800 11px/1 ui-monospace, 'Cascadia Mono', Consolas, monospace", letterSpacing: "-.5px" });
    b.addEventListener("mouseenter", () => { b.style.background = "rgba(255, 161, 22, 0.24)"; });
    b.addEventListener("mouseleave", () => { b.style.background = "rgba(255, 161, 22, 0.14)"; });
    b.addEventListener("click", async () => {
      text.textContent = "Opening…";
      b.disabled = true;
      try {
        const r = await chrome.runtime.sendMessage({ type: "visualize-page" });
        if (r && r.ok === false && r.error) b.title = r.error;
      } catch (e) {
        // the extension was reloaded: this page's script is orphaned
        b.title = "LeetScope was updated: reload this page to use this button.";
      } finally {
        setTimeout(() => { text.textContent = "Visualize"; b.disabled = false; }, 600);
      }
    });
    return b;
  }

  function ensure() {
    if (!/^\/problems\/[^/]+/.test(location.pathname)) return;
    const bar = document.getElementById("ide-top-btns");
    if (!bar || document.getElementById(ID)) return;
    bar.appendChild(make());
  }

  // A message from LeetScope about this click (e.g. the editor isn't Python,
  // the test case couldn't be found), shown under the button.
  const TOAST = "leetscope-toast";
  function showToast(text, action) {
    document.getElementById(TOAST)?.remove();
    const btn = document.getElementById(ID);
    const r = btn ? btn.getBoundingClientRect() : { left: window.innerWidth - 380, bottom: 48 };
    const box = document.createElement("div");
    box.id = TOAST;
    box.setAttribute("role", "alert");
    Object.assign(box.style, {
      position: "fixed", zIndex: "2147483647", top: Math.round(r.bottom + 8) + "px",
      left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 380))) + "px", width: "360px", boxSizing: "border-box",
      padding: "10px 12px", borderRadius: "8px", background: "#2b2b2b", color: "#eff1f6", border: "1px solid rgba(255,161,22,.45)",
      boxShadow: "0 8px 28px rgba(0,0,0,.45)", font: "13px/1.5 -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
    });
    const head = document.createElement("div");
    Object.assign(head.style, { display: "flex", alignItems: "center", gap: "8px", fontWeight: "600", color: "#ffa116", marginBottom: "4px" });
    head.append("LeetScope");
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "×";
    close.setAttribute("aria-label", "Close");
    Object.assign(close.style, { marginLeft: "auto", border: "0", background: "transparent", color: "#8a8f98", fontSize: "16px", cursor: "pointer" });
    close.addEventListener("click", () => box.remove());
    head.append(close);
    const body = document.createElement("div");
    body.textContent = text;
    Object.assign(body.style, { overflowWrap: "anywhere" });
    box.append(head, body);
    if (action) {
      const a = document.createElement("button");
      a.type = "button";
      a.textContent = action.label;
      Object.assign(a.style, { marginTop: "8px", padding: "4px 10px", borderRadius: "6px", border: "0", cursor: "pointer",
        background: "rgba(255,161,22,.18)", color: "#ffa116", font: "600 12px/1.5 inherit" });
      a.addEventListener("click", () => { box.remove(); chrome.runtime.sendMessage({ type: "visualize-page", useExample: !!action.useExample }).catch(() => {}); });
      box.append(a);
    }
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 20000);
  }
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== TOAST || typeof msg.text !== "string") return;
    showToast(msg.text.slice(0, 800), msg.action && typeof msg.action.label === "string" ? { label: msg.action.label.slice(0, 40), useExample: msg.action.useExample === true } : null);
  });

  ensure();
  new MutationObserver(ensure).observe(document.documentElement, { childList: true, subtree: true });
})();
