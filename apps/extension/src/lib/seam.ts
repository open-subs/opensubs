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
export function stitch(kept: Cue[], incoming: Cue[]): Cue[] {
  const out = kept.slice();
  for (const cue of incoming) {
    if (!cue.text.trim()) continue;
    let replaced = false;
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
      replaced = true;
      break;
    }
    if (!replaced) out.push(cue);
  }
  out.sort((a, b) => a.start - b.start || a.end - b.end);
  return out;
}

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
