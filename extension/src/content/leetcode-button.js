// Content script on LeetCode problem pages: adds a "Visualize" button to
// LeetCode's top bar, next to Run / Submit. Clicking it does what the
// toolbar icon does: the background reads the code and the selected test
// case and shows them in the LeetScope tab. Reads nothing itself, except
// noticing when LeetCode finishes one of its own Runs (to glow once).
//
// The bar is React-rendered and re-rendered on navigation, so the button is
// re-added whenever it goes missing. If LeetCode's bar changes and there is
// no #ide-top-btns, there's simply no button (the icon and Alt+V still work).
// Styles: leetcode-button.css (design/handover: leetcode-button.css and
// reference/leetcode-button-states).
(() => {
  const ID = "visualleet-top-button";
  const SVG = "http://www.w3.org/2000/svg";

  // the LeetScope mark: lens and handle in the label colour, three coloured dots
  function mark(cls) {
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("class", cls);
    svg.setAttribute("viewBox", "2 2 56 56");
    svg.setAttribute("aria-hidden", "true");
    const add = (tag, attrs) => { const n = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); svg.append(n); };
    add("circle", { cx: 28, cy: 28, r: 19, fill: "none", stroke: "currentColor", "stroke-width": 7 });
    add("path", { d: "M42 42L51 51", stroke: "currentColor", "stroke-width": 7.5, "stroke-linecap": "round" });
    // the X1 refined mark: three colour cells in the lens (they swell left to right in the glow)
    add("rect", { class: "ls-vz-d1", x: 15.4, y: 22.17, width: 7.61, height: 11.66, rx: 2.68, fill: "#2F6BFF" });
    add("rect", { class: "ls-vz-d2", x: 24.19, y: 22.17, width: 7.61, height: 11.66, rx: 2.68, fill: "#FFB020" });
    add("rect", { class: "ls-vz-d3", x: 32.99, y: 22.17, width: 7.61, height: 11.66, rx: 2.68, fill: "#FF5B4A" });
    return svg;
  }

  function make() {
    const wrap = document.createElement("span");
    wrap.className = "ls-vz-wrap";
    const b = document.createElement("button");
    b.id = ID;
    b.type = "button";
    b.className = "ls-vz";
    b.title = "Visualize the selected test case in LeetScope (Alt+V)";
    b.setAttribute("aria-label", "Visualize in LeetScope");
    const text = document.createElement("span");
    text.textContent = "Visualize";
    b.append(mark("ls-vz-mark"), text);
    // while the LeetScope tab is being prepared: three hopping dots for at least 600 ms
    const hops = () => Array.from({ length: 3 }, () => Object.assign(document.createElement("span"), { className: "ls-vz-hop" }));
    b.addEventListener("click", async () => {
      const started = Date.now();
      // keep the button's width while the dots show (design: opening state)
      b.style.minWidth = Math.ceil(b.getBoundingClientRect().width) + "px";
      b.style.justifyContent = "center";
      b.classList.add("ls-vz-opening");
      text.replaceChildren(...hops());
      text.style.display = "inline-flex";
      text.style.gap = "4px";
      text.style.height = "16px";
      text.style.alignItems = "center";
      b.disabled = true;
      try {
        const r = await chrome.runtime.sendMessage({ type: "visualize-page" });
        if (r && r.ok === false && r.error) b.title = r.error;
      } catch (e) {
        // the extension was reloaded: this page's script is orphaned
        b.title = "LeetScope was updated. Reload this page to use this button.";
      } finally {
        setTimeout(() => { text.removeAttribute("style"); text.textContent = "Visualize"; b.style.minWidth = b.style.justifyContent = ""; b.classList.remove("ls-vz-opening"); b.disabled = false; }, Math.max(0, 600 - (Date.now() - started)));
      }
    });
    wrap.append(b);
    wrap.addEventListener("animationend", (e) => { if (e.target === wrap && e.pseudoElement === "::before") wrap.classList.remove("ls-vz-glow"); });
    return wrap;
  }

  // LeetCode's theme, read from the top bar's actual colour (no guessing at its class
  // names): light bar -> the light button (#E8E8E8 like LeetCode's), else the dark one
  function barTheme(bar) {
    for (let el = bar; el; el = el.parentElement) {
      const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(getComputedStyle(el).backgroundColor || "");
      if (m && (m[4] === undefined || +m[4] > 0.5)) return (0.2126 * m[1] + 0.7152 * m[2] + 0.0722 * m[3]) / 255 > 0.5 ? "light" : "dark";
    }
    return document.documentElement.classList.contains("dark") ? "dark" : "light";
  }
  function applyTheme() {
    const b = document.getElementById(ID), bar = document.getElementById("ide-top-btns");
    if (b && bar && b.parentElement) b.parentElement.dataset.lsTheme = barTheme(bar);
  }

  function ensure() {
    if (!/^\/problems\/[^/]+/.test(location.pathname)) return;
    const bar = document.getElementById("ide-top-btns");
    if (!bar || document.getElementById(ID)) return;
    bar.appendChild(make());
    applyTheme();
  }
  // LeetCode's theme switch changes classes/styles on <html>: follow it
  new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style", "data-theme"] });

  // ---------- glow once when LeetCode finishes one of its own Runs ----------
  // Armed by a press of LeetCode's Run (button or Ctrl/Cmd+'), fired when the
  // run's result appears or changes in the Test Result panel. Not on page load,
  // not on Submit, at most once per run.
  // NOTE: these selectors are LeetCode's data-e2e-locator markers as best known;
  // verify them on the live site.
  const RUN_BUTTON = '[data-e2e-locator="console-run-button"]';
  const SUBMIT_BUTTON = '[data-e2e-locator="console-submit-button"]';
  const RESULT = '[data-e2e-locator="console-result"]';
  const VERDICT = /\b(Accepted|Wrong Answer|Runtime Error|Compile Error|Time Limit Exceeded|Memory Limit Exceeded|Output Limit Exceeded)\b/;
  let armed = 0;            // time of the Run press, 0 = not armed
  let lastResult = "";

  function glow() {
    const wrap = document.getElementById(ID)?.parentElement;
    if (!wrap || !wrap.classList.contains("ls-vz-wrap")) return;
    wrap.classList.remove("ls-vz-glow");
    void wrap.offsetWidth;    // restart the animation
    wrap.classList.add("ls-vz-glow");
  }
  const resultText = () => (document.querySelector(RESULT)?.textContent || "").trim();
  function arm() { armed = Date.now(); lastResult = resultText(); }

  document.addEventListener("click", (e) => {
    const t = e.target instanceof Element ? e.target : null;
    if (!t) return;
    if (t.closest(SUBMIT_BUTTON)) { armed = 0; return; }
    if (t.closest(RUN_BUTTON)) arm();
  }, true);
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === "'") arm();          // LeetCode's Run shortcut
    if ((e.ctrlKey || e.metaKey) && e.key === "Enter") armed = 0;   // Submit
  }, true);

  function checkResult() {
    if (!armed) return;
    if (Date.now() - armed > 120000) { armed = 0; return; }       // gave up on that run
    const now = resultText();
    if (now && now !== lastResult && VERDICT.test(now)) { armed = 0; lastResult = now; glow(); }
  }

  // A message from LeetScope about this click (e.g. the editor isn't Python,
  // the test case couldn't be found), shown under the button.
  const TOAST = "leetscope-toast";
  function showToast(text) {
    document.getElementById(TOAST)?.remove();
    const btn = document.getElementById(ID);
    const r = btn ? btn.getBoundingClientRect() : { left: window.innerWidth - 380, bottom: 48 };
    const box = document.createElement("div");
    box.id = TOAST;
    box.setAttribute("role", "alert");
    box.style.top = Math.round(r.bottom + 8) + "px";
    box.style.left = Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 368))) + "px";
    const head = document.createElement("div");
    head.className = "ls-t-head";
    const name = document.createElement("span");
    name.textContent = "LeetScope";
    const close = document.createElement("button");
    close.type = "button";
    close.className = "ls-t-close";
    const xs = document.createElementNS(SVG, "svg");
    xs.setAttribute("viewBox", "0 0 24 24"); xs.setAttribute("aria-hidden", "true");
    xs.setAttribute("fill", "none"); xs.setAttribute("stroke", "currentColor"); xs.setAttribute("stroke-width", "2.4"); xs.setAttribute("stroke-linecap", "round");
    const xp = document.createElementNS(SVG, "path"); xp.setAttribute("d", "M6 6l12 12M18 6L6 18"); xs.append(xp);
    close.append(xs);
    close.setAttribute("aria-label", "Close");
    close.addEventListener("click", () => box.remove());
    head.append(mark("ls-t-mark"), name, close);
    const body = document.createElement("div");
    body.className = "ls-t-body";
    body.textContent = text;
    box.append(head, body);
    document.body.appendChild(box);
    setTimeout(() => box.remove(), 20000);
  }
  chrome.runtime.onMessage.addListener((msg, sender) => {
    if (sender.id !== chrome.runtime.id || !msg || msg.type !== TOAST || typeof msg.text !== "string") return;
    showToast(msg.text.slice(0, 800));
  });

  ensure();
  new MutationObserver(() => { ensure(); checkResult(); }).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
})();
