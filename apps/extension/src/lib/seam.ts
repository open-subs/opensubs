/**
 * Joining one window of transcription to the next.
 *
 * Live capture cuts the audio into windows, and a cut lands wherever the
 * clock says rather than between two sentences. Two consequences, both of
 * which show up as visible defects and neither of which the per-window
 * clean-up can see:
 *
 *  1. A sentence straddling the cut is transcribed twice -- once as the
 *     tail of window N and again as the head of window N+1 -- because the
 *     windows deliberately overlap, so that no word falls in the gap.
 *  2. The overlap means the *same* speech carries two sets of timings, and
 *     the second set is the better one: it has the whole sentence in front
 *     of it, where the first had it cut off.
 *
 * So the rule is: a new cue that repeats one already on screen replaces it
 * rather than being appended or dropped. Dropping keeps the truncated
 * version; appending shows the sentence twice.
 */

import type { Cue } from "./protocol";
import { OVERLAP_S } from "./capture.ts";

export { OVERLAP_S };

/** Two cues this far apart are two different sentences, whatever they say. */
const NEAR_S = OVERLAP_S + 2;

/** How much of the shorter line has to match for them to be the same line. */
const SAME = 0.7;

/** Lower-case letters and digits only -- punctuation and spacing move about. */
function bare(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/**
 * Longest common substring, as a fraction of the shorter string.
 *
 * A substring rather than a subsequence: "the cat sat" and "the mat sat"
 * share nine characters as a subsequence and only four contiguously, and
 * it is the contiguous run that tells you one line is a truncation of the
 * other rather than a different sentence with similar words.
 */
export function sameness(a: string, b: string): number {
  const x = bare(a);
  const y = bare(b);
  if (!x || !y) return 0;
  let best = 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i += 1) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j += 1) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best / Math.min(x.length, y.length);
}

/**
 * Fold a window's cues into the running transcript.
 *
 * `kept` is assumed sorted by start time; the result is too. Only the tail
 * is reconsidered -- a cue from a minute ago is settled, and rescanning the
 * whole transcript every window turns a linear job into a quadratic one on
 * exactly the long recordings where it would hurt.
 */
/**
 * A caption's words (or characters, for a script written without spaces),
 * each with the form used to compare it.
 */
function tokens(text: string): { raw: string; key: string }[] {
  const t = text.trim();
  const spaced = /\s/.test(t);
  return (spaced ? t.split(/\s+/) : [...t]).map((raw) => ({ raw, key: bare(raw) }));
}

/**
 * How many tokens end `a` and also begin `b`, comparing only the ones that
 * carry letters or digits -- a comma where the other reading had a full stop
 * is the same phrase.
 */
function tailIsHead(a: string, b: string): number {
  const x = tokens(a).filter((t) => t.key);
  const y = tokens(b).filter((t) => t.key);
  for (let k = Math.min(x.length, y.length); k > 0; k -= 1) {
    let same = true;
    for (let i = 0; i < k && same; i += 1) same = x[x.length - k + i].key === y[i].key;
    if (same) return k;
  }
  return 0;
}

/** `text` without its last `k` compared tokens, and any punctuation after them. */
function dropTail(text: string, k: number): string {
  const all = tokens(text);
  const spaced = /\s/.test(text.trim());
  let left = k;
  while (all.length && left > 0) {
    const t = all.pop()!;
    if (t.key) left -= 1;
  }
  while (all.length && !all[all.length - 1].key) all.pop();
  return all.map((t) => t.raw).join(spaced ? " " : "").trim();
}

/**
 * A phrase has to be at least this long to be recognised as heard twice.
 *
 * Two words, or four characters in a script without spaces: short enough to
 * catch "from the miners", long enough that "the" repeated across a seam is
 * not mistaken for one phrase.
 */
const MIN_REPEAT = { words: 2, characters: 4 };

/**
 * Settle the seam between a line and the one that follows it.
 *
 * The shape a seam takes once the windows really overlap: the *tail* of one
 * line is the *head* of the next. Whisper breaks sentences in different
 * places in the two windows, so neither line is a truncation of the other --
 * measured on a two-minute lecture, every seam came out as "...a complaint
 * from the miners" followed by "from the miners that squatting...". The later
 * reading heard the phrase as the start of its sentence, with what follows
 * it, so it keeps the phrase and the earlier line gives it up.
 *
 * Returns the earlier line as it should now stand, or null if nothing of it
 * is left.
 */
function settle(prev: Cue, next: Cue): Cue | null {
  if (!(next.start > prev.start && next.start < prev.end + 0.5)) return prev;
  const spaced = /\s/.test(prev.text.trim());
  const k = tailIsHead(prev.text, next.text);
  if (k >= (spaced ? MIN_REPEAT.words : MIN_REPEAT.characters)) {
    const left = dropTail(prev.text, k);
    return left ? { ...prev, text: left, end: Math.min(prev.end, next.start) } : null;
  }
  return prev;
}

export function stitch(kept: Cue[], incoming: Cue[]): Cue[] {
  const out = kept.slice();
  // Where this window's lines can reach back to. Everything before it is
  // settled, and only the tail is reconsidered -- a cue from a minute ago is
  // not going to change, and rescanning the whole transcript every window
  // turns a linear job into a quadratic one on exactly the long recordings
  // where it would hurt.
  const reach = Math.min(...incoming.map((c) => c.start)) - NEAR_S;

  for (const cue of incoming) {
    if (!cue.text.trim()) continue;
    let replaced = -1;
    for (let i = out.length - 1; i >= 0; i -= 1) {
      const old = out[i];
      if (cue.start - old.end > NEAR_S) break;
      if (Math.abs(old.start - cue.start) > NEAR_S) continue;
      if (sameness(old.text, cue.text) < SAME) continue;
      // The later reading saw more of the sentence; prefer it, but never
      // let it shrink the span already shown -- a line that jumps backwards
      // on screen reads as a glitch.
      out[i] = {
        start: Math.min(old.start, cue.start),
        end: Math.max(old.end, cue.end),
        text: cue.text.length >= old.text.length ? cue.text : old.text,
      };
      replaced = i;
      break;
    }
    if (replaced >= 0) {
      // A better reading of the last line can also repeat the end of the
      // line before it -- "...like the corners of pockets", then "like the
      // corners of pockets and the base of the fly." replacing "and the base
      // of the fly." So the seam behind the replaced line is settled too.
      if (replaced > 0) {
        const prev = settle(out[replaced - 1], out[replaced]);
        if (prev) out[replaced - 1] = prev;
        else out.splice(replaced - 1, 1);
      }
      continue;
    }
    const last = out[out.length - 1];
    if (last) {
      const prev = settle(last, cue);
      if (prev) out[out.length - 1] = prev;
      else out.pop();
    }
    out.push(cue);
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);

  // Two lines never share the screen, whichever path above produced them.
  // Where they would, the later one owns the time from its own start: a
  // reading that began there has the better claim to what follows.
  for (let i = 1; i < out.length; i += 1) {
    if (out[i].end < reach) continue;
    if (out[i].start >= out[i - 1].end) continue;
    if (out[i].start - out[i - 1].start >= MIN_READ_S) {
      out[i - 1] = { ...out[i - 1], end: out[i].start };
      continue;
    }
    // Too little room left for the earlier line to be read. Its words are
    // right and in order -- the two windows only disagree about where the
    // boundary falls -- so they become the head of the later line instead of
    // a flash: "a dry goods merchant" came out on screen for 0.2 s, ahead of
    // "by the name of Levi Strauss", before this.
    const spaced = /\s/.test(out[i].text.trim()) || /\s/.test(out[i - 1].text.trim());
    out[i] = {
      start: out[i - 1].start,
      end: out[i].end,
      text: `${out[i - 1].text.trim()}${spaced ? " " : ""}${out[i].text.trim()}`,
    };
    out.splice(i - 1, 1);
    i -= 1;
  }
  return out;
}

/** Less time on screen than this, and a line of several words cannot be read. */
const MIN_READ_S = 0.8;

/** Which cue, if any, belongs on screen at `at` seconds. */
export function cueAt(cues: Cue[], at: number): Cue | null {
  for (let i = cues.length - 1; i >= 0; i -= 1) {
    if (cues[i].start <= at && at < cues[i].end) return cues[i];
    if (cues[i].end <= at) break;
  }
  return null;
}

function clock(t: number, sep: string): string {
  const ms = Math.max(0, Math.round(t * 1000));
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, "0");
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  return `${h}:${m}:${s}${sep}${String(ms % 1000).padStart(3, "0")}`;
}

/** SubRip, for the download button. */
export function toSrt(cues: Cue[]): string {
  return cues
    .map((c, i) => `${i + 1}\n${clock(c.start, ",")} --> ${clock(c.end, ",")}\n${c.text}\n`)
    .join("\n");
}

/** WebVTT, which is what a <track> element wants. */
export function toVtt(cues: Cue[]): string {
  return `WEBVTT\n\n${cues
    .map((c) => `${clock(c.start, ".")} --> ${clock(c.end, ".")}\n${c.text}\n`)
    .join("\n")}`;
}
