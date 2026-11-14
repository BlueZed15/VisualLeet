// Builds problems/batch-<name>.json: the next problems to add to the database,
// from LeetCode's own study plans (most-practiced first), then the most-liked
// free problems (LeetCode's "algorithms" category only: no SQL, pandas, shell or
// concurrency problems), skipping ones already in the database and premium ones.
//
//   node scripts/collect-lists.mjs --count 400 --name 2026-11-15
//
// Polite: a handful of requests, one at a time, no cookies or user data.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (name, def) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : def; };
const COUNT = Number(arg("--count", "400"));
const NAME = arg("--name", new Date().toISOString().slice(0, 10));
const PLANS = ["leetcode-75", "top-interview-150", "top-100-liked"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gql(query, variables) {
  const res = await fetch("https://leetcode.com/graphql/", {
    method: "POST",
    headers: { "content-type": "application/json", referer: "https://leetcode.com/problemset/" },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error("HTTP " + res.status);
  const j = await res.json();
  if (j.errors) throw new Error(JSON.stringify(j.errors).slice(0, 300));
  return j.data;
}

const have = new Set(Object.keys(JSON.parse(readFileSync(path.join(root, "src", "problems", "index.json"), "utf8")).problems));
const picked = [], seen = new Set(have), sources = {};
const add = (slug, from, paid) => {
  if (!slug || seen.has(slug) || paid || picked.length >= COUNT) return;
  seen.add(slug);
  picked.push(slug);
  sources[slug] = from;
};

// 1. LeetCode's study plans, in order
for (const plan of PLANS) {
  const d = await gql(`query p($slug: String!) { studyPlanV2Detail(planSlug: $slug) { planSubGroups { questions { titleSlug paidOnly } } } }`, { slug: plan });
  const qs = (d.studyPlanV2Detail?.planSubGroups || []).flatMap((g) => g.questions || []);
  for (const q of qs) add(q.titleSlug, plan, q.paidOnly);
  console.log(`${plan}: ${qs.length} problems, ${picked.length} picked so far`);
  await sleep(1500);
}

// 2. the most-liked free problems (likes come with each question)
if (picked.length < COUNT) {
  const all = [];
  for (let skip = 0; skip < 5000; skip += 100) {
    const d = await gql(`query l($skip: Int!, $limit: Int!) { problemsetQuestionList: questionList(categorySlug: "algorithms", limit: $limit, skip: $skip, filters: {}) {
      total: totalNum questions: data { titleSlug isPaidOnly likes } } }`, { skip, limit: 100 });
    const qs = d.problemsetQuestionList.questions || [];
    all.push(...qs);
    console.log(`list ${skip}: ${qs.length}`);
    if (qs.length < 100) break;
    await sleep(1500);
  }
  all.sort((a, b) => (b.likes || 0) - (a.likes || 0));
  for (const q of all) add(q.titleSlug, "most-liked", q.isPaidOnly);
}

const file = path.join(root, "problems", `batch-${NAME}.json`);
writeFileSync(file, JSON.stringify({ about: `Next problems for the database (${NAME}): LeetCode study plans ${PLANS.join(", ")}, then most-liked free problems; not premium, not already in.`, slugs: picked, sources }, null, 1) + "\n");
const bySource = picked.reduce((m, s) => ((m[sources[s]] = (m[sources[s]] || 0) + 1), m), {});
console.log(`wrote ${path.relative(root, file)}: ${picked.length} problems`, JSON.stringify(bySource));
