// Collects the facts VisualLeet's database needs for each NeetCode 150
// problem from leetcode.com: signature metadata, example inputs, expected
// outputs (from the statement) and whether "any order" is accepted.
//
//   node scripts/collect-problems.mjs [--only slug,slug] [--delay 1500]
//     -> problems/collected/<slug>.json   (dev data, not shipped)
//
// Polite: one request at a time, a delay between them, no cookies or user
// data sent. Premium problems may come back without data; they are reported.
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const delay = Number(arg("--delay", "1500"));
const only = arg("--only", "") ? arg("--only", "").split(",") : null;
const skipExisting = process.argv.includes("--skip-existing");

const list = JSON.parse(readFileSync(path.join(root, "problems", "neetcode150.json"), "utf8"));
// --list problems/batch-<name>.json: collect that batch instead of the NeetCode 150
const listFile = arg("--list", "");
const slugs = only || (listFile ? JSON.parse(readFileSync(path.resolve(root, listFile), "utf8")).slugs : list.problems.flatMap((c) => c.slugs));
const outDir = path.join(root, "problems", "collected");
await mkdir(outDir, { recursive: true });

const QUERY = `query q($titleSlug: String!) { question(titleSlug: $titleSlug) {
  questionFrontendId title titleSlug isPaidOnly metaData exampleTestcaseList content } }`;

const decode = (s) => s.replace(/&nbsp;/g, " ").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<")
  .replace(/&gt;/g, ">").replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, "&");
const text = (html) => decode(String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|pre|div|li)>/gi, "\n").replace(/<[^>]+>/g, ""));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { ok: [], empty: [], failed: [] };

for (const [i, slug] of slugs.entries()) {
  const file = path.join(outDir, slug + ".json");
  if (skipExisting && existsSync(file)) continue;
  if (i) await sleep(delay);
  try {
    const res = await fetch("https://leetcode.com/graphql/", {
      method: "POST",
      headers: { "content-type": "application/json", referer: `https://leetcode.com/problems/${slug}/` },
      body: JSON.stringify({ query: QUERY, variables: { titleSlug: slug } }),
    });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const q = (await res.json())?.data?.question;
    if (!q || !q.metaData || !q.exampleTestcaseList) { report.empty.push(slug + (q && q.isPaidOnly ? " (premium)" : "")); continue; }
    const body = text(q.content);
    // an output may span lines ("[\n[1,1,6],\n[1,2,5]\n]"): read up to the next section or blank line
    const outputs = [...body.matchAll(/Output:?\s*([\s\S]*?)(?=\n\s*(?:Explanation|Example\s*\d|Constraints|Note|Follow)|\n\s*\n|$)/g)]
      .map((m) => m[1].replace(/\s*\n\s*/g, "").trim());
    const out = {
      slug, source: `leetcode.com, collected ${new Date().toISOString().slice(0, 10)}`,
      frontendId: q.questionFrontendId, title: q.title, premium: !!q.isPaidOnly,
      meta: JSON.parse(q.metaData),
      exampleInputs: q.exampleTestcaseList,
      exampleOutputs: outputs.length === q.exampleTestcaseList.length ? outputs : [],
      outputsNote: outputs.length === q.exampleTestcaseList.length ? undefined : `found ${outputs.length} outputs for ${q.exampleTestcaseList.length} examples`,
      anyOrder: /\bin any order\b/i.test(body),
    };
    await writeFile(file, JSON.stringify(out, null, 1) + "\n");
    report.ok.push(slug);
    process.stdout.write(`${i + 1}/${slugs.length} ${slug}\n`);
  } catch (e) {
    report.failed.push(`${slug}: ${e.message}`);
    process.stdout.write(`${i + 1}/${slugs.length} ${slug} FAILED ${e.message}\n`);
  }
}
console.log(`\ncollected ${report.ok.length}, no data ${report.empty.length}: ${report.empty.join(", ")}, failed ${report.failed.length}${report.failed.length ? ":\n  " + report.failed.join("\n  ") : ""}`);
