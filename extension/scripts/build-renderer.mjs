// Bundles the renderer with esbuild. No type checking: the legacy TypeScript
// predates current typings.
//   node scripts/build-renderer.mjs              -> dist/visualizer (VisualLeet fork)
//   node scripts/build-renderer.mjs --baseline   -> dist/baseline   (unmodified archive renderer, for benches)
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseline = process.argv.includes("--baseline");

await build({
  absWorkingDir: root,
  entryPoints: { renderer: baseline ? "bench/baseline-entry.ts" : "src/visualizer/index.ts" },
  bundle: true,
  format: "iife",
  target: "chrome120",
  outdir: path.join(root, "dist", baseline ? "baseline" : "visualizer"),
  minify: process.env.MINIFY === "1",
  sourcemap: true,
  logLevel: "info",
  resolveExtensions: [".ts", ".js", ".css"],
  loader: { ".png": "dataurl", ".jpg": "dataurl", ".gif": "dataurl" },
  legalComments: "linked",
});
