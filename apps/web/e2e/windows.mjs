// The progress bar's window count against what the pipeline really reads.
//
// APP-112: the bar reached "Listening to the audio · 100%" and then sat there
// -- on a two-minute clip, 19 seconds of it before the missed-line check even
// started. The bar counts finished Whisper windows, and the total it divides
// by was counted over each language run, while each pass reads three seconds
// past its run to finish a sentence. Whenever those three seconds tipped a
// pass into one more window, the bar ran out of windows before the pipeline
// did.
//
// The reference here is the pipeline's own loop, transcribed from
// transformers.js `_call_whisper`, applied to the slices asr.ts hands it.
//
//   node --experimental-strip-types e2e/windows.mjs
const { whisperWindows, passEnd, plannedWindows, LEAD_OUT_S, seekAfter, windowProgress, WINDOW_FRAMES } = await import("../src/lib/windows.ts");

const RATE = 16000, CHUNK = 30, STRIDE = 5;
let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => { if (cond) pass += 1; else fails.push(`${name}${detail ? ` -- ${detail}` : ""}`); };

/** transformers.js: offset += jump until offset + window >= length. */
function pipelineWindows(samples) {
  const window = RATE * CHUNK, jump = window - 2 * RATE * STRIDE;
  let offset = 0, n = 0;
  for (;;) { n += 1; if (offset + window >= samples) return n; offset += jump; }
}
const s = (sec) => Math.round(sec * RATE);

// --- whisperWindows mirrors the pipeline at the boundaries --------------
for (const sec of [1, 29.9, 30, 30.01, 49.99, 50, 50.01, 70, 124.37, 600]) {
  ok(`${sec}s cuts into the pipeline's own number of windows`,
    whisperWindows(s(sec), CHUNK, STRIDE) === pipelineWindows(s(sec)),
    `${whisperWindows(s(sec), CHUNK, STRIDE)} vs ${pipelineWindows(s(sec))}`);
}

// --- a pass reads its lead-out, and no further than the audio -----------
ok("a pass reads three seconds past its run", passEnd({ from: 0, to: s(20) }, s(100)) === s(20 + LEAD_OUT_S));
ok("but never past the end of the audio", passEnd({ from: s(90), to: s(99) }, s(100)) === s(100));

// --- the count, over what the passes read --------------------------------
const cases = [
  { name: "one language, the whole clip", length: 124.37, cuts: [] },
  // A run of 29 s reads 32 s: two windows, where the run alone counts one.
  { name: "a run the lead-out tips into a second window", length: 124.37, cuts: [29] },
  { name: "the reporter-sized clip split three ways", length: 114, cuts: [28.5, 48.5] },
  { name: "many short runs", length: 120, cuts: [9, 18, 29, 47, 69, 88.5] },
];
for (const c of cases) {
  const length = s(c.length);
  const edges = [0, ...c.cuts.map(s), length];
  const runs = edges.slice(0, -1).map((from, i) => ({ from, to: edges[i + 1] }));
  const read = runs.reduce((n, r) => n + pipelineWindows(passEnd(r, length) - r.from), 0);
  const planned = plannedWindows(runs, length, CHUNK, STRIDE);
  ok(`${c.name}: the bar expects exactly the windows the pipeline reads`, planned === read, `${planned} vs ${read}`);
}

// And the case that was wrong: counted the old way, the bar is a window short.
{
  const length = s(124.37);
  const runs = [{ from: 0, to: s(29) }, { from: s(29), to: length }];
  const old = runs.reduce((n, r) => n + whisperWindows(r.to - r.from, CHUNK, STRIDE), 0);
  const read = runs.reduce((n, r) => n + pipelineWindows(passEnd(r, length) - r.from), 0);
  ok("counting runs without their lead-out comes up short (the APP-112 shape)", old < read, `${old} vs ${read}`);
}

// --- a window is not one call: the seek loop ----------------------------
//
// transformers.js 4 reads each window with timestamps in a seek loop. The
// token sequences below follow each branch of its `_generate_with_seek`.
// Whisper's ids: timestamps start at 50365, end of text is 50257, and text
// tokens are anything below. A timestamp token t is t * 0.02 s, 2 mel frames.
const TB = 50365, EOS = 50257, W = "word";
const tok = (...xs) => xs.map((x) => (x === W ? 1000 : x === "eos" ? EOS : TB + x));
ok("a call ending on a lone timestamp finishes the window",
  seekAfter(tok(0, W, W, 500, 500, W, 1400, "eos"), TB, EOS, 0) === WINDOW_FRAMES);
ok("a call that stops mid-segment seeks to the last pair",
  seekAfter(tok(0, W, 600, 600, W, W), TB, EOS, 0) === 1200,
  String(seekAfter(tok(0, W, 600, 600, W, W), TB, EOS, 0)));
ok("and a later call's seek is counted from where it started",
  seekAfter(tok(0, W, 300, 300, W), TB, EOS, 1200) === 1800);
ok("no pair of timestamps consumes the window", seekAfter(tok(0, W, W), TB, EOS, 0) === WINDOW_FRAMES);
ok("nothing generated gives up on the window", seekAfter(tok("eos"), TB, EOS, 900) === WINDOW_FRAMES);

// The APP-112 shape: two windows, the first read in three calls.
{
  const p = windowProgress(2, TB, EOS);
  const call = (tokens) => { p.put([[1n, 2n, 3n]]); for (const t of tokens) p.put([[BigInt(t)]]); p.end(); return p.fraction; };
  const seen = [
    call(tok(0, W, 600, 600, W, W)),          // seek to 1200 of 3000
    call(tok(0, W, 450, 450, W)),             // to 2100
    call(tok(0, W, 400, "eos")),              // lone ending: window 1 done
    call(tok(0, W, 700, 700, W, 1500, "eos")),// window 2 done
  ];
  ok("the bar moves within a window as the seek advances", seen[0] > 0 && seen[1] > seen[0] && seen[1] < 0.5, JSON.stringify(seen));
  ok("a window counts once, however many calls it took", seen[2] === 0.5, JSON.stringify(seen));
  ok("and 100% is the end of the last window, not the fourth call of six", seen[3] === 1, JSON.stringify(seen));
  // Counted the old way -- one window per end() -- it said 100% after two calls.
  ok("counting calls as windows would have said 100% halfway (the APP-112 shape)", Math.min(2 / 2, 1) === 1 && seen[1] < 1);
}
{
  const p = windowProgress(4);
  p.put([[1n]]); p.put([[5n]]); p.end();
  ok("without the token ids each call counts as a window, as before", p.fraction === 0.25, String(p.fraction));
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
