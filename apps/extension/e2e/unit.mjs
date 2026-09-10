// The stitching logic, which is the part with no browser in it.
//
// Run with:  node --experimental-strip-types e2e/unit.mjs
import { sameness, stitch, cueAt, toSrt, toVtt, OVERLAP_S } from "../src/lib/seam.ts";

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; return; }
  fails.push(`${name}${detail ? ` -- ${detail}` : ""}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);

// --- sameness ------------------------------------------------------------

ok("identical text is fully same", sameness("hello there", "hello there") === 1);
ok("punctuation and case do not matter", sameness("Hello, there!", "hello there") === 1);
ok("a truncation is mostly same", sameness("we should mention that the", "we should mention that the earth") > 0.9);
ok("different sentences are not same", sameness("the cat sat down", "a dog ran away") < 0.5);
ok("empty is never same", sameness("", "anything") === 0);
ok(
  "similar words, different sentence, stays apart",
  sameness("the cat sat", "the mat sat") < 0.7,
  String(sameness("the cat sat", "the mat sat")),
);

// --- stitch --------------------------------------------------------------

{
  // The APP-51/52 shape, at a window seam: window N ends mid-sentence and
  // window N+1 says the whole thing.
  const kept = [
    { start: 10, end: 12, text: "First we should mention that the" },
  ];
  const incoming = [
    { start: 10.1, end: 15, text: "First we should mention that the Earth's crust is made of rock." },
  ];
  const out = stitch(kept, incoming);
  eq("a seam repeat does not duplicate", out.length, 1);
  eq("the fuller reading wins", out[0].text, incoming[0].text);
  ok("the span only grows", out[0].start === 10 && out[0].end === 15);
}

{
  const kept = [{ start: 0, end: 2, text: "One." }];
  const out = stitch(kept, [{ start: 3, end: 5, text: "Two." }]);
  eq("a genuinely new line is appended", out.length, 2);
}

{
  // Same words, a minute apart: a chorus, not a seam.
  const kept = [{ start: 0, end: 2, text: "Here we go again" }];
  const out = stitch(kept, [{ start: 90, end: 92, text: "Here we go again" }]);
  eq("a repeat far away is a real repeat", out.length, 2);
}

{
  const out = stitch([], [{ start: 5, end: 6, text: "b" }, { start: 1, end: 2, text: "a" }]);
  eq("output is sorted by start", out.map((c) => c.text), ["a", "b"]);
}

{
  const out = stitch([{ start: 0, end: 1, text: "keep" }], [{ start: 2, end: 3, text: "   " }]);
  eq("blank cues are dropped", out.length, 1);
}

{
  // The overlap window is what makes a seam a seam; a cue further out than
  // that must not be swallowed even if the words match.
  const kept = [{ start: 0, end: 2, text: "the same words here" }];
  const out = stitch(kept, [{ start: OVERLAP_S + 6, end: OVERLAP_S + 8, text: "the same words here" }]);
  eq("beyond the overlap it is a separate line", out.length, 2);
}

// --- cueAt ---------------------------------------------------------------

{
  const cues = [
    { start: 0, end: 2, text: "a" },
    { start: 2, end: 4, text: "b" },
    { start: 6, end: 8, text: "c" },
  ];
  eq("start of a cue", cueAt(cues, 0)?.text, "a");
  eq("inside a cue", cueAt(cues, 3)?.text, "b");
  eq("the boundary belongs to the later cue", cueAt(cues, 2)?.text, "b");
  eq("a gap shows nothing", cueAt(cues, 5), null);
  eq("past the end shows nothing", cueAt(cues, 99), null);
}

// --- writers -------------------------------------------------------------

{
  const cues = [{ start: 1.5, end: 3.25, text: "Hello" }, { start: 3.5, end: 4, text: "there" }];
  const srt = toSrt(cues);
  ok("srt numbers from one", srt.startsWith("1\n"));
  ok("srt uses a comma for milliseconds", srt.includes("00:00:01,500 --> 00:00:03,250"), srt.split("\n")[1]);
  ok("srt has both cues", srt.includes("Hello") && srt.includes("there"));
  const vtt = toVtt(cues);
  ok("vtt has its header", vtt.startsWith("WEBVTT\n"));
  ok("vtt uses a full stop for milliseconds", vtt.includes("00:00:01.500 --> 00:00:03.250"));
}

{
  // An hour in, which is where a naive minutes field overflows.
  const srt = toSrt([{ start: 3725.001, end: 3726, text: "x" }]);
  ok("past an hour the clock still reads correctly", srt.includes("01:02:05,001"), srt.split("\n")[1]);
}

// -------------------------------------------------------------------------

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
