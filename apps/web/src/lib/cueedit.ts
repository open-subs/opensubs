// Editing the subtitle list: times, delete, add, split, merge, and undo.
//
// Three lists are indexed by cue, and each feature that reads one quietly
// switches itself off when its list stops lining up with the cues:
//
// - `cues`, what the list shows and the exports write -- the translation,
//   once there is one;
// - `source`, the original a translation was made from. Showing or burning
//   both languages needs one original per cue (`canShowBoth` compares the
//   lengths), so a cue deleted from one list and not the other turns a
//   bilingual video back into a single-language one without a word;
// - `loudness`, one level per word of the original, which sizing by
//   loudness needs per cue.
//
// So nothing here edits one of them alone. Every operation takes all three
// and returns all three, and the tests hold them to the same length.
//
// None of this needs the engine, so it runs, and is tested, in plain Node.

import type { Cue } from "./engine";

/** A cue in the list. `check` marks one whose translation was divided by
 *  proportion when it was split, for a person to look at. */
export interface EditCue extends Cue {
  check?: boolean;
}

export interface Track {
  cues: EditCue[];
  /** The original of a translation, one per cue; null when there is none. */
  source: Cue[] | null;
  /** Per-word loudness of the original, one list per cue; [] when unmeasured. */
  loudness: number[][];
}

/** An edit either produces a new track or says, as a translation key, why not. */
export type Edit =
  | { ok: true; track: Track; select: number | null }
  | { ok: false; error: string; params?: Record<string, string> };

/** The shortest cue a split or an addition will make, in seconds. */
export const MIN_CUE = 0.1;
/** How long a newly added cue lasts when there is room for it. */
export const NEW_CUE = 2;
/** Times are kept to the millisecond, which is what .srt and .vtt carry. */
const EPS = 0.0005;

const ms = (x: number) => Math.round(x * 1000) / 1000;
const fail = (error: string, params?: Record<string, string>): Edit => ({ ok: false, error, params });

/** The source and the loudness only travel with the cues while they line up. */
function lanes(track: Track) {
  return {
    source: track.source && track.source.length === track.cues.length ? track.source : null,
    levels: track.loudness.length === track.cues.length && track.cues.length > 0,
  };
}

function copy(track: Track): Track {
  return {
    cues: track.cues.map((c) => ({ ...c, lines: [...c.lines] })),
    source: track.source ? track.source.map((c) => ({ ...c, lines: [...c.lines] })) : null,
    loudness: track.loudness.map((l) => [...l]),
  };
}

// --- clock ----------------------------------------------------------------

/**
 * `m:ss.fff`, or `h:mm:ss.fff` past an hour.
 *
 * Rounded once, to the whole unit, before it is taken apart. Rounding the
 * fraction on its own is what showed 1.995 s as "0:01.100": the seconds
 * came from the floor and the hundredths had already rounded up to 100.
 */
export function formatClock(seconds: number, digits = 3): string {
  const scale = 10 ** digits;
  const units = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * scale);
  const frac = units % scale;
  const whole = (units - frac) / scale;
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const head = h > 0 ? `${h}:${String(m).padStart(2, "0")}` : String(m);
  const tail = digits > 0 ? `.${String(frac).padStart(digits, "0")}` : "";
  return `${head}:${String(s).padStart(2, "0")}${tail}`;
}

/**
 * Seconds from what someone typed: `62.5`, `1:02.5`, `0:01:02,345` (the
 * comma is how .srt writes it). Null when it is not a time.
 */
export function parseClock(text: string): number | null {
  const s = text.trim().replace(",", ".");
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) return null;
  const parts = s.split(":");
  const sec = Number(parts.pop());
  const min = parts.length ? Number(parts.pop()) : 0;
  const hr = parts.length ? Number(parts.pop()) : 0;
  const hasMin = s.includes(":");
  if (hasMin && sec >= 60) return null;
  if (s.split(":").length === 3 && min >= 60) return null;
  return ms(hr * 3600 + min * 60 + sec);
}

// --- times ----------------------------------------------------------------

/**
 * Move one cue's start, end, or both.
 *
 * Only the edge that moved is held against its neighbour. Imported files
 * often overlap already; refusing to change a start because the untouched
 * end overlaps the next cue would make such a file uneditable.
 * `duration` is 0 when no video is loaded, and then nothing caps the end.
 */
export function setTimes(
  track: Track,
  i: number,
  change: { start?: number; end?: number },
  duration: number,
): Edit {
  const cue = track.cues[i];
  if (!cue) return fail("That subtitle is no longer there.");
  const start = ms(change.start ?? cue.start);
  const end = ms(change.end ?? cue.end);
  if (start < 0) return fail("A time cannot be before the start of the video.");
  if (start >= end - EPS) return fail("The start must be before the end.");
  const prev = track.cues[i - 1];
  const next = track.cues[i + 1];
  if (change.start !== undefined && prev && start < prev.end - EPS) {
    return fail("That overlaps the subtitle before, which ends at {time}.", { time: formatClock(prev.end) });
  }
  if (change.end !== undefined && next && end > next.start + EPS) {
    return fail("That overlaps the subtitle after, which starts at {time}.", { time: formatClock(next.start) });
  }
  if (change.end !== undefined && duration > 0 && end > duration + EPS) {
    return fail("The video ends at {time}.", { time: formatClock(duration) });
  }
  const out = copy(track);
  const { source } = lanes(track);
  out.cues[i] = { ...out.cues[i], start, end };
  if (source && out.source) out.source[i] = { ...out.source[i], start, end };
  return { ok: true, track: out, select: i };
}

// --- delete ---------------------------------------------------------------

export function removeCue(track: Track, i: number): Edit {
  if (!track.cues[i]) return fail("That subtitle is no longer there.");
  const { source, levels } = lanes(track);
  const out = copy(track);
  out.cues.splice(i, 1);
  if (source && out.source) out.source.splice(i, 1);
  if (levels) out.loudness.splice(i, 1);
  const n = out.cues.length;
  return { ok: true, track: out, select: n === 0 ? null : Math.min(i, n - 1) };
}

// --- add ------------------------------------------------------------------

/**
 * A new, empty cue starting at `at`: two seconds long, or up to the next
 * cue or the end of the video if either comes sooner. Not over a cue that
 * is already showing at that moment.
 */
export function insertCue(track: Track, at: number, duration: number): Edit {
  const start = ms(Math.max(0, at));
  if (track.cues.some((c) => start > c.start - EPS && start < c.end - EPS)) {
    return fail("A subtitle is already showing at this moment.");
  }
  const k = track.cues.findIndex((c) => c.start > start - EPS);
  const index = k === -1 ? track.cues.length : k;
  const limit = Math.min(
    k === -1 ? Infinity : track.cues[k].start,
    duration > 0 ? duration : Infinity,
  );
  const end = ms(Math.min(start + NEW_CUE, limit));
  if (end - start < MIN_CUE - EPS) return fail("There is no room here for another subtitle.");
  const { source, levels } = lanes(track);
  const out = copy(track);
  out.cues.splice(index, 0, { start, end, lines: [""] });
  if (source && out.source) out.source.splice(index, 0, { start, end, lines: [""] });
  // An empty cue has no words, so its loudness is an empty list: still one
  // per cue, so sizing by loudness carries on for all the others.
  if (levels) out.loudness.splice(index, 0, []);
  return { ok: true, track: out, select: index };
}

/** A new cue straight after cue `i`. */
export function insertAfter(track: Track, i: number, duration: number): Edit {
  const cue = track.cues[i];
  if (!cue) return fail("That subtitle is no longer there.");
  const edit = insertCue(track, cue.end, duration);
  if (edit.ok || edit.error !== "There is no room here for another subtitle.") return edit;
  // Transcribed cues often run straight into each other, so "no room" here
  // usually means the next one starts where this one ends: say which, and
  // what to change, rather than leave it looking like a broken button.
  const next = track.cues.find((c) => c.start > cue.end - EPS);
  if (next && next.start - cue.end < MIN_CUE - EPS) {
    return fail("There is no gap after this subtitle: the next one starts at {time}. Make this one end earlier first.", {
      time: formatClock(next.start),
    });
  }
  return fail("There is no room after this subtitle before the video ends ({time}).", { time: formatClock(duration) });
}

// --- at the playhead ------------------------------------------------------
//
// The playhead buttons take the time from wherever the video happens to be
// paused, which is often nowhere near the subtitle being edited. Refused
// with the same words as a typed time, the cause was invisible -- "That
// overlaps the subtitle before" when the video sat 40 seconds earlier read
// as a fault. So each refusal says where the video is, and against what.

/** A cue's start or end set to the playhead. */
export function timeAtPlayhead(
  track: Track,
  i: number,
  edge: "start" | "end",
  now: number,
  duration: number,
): Edit {
  const edit = setTimes(track, i, { [edge]: now }, duration);
  const cue = track.cues[i];
  if (edit.ok || !cue) return edit;
  const at = ms(now);
  const p = (time: number) => ({ now: formatClock(at), time: formatClock(time) });
  if (edge === "start") {
    if (at >= cue.end - EPS) return fail("The video is at {now}, after this subtitle ends ({time}).", p(cue.end));
    const prev = track.cues[i - 1];
    if (prev && at < prev.end - EPS) {
      return fail("The video is at {now}, before the subtitle above ends ({time}).", p(prev.end));
    }
  } else {
    if (at <= cue.start + EPS) return fail("The video is at {now}, before this subtitle starts ({time}).", p(cue.start));
    const next = track.cues[i + 1];
    if (next && at > next.start + EPS) {
      return fail("The video is at {now}, after the subtitle below starts ({time}).", p(next.start));
    }
  }
  return edit;
}

/** A new cue at the playhead; when there is no room, where else to add one. */
export function insertAtPlayhead(track: Track, now: number, duration: number): Edit {
  const edit = insertCue(track, now, duration);
  if (edit.ok) return edit;
  const at = ms(Math.max(0, now));
  const clock = formatClock(at);
  const showing = track.cues.find((c) => at > c.start - EPS && at < c.end - EPS);
  if (showing) {
    return fail(
      "The video is at {now}, where a subtitle is already showing ({start}–{end}). Select a subtitle and use “Add after” instead.",
      { now: clock, start: formatClock(showing.start), end: formatClock(showing.end) },
    );
  }
  const next = track.cues.find((c) => c.start > at - EPS);
  if (next && next.start - at < MIN_CUE - EPS) {
    return fail(
      "The video is at {now}, too close to the next subtitle ({time}) to add one. Select a subtitle and use “Add after” instead.",
      { now: clock, time: formatClock(next.start) },
    );
  }
  return fail("The video is at {now}, too close to its end to add a subtitle.", { now: clock });
}

/** Cue `i` split at the playhead, or why the playhead is not inside it. */
export function splitAtPlayhead(track: Track, i: number, now: number): Edit {
  const cue = track.cues[i];
  if (cue && !(now > cue.start + EPS && now < cue.end - EPS)) {
    return fail("The video is at {now}, outside this subtitle ({start}–{end}), so it cannot be split there.", {
      now: formatClock(ms(Math.max(0, now))),
      start: formatClock(cue.start),
      end: formatClock(cue.end),
    });
  }
  return splitCue(track, i, { kind: "time", time: now });
}

// --- split ----------------------------------------------------------------

const textOf = (c: Cue) => c.lines.join("\n");
const linesOf = (text: string) => {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.length ? lines : [""];
};
const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

/** Text cut at `at`, the space around the cut dropped; null if a side is empty. */
function cut(text: string, at: number): [string, string] | null {
  const a = text.slice(0, at).replace(/\s+$/, "");
  const b = text.slice(at).replace(/^\s+/, "");
  return a.trim() && b.trim() ? [a, b] : null;
}

/**
 * Where to cut a text that nobody pointed at, `fraction` of the way in, or
 * -1 for nowhere.
 *
 * At the space nearest that point when the text has spaces, so no word is
 * broken. Chinese, Japanese and Thai are written without them, so there it
 * is that character -- never between the two halves of a surrogate pair.
 * A single word in any other script is not cut at all.
 */
export function breakNear(text: string, fraction: number): number {
  const target = fraction * text.length;
  const spaces = [...text.matchAll(/\s+/g)].map((m) => m.index!);
  if (spaces.length) {
    return spaces.reduce((best, p) => (Math.abs(p - target) < Math.abs(best - target) ? p : best));
  }
  if (text.length < 2 || !UNSPACED.test(text)) return -1;
  let at = Math.min(text.length - 1, Math.max(1, Math.round(target)));
  const code = text.charCodeAt(at - 1);
  if (code >= 0xd800 && code <= 0xdbff) at += 1;
  return at;
}

/** Kana, Han and Thai: scripts that do not put spaces between words. */
const UNSPACED = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff\u0e00-\u0e7f]/;

/** Cut text proportionally; a text with nothing to cut stays whole on the left. */
function cutNear(text: string, fraction: number): [string, string] {
  const at = breakNear(text, fraction);
  return (at > 0 && cut(text, at)) || [text, ""];
}

export type SplitAt =
  /** At a cursor in the cue's text (`cue`) or in its original (`source`). */
  | { kind: "text"; field: "cue" | "source"; offset: number }
  /** At a moment, normally the playhead. */
  | { kind: "time"; time: number };

/**
 * Cut cue `i` in two.
 *
 * The text with the cursor in it is cut exactly there, and the time is cut
 * in the same proportion. A translation's other language cannot be cut
 * exactly -- nothing says which of its words go with which -- so it is cut
 * in proportion, at the nearest space, and both halves are marked to be
 * checked. A cut at a moment cuts every text in proportion.
 *
 * The loudness follows the original's words, split where the original was.
 */
export function splitCue(track: Track, i: number, at: SplitAt): Edit {
  const cue = track.cues[i];
  if (!cue) return fail("That subtitle is no longer there.");
  if (cue.end - cue.start < 2 * MIN_CUE - EPS) return fail("This subtitle is too short to split.");
  const { source, levels } = lanes(track);
  const original = source ? source[i] : null;

  let fraction: number;
  let cueParts: [string, string];
  let sourceParts: [string, string] | null = null;
  if (at.kind === "text") {
    const field = at.field === "source" && original ? "source" : "cue";
    const exact = field === "source" ? textOf(original!) : textOf(cue);
    const parts = cut(exact, Math.max(0, Math.min(exact.length, at.offset)));
    if (!parts) return fail("Put the cursor where the subtitle should break.");
    fraction = parts[0].length / (parts[0].length + parts[1].length);
    if (field === "source") {
      sourceParts = parts;
      cueParts = cutNear(textOf(cue), fraction);
    } else {
      cueParts = parts;
      if (original) sourceParts = cutNear(textOf(original), fraction);
    }
  } else {
    if (!(at.time > cue.start + EPS && at.time < cue.end - EPS)) {
      return fail("Move the playhead inside this subtitle to split it there.");
    }
    fraction = (at.time - cue.start) / (cue.end - cue.start);
    cueParts = cutNear(textOf(cue), fraction);
    if (original) sourceParts = cutNear(textOf(original), fraction);
  }

  const raw = at.kind === "time" ? at.time : cue.start + fraction * (cue.end - cue.start);
  const mid = ms(Math.min(cue.end - MIN_CUE, Math.max(cue.start + MIN_CUE, raw)));
  const check = original ? { check: true } : {};
  const first: EditCue = { start: cue.start, end: mid, lines: linesOf(cueParts[0]), ...check };
  const second: EditCue = { start: mid, end: cue.end, lines: linesOf(cueParts[1]), ...check };

  const out = copy(track);
  out.cues.splice(i, 1, first, second);
  if (original && out.source && sourceParts) {
    out.source.splice(
      i,
      1,
      { start: cue.start, end: mid, lines: linesOf(sourceParts[0]) },
      { start: mid, end: cue.end, lines: linesOf(sourceParts[1]) },
    );
  }
  if (levels) {
    const words = original ? textOf(original) : textOf(cue);
    const firstWords = wordCount((original ? sourceParts! : cueParts)[0]);
    const list = track.loudness[i];
    const total = wordCount(words);
    // Measured per word, so a cut after n words is a cut after n levels. If
    // the text was edited since and no longer counts the same, the share is
    // kept proportional; sizing skips such a cue either way.
    const n = list.length === total ? firstWords : Math.round((list.length * firstWords) / Math.max(1, total));
    out.loudness.splice(i, 1, list.slice(0, n), list.slice(n));
  }
  return { ok: true, track: out, select: i + 1 };
}

// --- merge ----------------------------------------------------------------

/** Join cue `i` and the one after it into one, from the first's start to the second's end. */
export function mergeWithNext(track: Track, i: number): Edit {
  const a = track.cues[i];
  const b = track.cues[i + 1];
  if (!a || !b) return fail("There is no subtitle after this one to merge with.");
  const { source, levels } = lanes(track);
  const join = (x: Cue, y: Cue) => linesOf([...x.lines, ...y.lines].join("\n"));
  const merged: EditCue = { start: a.start, end: b.end, lines: join(a, b) };
  if (a.check || b.check) merged.check = true;
  const out = copy(track);
  out.cues.splice(i, 2, merged);
  if (source && out.source) {
    out.source.splice(i, 2, { start: a.start, end: b.end, lines: join(source[i], source[i + 1]) });
  }
  if (levels) out.loudness.splice(i, 2, [...track.loudness[i], ...track.loudness[i + 1]]);
  return { ok: true, track: out, select: i };
}

// --- text -----------------------------------------------------------------

/** New text for a cue (`cue`) or its original (`source`). Clears the check mark. */
export function setText(track: Track, i: number, field: "cue" | "source", text: string): Edit {
  if (!track.cues[i]) return fail("That subtitle is no longer there.");
  const { source } = lanes(track);
  const out = copy(track);
  // Split on newlines so a two-line cue stays two lines; the engine's own
  // wrapping only runs when text comes from ASR or a translation.
  const lines = text.split("\n");
  const { check: _seen, ...rest } = out.cues[i];
  out.cues[i] = field === "cue" ? { ...rest, lines } : rest;
  if (field === "source") {
    if (!source || !out.source) return fail("That subtitle is no longer there.");
    out.source[i] = { ...out.source[i], lines };
  }
  return { ok: true, track: out, select: i };
}

/** The mark alone cleared: someone has looked and the halves are right. */
export function clearCheck(track: Track, i: number): Edit {
  if (!track.cues[i]) return fail("That subtitle is no longer there.");
  const out = copy(track);
  const { check: _seen, ...rest } = out.cues[i];
  out.cues[i] = rest;
  return { ok: true, track: out, select: i };
}

/** Text with nothing in it is left out of a text export rather than written as a broken block. */
export function exportable<T extends Cue>(cues: T[]): Cue[] {
  return cues
    .map((c) => ({ start: c.start, end: c.end, lines: c.lines.filter((l) => l.trim() !== "") }))
    .filter((c) => c.lines.length > 0);
}

// --- undo -----------------------------------------------------------------

/**
 * Undo and redo for the list.
 *
 * Snapshots of the whole track, because every edit can touch all three
 * lists and an undo must put back all three. Typing into one cue is one
 * step however many keys it took; `key` names the run, and a different key,
 * or any other edit, starts the next step.
 */
export class History {
  private past: Track[] = [];
  private future: Track[] = [];
  private run: string | null = null;
  private readonly limit: number;

  constructor(limit = 200) {
    this.limit = limit;
  }

  /** Call with the track as it was *before* an edit. */
  record(before: Track, key: string | null = null) {
    if (key !== null && key === this.run) return;
    this.past.push(copy(before));
    if (this.past.length > this.limit) this.past.shift();
    this.future = [];
    this.run = key;
  }

  undo(current: Track): Track | null {
    const prev = this.past.pop();
    if (!prev) return null;
    this.future.push(copy(current));
    this.run = null;
    return prev;
  }

  redo(current: Track): Track | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(copy(current));
    this.run = null;
    return next;
  }

  /** Forget everything: the cues were replaced by a new transcription, a file or a translation. */
  clear() {
    this.past = [];
    this.future = [];
    this.run = null;
  }

  /** End a typing run, so the next keystroke is a step of its own. */
  settle() {
    this.run = null;
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }
}
