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

  ensure();
  new MutationObserver(ensure).observe(document.documentElement, { childList: true, subtree: true });
})();
