// APP-33. The language-label smoothing rule, on its own.
//
// The Korean hallucination the report describes as intermittent is a
// detection fault: with nobody having named a language, all 99 are on the
// ballot and a single four-second window can come back as the wrong one.
// Reaching that through a whole transcription depends on the model
// producing the mislabel again, which is exactly what "intermittent"
// means -- so the rule is tested on the labels themselves.
//
// The two sequences below are real, read off the clips to hand with the
// probe in e2e/langprobe:
//
//     ja.mp4   38 cells, 35 ja -- the first two read as English
//     zh.mp4   44 cells, 43 zh -- the last one read as Korean
//
//   node --experimental-strip-types e2e/labels.mjs
import assert from "node:assert/strict";
import { smoothLabels } from "../src/lib/languages.ts";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed += 1; console.log(`  ok  ${name}`); }
  catch (e) { failed += 1; console.log(`FAIL  ${name}\n      ${e.message.split("\n").join("\n      ")}`); }
}

const run = (label, n) => Array(n).fill(label);

test("a lone disagreement in the middle is erased", () => {
  assert.deepEqual(smoothLabels(["zh", "zh", "ko", "zh", "zh"]), run("zh", 5));
});

test("APP-33: a lone Korean cell at the END is erased", () => {
  // zh.mp4's shape: 43 Chinese cells then one Korean.
  const labels = [...run("zh", 43), "ko"];
  assert.deepEqual(smoothLabels(labels), run("zh", 44));
});

test("APP-33: a lone English cell at the START is erased", () => {
  const labels = ["en", ...run("ja", 37)];
  assert.deepEqual(smoothLabels(labels), run("ja", 38));
});

test("two disagreeing cells at the start survive -- eight seconds is believed", () => {
  // ja.mp4's actual shape. Two cells is the standard the interior rule
  // sets, and the edge rule must not be stricter than it: an eight-second
  // opening in another language is a real thing.
  const labels = ["en", "en", ...run("ja", 36)];
  assert.deepEqual(smoothLabels(labels), ["en", "en", ...run("ja", 36)]);
});

test("a real language change is not erased", () => {
  const labels = [...run("en", 10), ...run("zh", 10)];
  assert.deepEqual(smoothLabels(labels), [...run("en", 10), ...run("zh", 10)]);
});

test("a two-cell island in the middle survives", () => {
  const labels = [...run("zh", 5), "en", "en", ...run("zh", 5)];
  assert.deepEqual(smoothLabels(labels), [...run("zh", 5), "en", "en", ...run("zh", 5)]);
});

test("short inputs are left alone rather than crashing", () => {
  assert.deepEqual(smoothLabels([]), []);
  assert.deepEqual(smoothLabels(["ja"]), ["ja"]);
  assert.deepEqual(smoothLabels(["ja", "ko"]), ["ja", "ko"]);
});

test("an alternating sequence collapses to the majority", () => {
  // Every "b" here is a lone disagreement between two "a"s, so the rule
  // erases each of them -- which is the rule working, not failing. The
  // alternative is five one-cell runs and a transcript fragmented into
  // five passes, on a clip the detector plainly cannot read.
  //
  // The pass is in place and left to right, so an earlier correction is
  // visible to a later one. That only ever strengthens agreement; it
  // cannot manufacture a disagreement.
  assert.deepEqual(smoothLabels(["a", "b", "a", "b", "a"]), run("a", 5));
});

test("a run of three is never collapsed, wherever it sits", () => {
  assert.deepEqual(
    smoothLabels([...run("ja", 4), ...run("ko", 3), ...run("ja", 4)]),
    [...run("ja", 4), ...run("ko", 3), ...run("ja", 4)],
  );
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
