// Writes VisualLeet's problem database: one file per problem.
//
//   node scripts/collect-problems.mjs   (facts from leetcode.com -> problems/collected/)
//   node scripts/build-db.mjs           (-> src/problems/<slug>.json + index.json)
//   node scripts/verify-db.mjs          (checks every file, stamps "verified")
//
// Each file holds the input boxes, the hidden setup and the call, ready to
// run: the extension only fills in the test-case values. Hand-written
// entries (problems/handwritten.json) win over written-from-metadata ones.
// Files hold only our own setup code and LeetCode's signatures; examples,
// statements and solutions stay in problems/ (not shipped).
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { entryFromMeta } from "./lib/entry-writer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const P = (...p) => path.join(root, "problems", ...p);
const OUT = path.join(root, "src", "problems");
const readJson = (f) => JSON.parse(readFileSync(f, "utf8"));

const list = readJson(P("neetcode150.json"));
const handwritten = readJson(P("handwritten.json")).problems;
const overrides = readJson(P("overrides.json"));
mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(OUT)) if (f.endsWith(".json")) unlinkSync(path.join(OUT, f));

const index = {}, skipped = [];
for (const { category, slugs } of list.problems) {
  for (const slug of slugs) {
    const c = existsSync(P("collected", slug + ".json")) ? readJson(P("collected", slug + ".json")) : null;
    const hwAll = handwritten[slug] || {};
    const head = {
      slug, frontendId: c ? c.frontendId : hwAll.frontendId || "", title: c ? c.title : hwAll.title || "", category,
      premium: c ? !!c.premium : !!hwAll.premium,
      anyOrder: (c ? !!c.anyOrder : false) || overrides.anyOrder.includes(slug),
      multipleAnswers: overrides.multipleAnswers.includes(slug),
    };
    let body;
    if (handwritten[slug]) {
      const { tests, title, frontendId, premium, ...hw } = handwritten[slug];
      body = { ...hw, source: "hand-written" };
    } else if (c) {
      const e = entryFromMeta(c.meta);
      if (e.error) { skipped.push(`${slug}: ${e.error}`); continue; }
      body = { ...e, source: "written from LeetCode's signature" };
    } else {
      skipped.push(`${slug}: no data (premium or not collected)`);
      continue;
    }
    const entry = { ...head, ...body, verified: false };
    writeFileSync(path.join(OUT, slug + ".json"), JSON.stringify(entry, null, 1) + "\n");
    index[slug] = { title: entry.title, frontendId: entry.frontendId, category, verified: false };
  }
}
writeFileSync(path.join(OUT, "index.json"), JSON.stringify({ about: "VisualLeet problem database: one file per problem (src/problems/<slug>.json).", problems: index }, null, 1) + "\n");
console.log(`wrote ${Object.keys(index).length} problem files; skipped ${skipped.length}:\n  ${skipped.join("\n  ")}`);
