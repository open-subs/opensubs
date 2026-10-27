// The subtitle list's edits, without a browser: times, delete, add, split,
// merge, undo -- and above all that the translation's original and the
// per-word loudness stay one per cue through all of them.
//
//   node --experimental-strip-types e2e/cueedit.mjs
import {
  History,
  breakNear,
  clearCheck,
  exportable,
  formatClock,
  insertAfter,
  insertAtPlayhead,
  insertCue,
  mergeWithNext,
  parseClock,
  removeCue,
  setText,
  setTimes,
  splitAtPlayhead,
  splitCue,
  timeAtPlayhead,
} from "../src/lib/cueedit.ts";

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; return; }
  fails.push(`${name}${detail ? ` -- ${detail}` : ""}`);
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want), `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
const words = (lines) => lines.join(" ").split(/\s+/).filter(Boolean).length;

/** A transcribed and translated track: three cues, their originals, loudness per original word. */
function bilingual() {
  const source = [
    { start: 0, end: 3, lines: ["This is a sample video"] },
    { start: 3.5, end: 6, lines: ["Nothing was uploaded"] },
    { start: 6.5, end: 9, lines: ["Pick a style"] },
  ];
  const cues = [
    { start: 0, end: 3, lines: ["这是一个示例视频"] },
    { start: 3.5, end: 6, lines: ["没有上传任何东西"] },
    { start: 6.5, end: 9, lines: ["选一个样式"] },
  ];
  const loudness = source.map((c) => c.lines.join(" ").split(/\s+/).map((_, k) => 0.1 * (k + 1)));
  return { cues, source, loudness };
}
function plain() {
  const cues = [
    { start: 0, end: 2, lines: ["one two three four"] },
    { start: 2.5, end: 4, lines: ["five six"] },
  ];
  return { cues, source: null, loudness: cues.map((c) => c.lines[0].split(" ").map(() => 0.5)) };
}
/** Every list one per cue, cues in order, each starting before it ends. */
function sound(track) {
  const n = track.cues.length;
  if (track.source && track.source.length !== n) return `source ${track.source.length} vs ${n}`;
  if (track.loudness.length && track.loudness.length !== n) return `loudness ${track.loudness.length} vs ${n}`;
  for (let i = 0; i < n; i++) {
    const c = track.cues[i];
    if (!(c.start < c.end)) return `cue ${i} starts at ${c.start}, ends at ${c.end}`;
    if (i && c.start < track.cues[i - 1].start) return `cue ${i} is out of order`;
    if (track.source && (track.source[i].start !== c.start || track.source[i].end !== c.end)) {
      return `cue ${i}'s original has other times`;
    }
  }
  return "";
}

// --- clock ---------------------------------------------------------------

eq("1.995 s to the hundredth", formatClock(1.995, 2), "0:02.00");
eq("1.995 s to the millisecond", formatClock(1.995), "0:01.995");
eq("0.9996 s rounds up whole", formatClock(0.9996), "0:01.000");
eq("75 s", formatClock(75), "1:15.000");
eq("past an hour", formatClock(3725.5), "1:02:05.500");
eq("seconds alone", parseClock("62.5"), 62.5);
eq("minutes and seconds", parseClock("1:02.5"), 62.5);
eq("an .srt time", parseClock("0:01:02,345"), 62.345);
eq("spaces around", parseClock(" 0:03 "), 3);
eq("not 60 seconds in a minute", parseClock("1:60"), null);
eq("not 60 minutes in an hour", parseClock("1:60:00"), null);
eq("not a time", parseClock("soon"), null);
eq("empty", parseClock(""), null);
eq("no negatives", parseClock("-1"), null);

// --- times ---------------------------------------------------------------

{
  const t = bilingual();
  const r = setTimes(t, 1, { start: 3.2, end: 6.2 }, 10);
  ok("a valid move is taken", r.ok);
  eq("both edges moved", [r.track.cues[1].start, r.track.cues[1].end], [3.2, 6.2]);
  eq("the original moves with it", [r.track.source[1].start, r.track.source[1].end], [3.2, 6.2]);
  eq("the input track is untouched", t.cues[1].start, 3.5);
  ok("still sound", !sound(r.track), sound(r.track));
  eq("start after end is refused", setTimes(t, 1, { start: 6 }, 10).error, "The start must be before the end.");
  const before = setTimes(t, 1, { start: 2.9 }, 10);
  eq("overlapping the cue before", before.error, "That overlaps the subtitle before, which ends at {time}.");
  eq("says where it ends", before.params, { time: "0:03.000" });
  eq("overlapping the cue after", setTimes(t, 1, { end: 6.6 }, 10).error, "That overlaps the subtitle after, which starts at {time}.");
  ok("touching the neighbour is fine", setTimes(t, 1, { start: 3, end: 6.5 }, 10).ok);
  eq("past the end of the video", setTimes(t, 2, { end: 12 }, 10).error, "The video ends at {time}.");
  ok("no video, no cap", setTimes(t, 2, { end: 12 }, 0).ok);
  eq("before zero", setTimes(t, 0, { start: -1 }, 10).error, "A time cannot be before the start of the video.");
  eq("kept to the millisecond", setTimes(t, 0, { end: 2.12345 }, 10).track.cues[0].end, 2.123);
}
{
  // An imported file whose cues already overlap: moving the start of the
  // second must not be refused over an end nobody touched.
  const t = { cues: [{ start: 0, end: 3, lines: ["a"] }, { start: 2, end: 5, lines: ["b"] }], source: null, loudness: [] };
  ok("only the moved edge is held to its neighbour", setTimes(t, 0, { start: 0.5 }, 0).ok);
  ok("and the end still is", !setTimes(t, 0, { end: 3.5 }, 0).ok);
}

// --- delete --------------------------------------------------------------

{
  const t = bilingual();
  const r = removeCue(t, 1);
  eq("one fewer", r.track.cues.length, 2);
  eq("the original goes with it", r.track.source.map((c) => c.lines[0]), ["This is a sample video", "Pick a style"]);
  eq("and its loudness", r.track.loudness.map((l) => l.length), [5, 3]);
  eq("the next cue is selected", r.select, 1);
  eq("deleting the last selects the one before", removeCue(t, 2).select, 1);
  eq("deleting the only cue selects none", removeCue({ cues: [t.cues[0]], source: null, loudness: [] }, 0).select, null);
  ok("sound", !sound(r.track), sound(r.track));
}

// --- add -----------------------------------------------------------------

{
  const t = bilingual();
  const r = insertCue(t, 3.1, 10);
  ok("added in the gap", r.ok);
  eq("at that moment, up to the next cue", [r.track.cues[1].start, r.track.cues[1].end], [3.1, 3.5]);
  eq("empty", r.track.cues[1].lines, [""]);
  eq("with an empty original", r.track.source[1].lines, [""]);
  eq("and no loudness", r.track.loudness[1], []);
  eq("selected", r.select, 1);
  ok("sound", !sound(r.track), sound(r.track));
  eq("over a cue is refused", insertCue(t, 1, 10).error, "A subtitle is already showing at this moment.");
  eq("where it is too tight", insertCue(t, 3.45, 10).error, "There is no room here for another subtitle.");
  const tail = insertCue(t, 9, 10);
  eq("after the last cue, to the end of the video", [tail.track.cues[3].start, tail.track.cues[3].end], [9, 10]);
  eq("two seconds when there is room", insertCue(t, 9, 0).track.cues[3].end, 11);
  eq("before the first", insertCue({ cues: [{ start: 5, end: 6, lines: ["x"] }], source: null, loudness: [] }, 1, 0).track.cues.map((c) => c.start), [1, 5]);
  const after = insertAfter(t, 0, 10);
  eq("after a cue starts where it ends", after.track.cues[1].start, 3);
  eq("into an empty list", insertCue({ cues: [], source: null, loudness: [] }, 0, 5).track.cues, [{ start: 0, end: 2, lines: [""] }]);
}

// --- split ---------------------------------------------------------------

{
  const t = plain();
  const r = splitCue(t, 0, { kind: "text", field: "cue", offset: "one two".length });
  ok("split at the cursor", r.ok);
  eq("the text breaks at the cursor", r.track.cues.slice(0, 2).map((c) => c.lines), [["one two"], ["three four"]]);
  const mid = r.track.cues[0].end;
  ok("the time breaks in the same proportion", Math.abs(mid - 2 * (7 / 17)) < 0.002, String(mid));
  eq("the second half starts where the first ends", r.track.cues[1].start, mid);
  eq("the loudness breaks after the same words", r.track.loudness.slice(0, 2).map((l) => l.length), [2, 2]);
  ok("nothing to check without a translation", !r.track.cues[0].check && !r.track.cues[1].check);
  eq("the second half is selected", r.select, 1);
  ok("sound", !sound(r.track), sound(r.track));
  eq("a cursor at the very start", splitCue(t, 0, { kind: "text", field: "cue", offset: 0 }).error, "Put the cursor where the subtitle should break.");
  eq("a cursor at the very end", splitCue(t, 0, { kind: "text", field: "cue", offset: 99 }).error, "Put the cursor where the subtitle should break.");
}
{
  const t = plain();
  const r = splitCue(t, 0, { kind: "time", time: 1 });
  ok("split at the playhead", r.ok);
  eq("at that moment", r.track.cues[0].end, 1);
  eq("the words split at the nearest space", r.track.cues.slice(0, 2).map((c) => c.lines[0]), ["one two", "three four"]);
  eq("outside the cue is refused", splitCue(t, 0, { kind: "time", time: 2.2 }).error, "Move the playhead inside this subtitle to split it there.");
  eq("too short", splitCue({ cues: [{ start: 0, end: 0.15, lines: ["a b"] }], source: null, loudness: [] }, 0, { kind: "time", time: 0.07 }).error, "This subtitle is too short to split.");
  const one = splitCue({ cues: [{ start: 0, end: 2, lines: ["word"] }], source: null, loudness: [] }, 0, { kind: "time", time: 1 });
  eq("one word stays with the first half", one.track.cues.map((c) => c.lines), [["word"], [""]]);
  const edge = splitCue(t, 0, { kind: "time", time: 0.01 });
  ok("never a half shorter than the minimum", edge.track.cues[0].end - edge.track.cues[0].start >= 0.0999, String(edge.track.cues[0].end));
}
{
  // The bilingual case the plan names: the original cut at the cursor, the
  // translation by proportion, both halves marked.
  const t = bilingual();
  const r = splitCue(t, 0, { kind: "text", field: "source", offset: "This is a".length });
  ok("bilingual split", r.ok);
  eq("the original breaks at the cursor", r.track.source.slice(0, 2).map((c) => c.lines[0]), ["This is a", "sample video"]);
  // 9 of the original's 21 characters, so 3 of the translation's 8.
  eq("the translation breaks by proportion", r.track.cues.slice(0, 2).map((c) => c.lines[0]), ["这是一", "个示例视频"]);
  ok("both halves are marked to check", r.track.cues[0].check === true && r.track.cues[1].check === true);
  eq("the loudness follows the original's words", r.track.loudness.slice(0, 2).map((l) => l.length), [3, 2]);
  eq("one original per cue", r.track.source.length, r.track.cues.length);
  ok("sound", !sound(r.track), sound(r.track));
  const c = splitCue(t, 0, { kind: "text", field: "cue", offset: 4 });
  eq("a cursor in the translation cuts it there", c.track.cues.slice(0, 2).map((x) => x.lines[0]), ["这是一个", "示例视频"]);
  eq("and the original near the same point", c.track.source.slice(0, 2).map((x) => x.lines[0]), ["This is a", "sample video"]);
  ok("marked too", c.track.cues[0].check && c.track.cues[1].check);
  eq("the loudness still follows the original", c.track.loudness.slice(0, 2).map((l) => l.length), [3, 2]);
}
{
  eq("no space: at the character", breakNear("这是一个示例视频", 0.5), 4);
  eq("never inside a surrogate pair", breakNear("示😀例", 0.5), 3);
  eq("a single word elsewhere is not cut", breakNear("Untertitel", 0.5), -1);
  eq("a space nearest the point", breakNear("aa bbbbbbbbb cc", 0.8), 12);
  const t = { cues: [{ start: 0, end: 4, lines: ["first line", "second line"] }], source: null, loudness: [] };
  const r = splitCue(t, 0, { kind: "text", field: "cue", offset: "first line\n".length });
  eq("a two-line cue splits between its lines", r.track.cues.map((c) => c.lines), [["first line"], ["second line"]]);
}

// --- merge ---------------------------------------------------------------

{
  const t = bilingual();
  const r = mergeWithNext(t, 0);
  eq("one fewer", r.track.cues.length, 2);
  eq("from the first's start to the second's end", [r.track.cues[0].start, r.track.cues[0].end], [0, 6]);
  eq("the lines of both", r.track.cues[0].lines, ["这是一个示例视频", "没有上传任何东西"]);
  eq("the originals of both", r.track.source[0].lines, ["This is a sample video", "Nothing was uploaded"]);
  eq("the loudness of both, in order", r.track.loudness[0].length, 8);
  ok("sound", !sound(r.track), sound(r.track));
  eq("the last cue has nothing to merge with", mergeWithNext(t, 2).error, "There is no subtitle after this one to merge with.");
  const split = splitCue(t, 1, { kind: "text", field: "source", offset: "Nothing was".length }).track;
  const back = mergeWithNext(split, 1).track;
  eq("a split and a merge give back the original's text", back.source[1].lines, ["Nothing was", "uploaded"]);
  eq("and the loudness", back.loudness[1], t.loudness[1]);
  ok("a merged half stays marked", back.cues[1].check === true);
}

// --- text ----------------------------------------------------------------

{
  const t = bilingual();
  const marked = splitCue(t, 0, { kind: "time", time: 1.5 }).track;
  const r = setText(marked, 0, "cue", "改过\n两行");
  eq("new text, by line", r.track.cues[0].lines, ["改过", "两行"]);
  ok("editing clears the mark", !r.track.cues[0].check);
  ok("but not the other half's", r.track.cues[1].check === true);
  const o = setText(marked, 1, "source", "edited original");
  eq("the original is edited in its own list", o.track.source[1].lines, ["edited original"]);
  eq("and the translation is left alone", o.track.cues[1].lines, marked.cues[1].lines);
  ok("clearing the mark alone", !clearCheck(marked, 1).track.cues[1].check);
  eq("loudness untouched by typing", r.track.loudness, marked.loudness);
}
{
  const cues = [
    { start: 0, end: 1, lines: ["a", " "] },
    { start: 1, end: 2, lines: [""] },
    { start: 2, end: 3, lines: ["b"], check: true },
  ];
  eq("empty lines and empty cues stay out of a text export", exportable(cues), [
    { start: 0, end: 1, lines: ["a"] },
    { start: 2, end: 3, lines: ["b"] },
  ]);
}

// --- undo ----------------------------------------------------------------

{
  const h = new History();
  let t = bilingual();
  ok("nothing to undo at first", !h.canUndo && !h.canRedo);
  const step = (edit, key) => { h.record(t, key ?? null); t = edit.track; };
  step(removeCue(t, 0));
  step(setText(t, 0, "cue", "a"), "text:0:cue");
  step(setText(t, 0, "cue", "ab"), "text:0:cue");
  step(setText(t, 0, "cue", "abc"), "text:0:cue");
  step(setText(t, 1, "cue", "z"), "text:1:cue");
  let u = h.undo(t);
  eq("typing in another cue is its own step", u.cues[1].lines, ["选一个样式"]);
  eq("and the first cue's typing is still there", u.cues[0].lines, ["abc"]);
  u = h.undo(u);
  eq("a run of typing is one step", u.cues[0].lines, ["没有上传任何东西"]);
  u = h.undo(u);
  eq("then the delete", u.cues.length, 3);
  eq("with its original", u.source.length, 3);
  eq("and its loudness", u.loudness.length, 3);
  ok("nothing further", h.undo(u) === null);
  const r = h.redo(u);
  eq("redo", r.cues.length, 2);
  h.record(r, null);
  ok("a new edit after an undo drops the redo", !h.canRedo);
  h.clear();
  ok("cleared", !h.canUndo && !h.canRedo);
  const h2 = new History();
  h2.record(t, "text:0:cue");
  h2.settle();
  h2.record(t, "text:0:cue");
  h2.undo(t);
  ok("settle ends a typing run", h2.canUndo);
  const h3 = new History(3);
  for (let k = 0; k < 5; k++) h3.record(t);
  let n = 0;
  while (h3.undo(t)) n += 1;
  eq("the history is bounded", n, 3);
  const before = bilingual();
  const h4 = new History();
  h4.record(before);
  before.cues[0].lines[0] = "changed afterwards";
  eq("a snapshot is a copy", h4.undo(before).cues[0].lines[0], "这是一个示例视频");
}

// --- at the playhead ----------------------------------------------------
//
// The buttons take the time from wherever the video is paused. Refused, they
// say where that is and what it is against, rather than the typed-time words
// that read as a fault when the video sat far from the selected subtitle.

{
  // Paused at 0:19 with the selected subtitle at 0:59.733-1:05.533 and the
  // one above it ending at 0:59.667.
  const t = {
    cues: [
      { start: 10, end: 15, lines: ["a"] },
      { start: 55, end: 59.667, lines: ["b"] },
      { start: 59.733, end: 65.533, lines: ["c"] },
      { start: 70, end: 75, lines: ["d"] },
    ],
    source: null,
    loudness: [],
  };
  const start = timeAtPlayhead(t, 2, "start", 19, 90);
  eq("start: before the subtitle above ends", start.error, "The video is at {now}, before the subtitle above ends ({time}).");
  eq("start: says where the video is and the end above", start.params, { now: "0:19.000", time: "0:59.667" });
  const end = timeAtPlayhead(t, 2, "end", 19, 90);
  eq("end: before this subtitle starts", end.error, "The video is at {now}, before this subtitle starts ({time}).");
  eq("end: says this subtitle's start", end.params, { now: "0:19.000", time: "0:59.733" });
  const late = timeAtPlayhead(t, 2, "start", 68, 90);
  eq("start: after this subtitle ends", late.error, "The video is at {now}, after this subtitle ends ({time}).");
  eq("start late: says this subtitle's end", late.params, { now: "1:08.000", time: "1:05.533" });
  const over = timeAtPlayhead(t, 2, "end", 72.25, 90);
  eq("end: after the subtitle below starts", over.error, "The video is at {now}, after the subtitle below starts ({time}).");
  eq("end over: says the start below", over.params, { now: "1:12.250", time: "1:10.000" });
  const first = timeAtPlayhead(t, 0, "start", 16, 90);
  eq("the first subtitle has nothing above", first.error, "The video is at {now}, after this subtitle ends ({time}).");
  ok("a playhead inside the gap is taken", timeAtPlayhead(t, 2, "start", 60, 90).ok);
  eq("and moves the start", timeAtPlayhead(t, 2, "start", 60, 90).track.cues[2].start, 60);
  ok("an end within reach is taken", timeAtPlayhead(t, 2, "end", 68, 90).ok);
  eq("a gone subtitle keeps the plain refusal", timeAtPlayhead(t, 9, "start", 19, 90).error, "That subtitle is no longer there.");

  const split = splitAtPlayhead(t, 2, 19);
  eq("split: outside this subtitle", split.error, "The video is at {now}, outside this subtitle ({start}–{end}), so it cannot be split there.");
  eq("split: says both edges", split.params, { now: "0:19.000", start: "0:59.733", end: "1:05.533" });
  ok("split inside is taken", splitAtPlayhead(t, 2, 62).ok);
  eq("split inside makes two", splitAtPlayhead(t, 2, 62).track.cues.length, 5);

  const showing = insertAtPlayhead(t, 12, 90);
  eq("add: a subtitle is showing", showing.error, "The video is at {now}, where a subtitle is already showing ({start}–{end}). Select a subtitle and use “Add after” instead.");
  eq("add: says which one", showing.params, { now: "0:12.000", start: "0:10.000", end: "0:15.000" });
  const tight = insertAtPlayhead(t, 59.68, 90);
  eq("add: too close to the next", tight.error, "The video is at {now}, too close to the next subtitle ({time}) to add one. Select a subtitle and use “Add after” instead.");
  eq("add: says when the next starts", tight.params, { now: "0:59.680", time: "0:59.733" });
  const end90 = insertAtPlayhead(t, 89.95, 90);
  eq("add: too close to the end", end90.error, "The video is at {now}, too close to its end to add a subtitle.");
  ok("add in a gap is taken", insertAtPlayhead(t, 20, 90).ok);

  const packed = insertAfter(t, 1, 90);
  eq("add after: no gap before the next", packed.error, "There is no gap after this subtitle: the next one starts at {time}. Make this one end earlier first.");
  eq("add after: says when", packed.params, { time: "0:59.733" });
  const lastOne = insertAfter({ ...t, cues: [...t.cues.slice(0, 3), { start: 70, end: 89.95, lines: ["d"] }] }, 3, 90);
  eq("add after: no room before the video ends", lastOne.error, "There is no room after this subtitle before the video ends ({time}).");
  ok("add after with room is taken", insertAfter(t, 0, 90).ok);
}

// --- many edits in a row -------------------------------------------------

{
  // A thousand random edits on a translated, measured track. After each,
  // every list is still one per cue, every cue starts before it ends and in
  // order, and each original's word count matches its loudness -- the
  // thing that, when it slips, switches sizing off without a word.
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  let t = bilingual();
  let broken = "";
  let applied = 0;
  for (let k = 0; k < 1000 && !broken; k++) {
    const n = t.cues.length;
    const i = Math.floor(rnd() * Math.max(1, n));
    const c = t.cues[i];
    let e;
    switch (Math.floor(rnd() * 6)) {
      case 0: e = n ? setTimes(t, i, { start: c.start + (rnd() - 0.5) }, 20) : null; break;
      case 1: e = n > 1 ? removeCue(t, i) : null; break;
      case 2: e = insertCue(t, rnd() * 20, 20); break;
      case 3: e = n ? splitCue(t, i, rnd() < 0.5
        ? { kind: "time", time: c.start + rnd() * (c.end - c.start) }
        : { kind: "text", field: rnd() < 0.5 ? "source" : "cue", offset: Math.floor(rnd() * 20) }) : null; break;
      case 4: e = n > 1 ? mergeWithNext(t, Math.min(i, n - 2)) : null; break;
      default: e = n ? setTimes(t, i, { end: c.end + (rnd() - 0.5) }, 20) : null;
    }
    if (!e || !e.ok) continue;
    t = e.track;
    applied += 1;
    broken = sound(t);
    if (!broken) {
      const off = t.source.findIndex((s, j) => words(s.lines) !== t.loudness[j].length);
      if (off !== -1) broken = `cue ${off}: ${words(t.source[off].lines)} words, ${t.loudness[off].length} levels`;
    }
  }
  ok("a thousand edits keep every list in step", !broken, broken);
  ok("and most of them were real edits", applied > 300, String(applied));
}

console.log(`${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
