// Screenshots of the design dashboard (needs the bench server on :8765).
//   node extension/design/_shared/shoot.mjs [state ...]
import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";
const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "screenshots");
const states = process.argv.slice(2).length ? process.argv.slice(2) : ["complete"];
const browser = await puppeteer.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 } });
const page = await browser.newPage();
for (const s of states) {
  await page.goto(`http://127.0.0.1:8765/design/index.html?state=${s}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 1500));
  const ws = await page.$(".ws");
  await ws.screenshot({ path: path.join(out, `workspace-${s}.png`) });
  if (s === "complete") await page.screenshot({ path: path.join(out, "dashboard-full.png"), fullPage: true });
}
await browser.close();
console.log("saved to", out);
