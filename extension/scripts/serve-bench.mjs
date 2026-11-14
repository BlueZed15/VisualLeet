// Minimal static server for the renderer benchmark page (localhost only).
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 8765);
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".map": "application/json", ".png": "image/png" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const file = path.resolve(root, "." + decodeURIComponent(url.pathname === "/" ? "/bench/index.html" : url.pathname));
  if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
  try {
    const body = await readFile(file);
    res.writeHead(200, { "content-type": types[path.extname(file)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
}).listen(port, "127.0.0.1", () => console.log(`bench server on http://127.0.0.1:${port}/`));
