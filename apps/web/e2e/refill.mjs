// Reading again what the first pass missed -- order, progress and waste.
//
// APP-112: after the bar said "Listening to the audio · 100%", this pass ran
// for 76 to 233 seconds of a two-minute clip and said nothing. Two faults, and
// both are checked here without a model:
//
//   - it reported no progress, so a working screen looked finished;
//   - each round re-read every gap still open, including a span whose
//     identical reading had already come back empty -- the same samples,
//     decoded the same way, for the same nothing, charged to the same budget.
//
// A stub reader stands in for Whisper. That is the point rather than a
// shortcut: where Whisper drops a span changes from run to run and machine to
// machine (on the machine this was written on, neither test clip left a gap at
// all), so the only way to put a stubborn gap in front of this code on demand
// is to hand it one.
//
//   node --experimental-strip-types e2e/refill.mjs
//   REFILL_MODULE=/path/to/old.ts node --experimental-strip-types e2e/refill.mjs   # the code before
const RATE = 16000;
const mod = await import(process.env.REFILL_MODULE ?? "../src/lib/refill.ts");
const { fillGaps } = mod;

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; return; }
  fails.push(`${name}${detail ? ` -- ${detail}` : ""}`);
};

/** Seconds of steady, loud signal: every gap in it is a gap with sound in it. */
function loud(seconds) {
  const a = new Float32Array(Math.round(seconds * RATE));
  for (let i = 0; i < a.length; i += 1) a[i] = i % 2 ? 0.4 : -0.4;
  return a;
}

/**
 * Run fillGaps with a reader that is told which span each read is.
 *
 * fillGaps hands the reader only the samples. To script answers per span the
 * harness works out the span from the slice's length and the gaps it knows
 * are open, in the order fillGaps walks them -- which is also a check that
 * it walks them in order.
 */
async function run({ seconds, segments, answer }) {
  const audio = loud(seconds);
  const asked = [];
  const progress = [];
  const segs = segments.map((s) => ({ ...s }));
  const read = async (slice, language) => {
    // Find the open gap this slice fills: the first one, in time order, whose
    // length matches the slice. Ties are impossible in the cases below.
    const length = slice.length / RATE;
    const sorted = [...segs].sort((a, b) => a.start - b.start);
    let cursor = 0;
    let span = null;
    for (const s of [...sorted, { start: seconds, end: seconds }]) {
      if (Math.abs(s.start - cursor - length) < 0.01 && !span) span = { from: cursor, to: s.start };
      cursor = Math.max(cursor, s.end);
    }
    span ??= { from: NaN, to: NaN };
    asked.push({ ...span, language });
    return answer(span.from, span.to);
  };
  await fillGaps(segs, [{ from: 0, to: audio.length, language: "en" }], audio, read, undefined,
    (p) => progress.push({ ...p }));
  return { segs, asked, progress };
}

const key = (s) => `${s.from.toFixed(2)}-${s.to.toFixed(2)}`;

// --- the reporter's shape ------------------------------------------------
//
// Two gaps in a two-minute clip. One is a span Whisper half-recovers each
// time it is asked -- the case rounds exist for, since what it leaves is a new,
// shorter gap. The other is a span that comes back empty every time: music
// under the speech, or a failure that repeats. Budget for 120 s is six reads.
{
  const { segs, asked, progress } = await run({
    seconds: 120,
    segments: [
      { start: 0, end: 30, text: "a" },
      { start: 45, end: 70, text: "b" },
      { start: 80, end: 120, text: "c" },
    ],
    answer: (from, to) =>
      from >= 30 && to <= 45
        ? [{ text: "recovered", timestamp: [0, Math.min(3, to - from)] }] // fills the first 3 s
        : [], // 70-80 never yields anything
  });

  const counts = new Map();
  for (const a of asked) counts.set(key(a), (counts.get(key(a)) ?? 0) + 1);
  const repeated = [...counts].filter(([, n]) => n > 1);
  ok("no span is read twice with the same bounds", repeated.length === 0,
    repeated.map(([k, n]) => `${k} read ${n} times`).join(", "));
  ok("the stubborn span was read once", counts.get("70.00-80.00") === 1, String(counts.get("70.00-80.00")));
  ok("a gap left by a partial fill is still read -- that is what rounds are for",
    asked.some((a) => a.from > 30 && a.from < 45), JSON.stringify(asked.map(key)));
  ok("what was recovered is kept", segs.filter((s) => s.text === "recovered").length >= 2,
    String(segs.filter((s) => s.text === "recovered").length));

  // Progress: the screen is told, and told in a way it can use.
  ok("the pass reports progress at all", progress.length > 0);
  const notes = [...new Set(progress.map((p) => p.note))];
  ok("the first pass has its own note", notes[0] === "Checking for missed lines", JSON.stringify(notes));
  ok("a later pass says it is looking again", notes.includes("Checking again for missed lines"), JSON.stringify(notes));
  // The page keys its time-remaining clock on the note, so a note must stay
  // put for a whole pass and the fraction must carry the count.
  const firstPass = progress.filter((p) => p.note === "Checking for missed lines");
  ok("within a pass the fraction only rises",
    firstPass.every((p, i) => i === 0 || p.fraction >= firstPass[i - 1].fraction),
    JSON.stringify(firstPass.map((p) => p.fraction)));
  ok("and ends at 1", firstPass.at(-1)?.fraction === 1, JSON.stringify(firstPass.at(-1)));
  ok("every progress update is a transcribing stage", progress.every((p) => p.stage === "transcribing"));
}

// --- a clean clip: nothing to read, so nothing said ----------------------
{
  const { asked, progress } = await run({
    seconds: 60,
    segments: [{ start: 0, end: 30, text: "a" }, { start: 30.5, end: 60, text: "b" }],
    answer: () => [],
  });
  ok("a clip with no gaps reads nothing", asked.length === 0, String(asked.length));
  ok("and says nothing -- no flash of a stage that is not happening", progress.length === 0, JSON.stringify(progress));
}

// --- every read empty: one pass, then stop -------------------------------
{
  const { asked } = await run({
    seconds: 120,
    segments: [{ start: 0, end: 30, text: "a" }, { start: 40, end: 70, text: "b" }, { start: 80, end: 120, text: "c" }],
    answer: () => [],
  });
  ok("when a whole pass finds nothing, there is no second pass", asked.length === 2, String(asked.length));
}

// --- a long gap is not a slip, and is not read ---------------------------
{
  const { asked } = await run({
    seconds: 200,
    segments: [{ start: 0, end: 30, text: "a" }, { start: 120, end: 200, text: "b" }],
    answer: () => [],
  });
  ok("a gap over a minute is left alone", asked.length === 0, JSON.stringify(asked.map(key)));
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
