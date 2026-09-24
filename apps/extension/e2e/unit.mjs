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

// --- a seam where the tail of one line is the head of the next (APP-110) --
//
// The three seams below are verbatim from a two-minute lecture captured
// through the installed extension, once the windows genuinely overlapped.
// Every one of them came out with the phrase on screen twice.

for (const [name, kept, incoming, keptWant] of [
  ["a phrase heard at both ends of a seam is shown once",
    { start: 29.7, end: 35.4, text: "to his pant design, strategically placing them at points of strain, like the corners of pockets" },
    { start: 34.0, end: 38.0, text: "like the corners of pockets and the base of the fly." },
    "to his pant design, strategically placing them at points of strain,"],
  ["a whole sentence repeated at the seam is shown once",
    { start: 48.0, end: 54.0, text: "He approaches the supplier of his cloth, a dry goods merchant by the name of Levi Strauss." },
    { start: 51.0, end: 57.3, text: "a dry goods merchant by the name of Levi Strauss. Strauss and Davis begin manufacturing" },
    "He approaches the supplier of his cloth,"],
  ["a short phrase repeated at the seam is shown once",
    { start: 64.2, end: 69.5, text: "It is rumored that the removal of the crotch rivet was due to a complaint from the miners" },
    { start: 68.0, end: 74.3, text: "from the miners that squatting to near a campfire in their typical underwear-free fashion" },
    "It is rumored that the removal of the crotch rivet was due to a complaint"],
]) {
  const out = stitch([kept], [incoming]);
  eq(name, out.map((c) => c.text), [keptWant, incoming.text]);
  ok(`${name}: the lines no longer share the screen`, out[0].end <= out[1].start,
    `${out[0].end} > ${out[1].start}`);
}

{
  // The path the live run found and the cases above do not reach: the new
  // line is a better reading of the *last* line, so it replaces it -- and it
  // also repeats the end of the line *before* that. Verbatim from the capture.
  const out = stitch(
    [
      { start: 29.7, end: 35.4, text: "to his pant design, strategically placing them at points of strain, like the corners of pockets" },
      { start: 35.4, end: 36.9, text: "and the base of the fly." },
    ],
    [{ start: 34.0, end: 38.2, text: "like the corners of pockets and the base of the fly." }],
  );
  eq("a replacement also settles the seam behind it", out.map((c) => c.text), [
    "to his pant design, strategically placing them at points of strain,",
    "like the corners of pockets and the base of the fly.",
  ]);
  ok("and those two lines do not share the screen", out[0].end <= out[1].start, `${out[0].end} > ${out[1].start}`);
}

{
  // Whatever the path, two lines never overlap on screen.
  const out = stitch(
    [{ start: 82.4, end: 87.1, text: "fashion item for both work and play by the 1960s." }, { start: 87.1, end: 89.1, text: "Today, now" }],
    [{ start: 85.0, end: 87.3, text: "by the 1960s." }, { start: 87.3, end: 91.8, text: "Today, 96% of American consumers own at least one," }],
  );
  ok("no two lines share the screen", out.every((c, i) => i === 0 || c.start >= out[i - 1].end),
    out.map((c) => `${c.start}-${c.end}`).join(" "));
}

{
  // Verbatim from the final capture: the windows disagree about where one
  // line ends and the next begins, by 0.2 s. Clamping alone left
  // "a dry goods merchant" on screen for 0.2 s.
  const out = stitch(
    [{ start: 48.43, end: 52.9, text: "He approaches the supplier of his cloth," }, { start: 50.95, end: 52.9, text: "a dry goods merchant" }],
    [{ start: 51.15, end: 58.15, text: "by the name of Levi Strauss. Strauss and Davis begin manufacturing pants out of denim" }],
  );
  ok("no line is left too brief to read", out.every((c) => c.end - c.start >= 0.8),
    out.map((c) => `${(c.end - c.start).toFixed(2)}s ${c.text.slice(0, 24)}`).join(" | "));
  ok("and the words stay, in order", out.map((c) => c.text).join(" ").includes("a dry goods merchant by the name of Levi Strauss"),
    JSON.stringify(out.map((c) => c.text)));
  ok("and still no two lines share the screen", out.every((c, i) => i === 0 || c.start >= out[i - 1].end),
    out.map((c) => `${c.start}-${c.end}`).join(" "));
}

{
  // A script with no spaces: the repeat is found by character.
  const out = stitch(
    [{ start: 10, end: 16, text: "我们今天要讨论的是气候变化的影响" }],
    [{ start: 14, end: 20, text: "气候变化的影响非常深远" }],
  );
  eq("a repeated phrase in Chinese is shown once", out.map((c) => c.text), ["我们今天要讨论的是", "气候变化的影响非常深远"]);
}

{
  // One shared word is not a repeated phrase.
  const out = stitch(
    [{ start: 10, end: 16, text: "and then we went home to the" }],
    [{ start: 15, end: 20, text: "the next morning was cold" }],
  );
  eq("a single shared word is left alone", out.map((c) => c.text), ["and then we went home to the", "the next morning was cold"]);
  ok("but the two lines still do not share the screen", out[0].end <= out[1].start, `${out[0].end} > ${out[1].start}`);
}

{
  // A line that is nothing but the repeated phrase disappears entirely.
  const out = stitch(
    [{ start: 0, end: 5, text: "Hello." }, { start: 17, end: 20, text: "A young tailor named" }],
    [{ start: 17.5, end: 22, text: "A young tailor named Jacob Davis notices" }],
  );
  eq("a line wholly repeated by the next is not kept", out.map((c) => c.text), ["Hello.", "A young tailor named Jacob Davis notices"]);
}

// --- audio on the wire (APP-109) -----------------------------------------
//
// protocol.ts reaches for the `chrome` global as it loads, which Node does
// not have. Nothing here calls it; it only has to exist.
globalThis.chrome ??= {};
const { toWire, fromWire, blobToWire } = await import("../src/lib/protocol.ts");

{
  // Chromium carries extension messages as JSON. This is that hop, and it is
  // the entire fault: the buffer goes in and `{}` comes out, silently.
  const bytes = new Uint8Array([26, 69, 223, 163, 1, 0, 255, 128]);
  const lost = JSON.parse(JSON.stringify({ audio: bytes.buffer })).audio;
  eq("an ArrayBuffer does not survive JSON -- this is the 1.0.1 fault", lost, {});

  const carried = JSON.parse(JSON.stringify({ audio: toWire(bytes.buffer) })).audio;
  eq("wire text survives JSON byte for byte", [...fromWire(carried)], [...bytes]);
}

{
  // Every byte value, including the ones that break naive string encodings.
  const all = new Uint8Array(256).map((_, i) => i);
  eq("all 256 byte values round-trip", [...fromWire(toWire(all.buffer))], [...all]);
}

{
  // Big enough that the one-line `btoa(String.fromCharCode(...bytes))` throws
  // "Maximum call stack size exceeded". A long window at a high bitrate.
  const big = new Uint8Array(3 * 1024 * 1024).map((_, i) => (i * 31) & 255);
  let back = null;
  try { back = fromWire(toWire(big.buffer)); } catch (e) { back = e; }
  ok("a 3 MB window encodes without blowing the stack", back instanceof Uint8Array, String(back));
  ok("and decodes to the same bytes", back instanceof Uint8Array && back.length === big.length
    && back.every((v, i) => v === big[i]));
}

{
  // What the content script actually calls. In a browser it goes through a
  // data URL (see protocol.ts for why Firefox needs that); here, without
  // FileReader, through the bytes -- either way it has to land on the same
  // wire text.
  const bytes = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255]);
  const wire = await blobToWire(new Blob([bytes], { type: "audio/webm" }));
  eq("a recorded blob reaches the wire intact", [...fromWire(wire)], [...bytes]);
  eq("an empty blob is empty on the wire", await blobToWire(new Blob([])), "");
}

{
  const empty = new ArrayBuffer(0);
  eq("an empty window stays empty", [...fromWire(toWire(empty))], []);
}

// -------------------------------------------------------------------------

// --- keeping pace (APP-110, APP-121) --------------------------------------
{
  const { startsOnCpu, enqueue, maxWaiting, behindNote } = await import("../src/lib/pace.ts");

  ok("an Intel iGPU runs on the CPU (Chrome, Iris Xe: 14-30 s a window on WebGPU)", startsOnCpu({ integrated: true }));
  ok("Firefox with an anonymous adapter runs on the CPU", startsOnCpu({ cpuFirst: true }));
  ok("a discrete card or Apple silicon stays on the GPU", !startsOnCpu({ integrated: false, cpuFirst: false }));
  ok("no facts at all stays on the GPU", !startsOnCpu({}));

  // The reproduced pattern: the first window waits for the model, and five
  // more arrive meanwhile. A bound of three dropped one of them.
  const max = maxWaiting(20);
  const waiting = [];
  const dropped = [1, 2, 3, 4, 5].map((w) => enqueue(waiting, w, max));
  ok("windows recorded while the model loads all wait; none is dropped", dropped.every((d) => !d) && waiting.join() === "1,2,3,4,5",
    JSON.stringify({ dropped, waiting }));
  ok("they are read in order", waiting[0] === 1);
  ok("fifteen minutes of twenty-second windows may wait", max === 45, String(max));
  ok("the bound is time, not a count: ten-second passes allow twice as many", maxWaiting(10) === 90);
  const full = Array.from({ length: max }, (_, i) => i);
  ok("past fifteen minutes behind, the oldest goes and the drop is reported", enqueue(full, "new", max) === true && full[0] === 1 && full.length === max);

  ok("one window waiting just says so", behindNote(1, "onnx-community/whisper-base") === "Transcribing (catching up: 1 window waiting)");
  ok("falling further behind names the model that keeps up", /Tiny model keeps up/.test(behindNote(3, "onnx-community/whisper-base")));
  ok("unless it is already the one in use", !/Tiny model/.test(behindNote(3, "onnx-community/whisper-tiny")));
}

// --- whose frame is it (APP-133, retest) ----------------------------------
{
  const { siteOf, MIN_WINDOW_MS } = await import("../src/lib/capture.ts");
  ok("Dailymotion's player frame is Dailymotion's own site", siteOf("geo.dailymotion.com") === siteOf("www.dailymotion.com"));
  ok("a YouTube embed on a blog is another site", siteOf("www.youtube.com") !== siteOf("blog.example.org"));
  ok("a window under a second is not sent (the ad's last instant)", MIN_WINDOW_MS === 1000);
}

// --- what goes on the video while transcription trails it (APP-139) ------
{
  const { liveLine, BEHIND_S } = await import("../src/lib/pace.ts");
  // Lines for the first 40 seconds, while the video plays on past them --
  // the reported shape: 27 lines made, the picture at 1:20, nothing shown.
  const cues = Array.from({ length: 8 }, (_, i) => ({ start: i * 5, end: i * 5 + 5 }));
  const fresh = { index: -1, until: 0 };

  ok("nothing yet means nothing on screen", liveLine([], 10, 1000, fresh) === null);

  const behind = liveLine(cues, 80, 1000, fresh);
  ok("trailing far behind, the first unseen line is shown", behind?.index === 0, JSON.stringify(behind));
  ok("and it says how far back it is", Math.round(behind.lag) === 75, String(behind?.lag));

  // It is held long enough to read, then the next one goes up.
  const held = liveLine(cues, 81, 1500, { index: 0, until: 3000 });
  ok("a line stays up while it is being read", held?.index === 0, JSON.stringify(held));
  const moved = liveLine(cues, 82, 3001, { index: 0, until: 3000 });
  ok("then the next one takes its place", moved?.index === 1, JSON.stringify(moved));

  // With only a few unseen, each line is held for its own length, so they
  // read at the pace they were spoken.
  ok("a line is held for about as long as it was spoken", moved.until - 3001 === 5000, String(moved.until - 3001));

  // A long backlog is gone through faster, so the overlay reaches the newest
  // instead of sitting minutes behind it.
  const many = Array.from({ length: 30 }, (_, i) => ({ start: i * 5, end: i * 5 + 5 }));
  const hurried = liveLine(many, 200, 3001, { index: 0, until: 3000 });
  ok("a long backlog holds each line briefly", hurried.until - 3001 <= 1200, String(hurried.until - 3001));

  // At the newest line it stays there rather than blanking.
  const newest = liveLine(cues, 90, 9000, { index: 7, until: 8000 });
  ok("it rests on the newest line", newest?.index === 7, JSON.stringify(newest));

  // Seeking back to a line's own moment shows that line, as it always did.
  const exact = liveLine(cues, 12, 9000, { index: 7, until: 99999 });
  ok("seeking back shows the line for that moment", exact?.index === 2 && exact.lag === 0, JSON.stringify(exact));

  // A real pause in speech is not a backlog: nothing is shown.
  const quiet = liveLine(cues, 42, 9000, { index: 7, until: 0 });
  ok("a short silence after the last line shows nothing", quiet === null, JSON.stringify(quiet));
  ok("the threshold between the two is five seconds", BEHIND_S === 5);
}

// --- which model "Automatic" reads with (APP-142) -------------------------
{
  const { pickModel, AUTO_FAST, AUTO_GOOD, AUTO_BEHIND } = await import("../src/lib/pace.ts");
  ok("on the GPU, Automatic reads with Base", pickModel("auto", "webgpu", false) === AUTO_GOOD);
  ok("on the processor it starts on Tiny -- the machines that cannot carry Base",
    pickModel("auto", "wasm", false) === AUTO_FAST);
  ok("a GPU that falls behind drops to Tiny too", pickModel("auto", "webgpu", true) === AUTO_FAST);
  ok("Tiny here is the multilingual one, not the English-only build", AUTO_FAST === "onnx-community/whisper-tiny");
  ok("a model the user chose is left alone, however slow",
    pickModel("onnx-community/whisper-small", "wasm", true) === "onnx-community/whisper-small");
  ok("two windows waiting is the point of giving up on Base", AUTO_BEHIND === 2);
}

// --- adjacent lines must not repeat each other (APP-154) -----------------
//
// Reported on rc.14 and rc.15, from three machines and three videos. Every
// sample below is verbatim from the report.
{
  // Firefox 156 on YouTube: the tail of one line is the head of the next,
  // and the two cues only touch -- they do not overlap in time, which is
  // what the seam logic was keyed on.
  let out = stitch(
    [{ start: 10, end: 14, text: "Nothing is ever what it seems, given a simple command. Don't look" }],
    [{ start: 14, end: 17, text: "Don't look back." }],
  );
  ok("a phrase at the end of one line is not repeated at the start of the next",
    !/Don't look[\s\S]*Don't look/i.test(out.map((c) => c.text).join(" ")),
    JSON.stringify(out.map((c) => c.text)));

  // One word is enough to read twice, when it is the whole of the overlap.
  out = stitch(
    [{ start: 14, end: 17, text: "Don't look back." }],
    [{ start: 17, end: 21, text: "back. Just keep walking forward." }],
  );
  ok("nor a single word at the join",
    !/back[\s\S]*back/i.test(out.map((c) => c.text).join(" ")),
    JSON.stringify(out.map((c) => c.text)));

  // The same seam with the readings disagreeing about a word or two, which
  // is the usual shape: "crying out an agony" against "crying out in agony".
  out = stitch(
    [{ start: 30, end: 35, text: "the ones crying out an agony. Just keep" }],
    [{ start: 35, end: 40, text: "ones crying out in agony. Just keep walking." }],
  );
  ok("a near-miss repeat at the seam is settled too",
    out.map((c) => c.text).join(" ").toLowerCase().split("crying out").length - 1 === 1,
    JSON.stringify(out.map((c) => c.text)));

  // Edge 146 on YouTube: one line that says the same sentence twice. Nothing
  // follows it -- the repetition is inside the line itself.
  out = stitch([], [{ start: 0, end: 6,
    text: "We'll touch a little bit more on this later. We'll touch a little bit more on this later, but for now, let's keep going." }]);
  ok("a line does not say the same sentence twice",
    out[0].text.toLowerCase().split("touch a little bit more").length - 1 === 1,
    JSON.stringify(out.map((c) => c.text)));

  // The automated run's first line, same shape with the repeat inexact.
  out = stitch([], [{ start: 0, end: 7,
    text: "And explainer video is a short In Explaner Video, a short video that can explain a company," }]);
  ok("...even when the two readings of it differ slightly",
    out[0].text.toLowerCase().split("a short").length - 1 === 1,
    JSON.stringify(out.map((c) => c.text)));

  // And the case this must not break: a chorus, said twice on purpose, far
  // enough apart that it is two utterances rather than one seam.
  out = stitch(
    [{ start: 0, end: 2, text: "Here we go again" }],
    [{ start: 90, end: 92, text: "Here we go again" }],
  );
  ok("a line genuinely said twice, a minute apart, is still two lines", out.length === 2);
}

// --- the subtitle sizes (APP-147) ----------------------------------------
{
  const { SIZES, DEFAULT_SIZE, nearestSize } = await import("../src/lib/pace.ts");
  const { DEFAULT_SETTINGS } = await import("../src/lib/protocol.ts");
  eq("three sizes, smallest first", [...SIZES], [0.6, 0.8, 1]);
  ok("the smallest is smaller than the old smallest, which still covered the picture", SIZES[0] < 0.8);
  ok("the middle one is what a fresh install gets", DEFAULT_SIZE === SIZES[1] && DEFAULT_SETTINGS.fontScale === SIZES[1]);
  ok("every step is a visible one", SIZES.every((s, i) => i === 0 || s / SIZES[i - 1] >= 1.2));
  // A size saved by rc.13, where the sizes went up to 1.7 and the select had
  // an option for each: it has to land on one of the three now offered, or
  // the popup shows an empty box.
  ok("extra large becomes the largest there is", nearestSize(1.7) === 1);
  ok("the old large becomes the largest too", nearestSize(1.3) === 1);
  ok("the old medium is the new large", nearestSize(1) === 1);
  ok("the old small is the new medium", nearestSize(0.8) === 0.8);
  ok("a size that is already offered is left alone", nearestSize(0.6) === 0.6);
  ok("nonsense falls back to the default", nearestSize(0) === DEFAULT_SIZE && nearestSize(NaN) === DEFAULT_SIZE);
}

// --- the first window is short (APP-148) ---------------------------------
{
  const { FIRST_WINDOW_S } = await import("../src/lib/pace.ts");
  const { MIN_WINDOW_BYTES, MIN_WINDOW_MS } = await import("../src/lib/capture.ts");
  // A recorder opened on a track carrying no audio returns the container
  // header alone -- 111 bytes, measured, on a run where the video had ended
  // before Start. A second of real Opus is nearer ten thousand.
  ok("a container with nothing in it is not sent", MIN_WINDOW_BYTES > 111);
  ok("and a second of real audio still is", MIN_WINDOW_BYTES < 10000);
  ok("the length guard is still there too", MIN_WINDOW_MS === 1000);
  const { SILENT_WINDOWS } = await import("../src/lib/capture.ts");
  // Long enough that one recorder opening on a paused video is waited out,
  // short enough that a muted video is reported inside a minute.
  ok("a run of empty windows is reported rather than waited out", SILENT_WINDOWS >= 2 && SILENT_WINDOWS <= 4);
  const { OVERLAP_S } = await import("../src/lib/seam.ts");
  const { DEFAULT_SETTINGS } = await import("../src/lib/protocol.ts");
  ok("the first pass is shorter than a normal one", FIRST_WINDOW_S < DEFAULT_SETTINGS.window);
  ok("and long enough to hold a sentence", FIRST_WINDOW_S >= 5);
  ok("it still leaves room for the overlap the seams need", FIRST_WINDOW_S > OVERLAP_S);
}

// --- the store listings, one per language --------------------------------
{
  const { readdirSync, readFileSync, existsSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = dirname(dirname(fileURLToPath(import.meta.url)));

  // Chrome's own table of the locales an extension may carry
  // (developer.chrome.com/docs/extensions/reference/api/i18n). A folder that
  // is not on it is rejected at upload -- "pt" was, and had to become "pt_PT".
  const CHROME = new Set(("ar am bg bn ca cs da de el en en_AU en_GB en_US es es_419 et fa fi fil fr gu he hi hr hu "
    + "id it ja kn ko lt lv ml mr ms nl no pl pt_BR pt_PT ro ru sk sl sr sv sw ta te th tr uk vi zh_CN zh_TW").split(" "));

  const read = (dir, loc) => JSON.parse(readFileSync(join(root, "public", dir, loc, "messages.json"), "utf8"));
  const locales = readdirSync(join(root, "public", "_locales")).filter((n) => !n.startsWith("."));

  ok("every language the listing is written in is one Chrome accepts",
    locales.every((l) => CHROME.has(l)), locales.filter((l) => !CHROME.has(l)).join(", "));
  ok("English is there, because the manifest names it as the fallback", locales.includes("en"));

  for (const loc of locales) {
    const m = read("_locales", loc);
    eq(`${loc}: the manifest's two strings, and nothing else`, Object.keys(m).sort(), ["description", "name"]);
    ok(`${loc}: neither string is empty`, m.name.message.trim() !== "" && m.description.message.trim() !== "");
    // 75 characters, from the manifest reference. Over it the upload fails.
    ok(`${loc}: the name fits the Chrome Web Store`, m.name.message.length <= 75, `${m.name.message.length} chars`);
  }

  // Firefox shows the name in a narrower column and on a page that truncates
  // it, so those are shorter; the overlay may leave a language out, and then
  // that language keeps the Chrome wording.
  const ff = join(root, "public", "_locales.firefox");
  for (const loc of readdirSync(ff).filter((n) => !n.startsWith("."))) {
    ok(`${loc}: a Firefox name only for a language the listing has`, locales.includes(loc));
    const m = read("_locales.firefox", loc);
    eq(`${loc}: the same two strings for Firefox`, Object.keys(m).sort(), ["description", "name"]);
    ok(`${loc}: the Firefox name is the shorter of the two`, m.name.message.length <= 50, `${m.name.message.length} chars`);
  }
  ok("the Firefox overlay is only copied over the Firefox build",
    existsSync(join(root, "scripts", "copy-static.mjs"))
    && /_locales\.firefox/.test(readFileSync(join(root, "scripts", "copy-static.mjs"), "utf8")));
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
