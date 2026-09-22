/**
 * How much reading a transcription will do, for the progress bar.
 *
 * Its own module, like ./refill and ./remote, so the count can be tested
 * without the engine: a count that disagrees with the pipeline is invisible
 * until someone watches a bar sit at 100%, which is how APP-112 found it.
 */

import { TARGET_SAMPLE_RATE } from "./remote.ts";

/**
 * How far past its own end a pass reads, so it can finish a sentence.
 *
 * Long enough for a phrase, short enough that it cannot get through the
 * next speaker's opening line in a language it is not reading.
 */
export const LEAD_OUT_S = 3;

/** One stretch of the audio in one language, as sample offsets. */
export interface Span {
  from: number;
  to: number;
}

/**
 * How many windows the pipeline will cut this audio into.
 *
 * Deliberately mirrors the loop in transformers.js's
 * `AutomaticSpeechRecognitionPipeline._call_whisper` rather than
 * approximating it with a division: the last window is whatever is left
 * over, and `ceil(length / jump)` is off by one for exactly the lengths
 * that land on a boundary. A count that is one too low shows 105% and one
 * too high stops the bar short of the end, and both look like a bug.
 */
export function whisperWindows(samples: number, chunkLengthS: number, strideLengthS: number): number {
  const window = TARGET_SAMPLE_RATE * chunkLengthS;
  const jump = window - 2 * TARGET_SAMPLE_RATE * strideLengthS;
  if (jump <= 0 || samples <= 0) return 1;
  let offset = 0;
  let count = 0;
  while (true) {
    count += 1;
    if (offset + window >= samples) return count;
    offset += jump;
  }
}

/** Where a pass over `run` stops reading: its end, plus the lead-out. */
export function passEnd(run: Span, length: number): number {
  return Math.min(run.to + LEAD_OUT_S * TARGET_SAMPLE_RATE, length);
}

/**
 * Windows across every pass, counted over what each pass actually reads.
 *
 * Counting each run without its lead-out came up a window short whenever
 * the lead-out tipped a pass into one more: the bar reached 100% and then
 * sat there while the last window was read -- a silent 100% of its own,
 * before the missed-line check had even begun (APP-112).
 */
export function plannedWindows(runs: Span[], length: number, chunkLengthS: number, strideLengthS: number): number {
  return runs.reduce((n, run) => n + whisperWindows(passEnd(run, length) - run.from, chunkLengthS, strideLengthS), 0);
}

/** Mel frames in one Whisper window: 30 s at 100 a second, padded if shorter. */
export const WINDOW_FRAMES = 3000;
/** A timestamp token counts encoder positions, and each is two mel frames. */
const FRAMES_PER_TIMESTAMP = 2;

/**
 * Where the pipeline's seek stands after one `generate()` inside a window.
 *
 * transformers.js 4 reads a window with timestamps in a seek loop, as the
 * Python library does: when the model stops partway, it generates again from
 * the last complete segment, so one window can take two calls or five. Each
 * call ends with `streamer.end()`, which is why counting those calls ran the
 * bar to 100% with windows still being read -- on a two-minute clip, eleven
 * calls for six windows and twenty silent seconds at "100%" (APP-112).
 *
 * This is that loop's rule, from `_generate_with_seek`: a call that ends on a
 * lone timestamp, or has no pair of them, or produced nothing, is the end of
 * the window; otherwise the next call starts at the last pair.
 */
export function seekAfter(
  tokens: number[],
  timestampBegin: number,
  eos: number,
  seek: number,
  totalFrames = WINDOW_FRAMES,
): number {
  const t = tokens.at(-1) === eos ? tokens.slice(0, -1) : tokens;
  if (t.length === 0) return totalFrames;
  const isTime = t.map((x) => x >= timestampBegin);
  const loneEnding = t.length >= 2 && isTime[t.length - 1] && !isTime[t.length - 2];
  let lastPair = -1;
  for (let i = 0; i < t.length - 1; i += 1) if (isTime[i] && isTime[i + 1]) lastPair = i + 1;
  if (lastPair < 0 || loneEnding) return totalFrames;
  return seek + (t[lastPair - 1] - timestampBegin) * FRAMES_PER_TIMESTAMP;
}

/**
 * A streamer's view of how far through the planned windows the pipeline is.
 *
 * `put()` is handed the prompt once at the start of each call and then one
 * token per step; `end()` closes the call. The fraction is whole windows
 * finished plus how far the seek has got into the current one, so it moves
 * within a window and only reaches 1 when the last window is done.
 *
 * Without the token ids -- a model whose config does not carry them -- every
 * call counts as a window, which is what the bar did before and is the best
 * that can be said then.
 */
export function windowProgress(windows: number, timestampBegin?: number, eos?: number) {
  let done = 0;
  let seek = 0;
  let tokens: number[] = [];
  let prompt = true;
  const known = typeof timestampBegin === "number" && typeof eos === "number";
  return {
    put(ids: unknown) {
      if (prompt) { prompt = false; return; }
      for (const row of ids as unknown[][]) for (const id of row) tokens.push(Number(id));
    },
    end() {
      seek = known ? seekAfter(tokens, timestampBegin, eos, seek) : WINDOW_FRAMES;
      tokens = [];
      prompt = true;
      if (seek >= WINDOW_FRAMES) { done += 1; seek = 0; }
    },
    get fraction() {
      return Math.min((done + seek / WINDOW_FRAMES) / Math.max(windows, 1), 1);
    },
  };
}
