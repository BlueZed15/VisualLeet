// The "Report a problem" link: prefilled Google Form fields, code capped.
import test from "node:test";
import assert from "node:assert/strict";
import { formUrl } from "../src/ui/report.js";

const read = (url) => new URL(url).searchParams;

test("report link: message, details and the optional answer are prefilled", () => {
  const q = read(formUrl({ message: " Arrows wrong ", improve: "More problems", details: "Problem: Two Sum (two-sum)" }));
  assert.equal(q.get("usp"), "pp_url");
  assert.equal(q.get("entry.326955045"), "Arrows wrong\n\n--- Details ---\nProblem: Two Sum (two-sum)");
  assert.equal(q.get("entry.1447967852"), "More problems");
  assert.equal(read(formUrl({ message: "x" })).has("entry.1447967852"), false);   // left for the form to ask
});

test("report link: code only when included, cut to 3,000 characters", () => {
  assert.doesNotMatch(read(formUrl({ message: "x" })).get("entry.326955045"), /Code/);
  const long = "a".repeat(5000);
  const what = read(formUrl({ message: "x", code: long })).get("entry.326955045");
  assert.match(what, /--- Code \(first 3000 characters\) ---\n/);
  assert.equal(what.split("---\n").pop().length, 3000);
  assert.ok(formUrl({ message: "x", code: long, details: "d".repeat(600) }).length < 8000);
});
