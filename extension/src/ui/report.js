// "Report a problem" (the flag in the top bar). A short panel that opens
// LeetScope's Google Form in a new tab, prefilled with what the user wrote and
// a few details shown to them first. The extension sends nothing itself: the
// user reads the form and presses Submit on Google's page.

const FORM = "https://docs.google.com/forms/d/e/1FAIpQLSdtbU9IahLMAup3RVoc6NzHPYvPB7CaxsC4dl-9_vfSBK_X7A/viewform";
const FIELD_WHAT = "entry.326955045";      // "What went wrong?"
const FIELD_IMPROVE = "entry.1447967852";  // "What can we do more to improve?"
// the answers travel in the link, so keep it short enough to arrive whole
const MAX_CODE = 3000;

/** The prefilled form link for a report. */
export function formUrl({ message, improve = "", details = "", code = "" }) {
  let what = String(message || "").trim();
  if (details) what += "\n\n--- Details ---\n" + details;
  if (code) {
    const cut = code.length > MAX_CODE;
    what += "\n\n--- Code" + (cut ? ` (first ${MAX_CODE} characters)` : "") + " ---\n" + (cut ? code.slice(0, MAX_CODE) : code);
  }
  const q = new URLSearchParams({ usp: "pp_url", [FIELD_WHAT]: what });
  if (String(improve).trim()) q.set(FIELD_IMPROVE, String(improve).trim());
  return FORM + "?" + q.toString();
}

/** Wire the panel. `getDetails()` -> { text, code } for the current state. */
export function initReport({ getDetails }) {
  const $ = (id) => document.getElementById(id);
  const dlg = $("report"), msg = $("report-msg"), improve = $("report-improve"), details = $("report-details");
  const withCode = $("report-code"), codeNote = $("report-code-note");
  let current = { text: "", code: "" };

  $("report-open").addEventListener("click", () => {
    current = getDetails();
    details.textContent = current.text;
    withCode.disabled = !current.code;
    withCode.checked = false;
    codeNote.textContent = !current.code ? "(no code yet)"
      : current.code.length > MAX_CODE ? `(the first ${MAX_CODE.toLocaleString()} characters)` : "";
    dlg.showModal();
    msg.focus();
  });
  const close = () => dlg.close();
  $("report-close").addEventListener("click", close);
  $("report-cancel").addEventListener("click", close);
  dlg.addEventListener("click", (e) => { if (e.target === dlg) close(); });   // a click outside the panel

  $("report-form").addEventListener("submit", (e) => {
    e.preventDefault();
    if (!msg.value.trim()) { msg.focus(); return; }
    window.open(formUrl({ message: msg.value, improve: improve.value, details: current.text,
                          code: withCode.checked ? current.code : "" }), "_blank", "noopener");
    msg.value = improve.value = "";
    close();
  });
}
