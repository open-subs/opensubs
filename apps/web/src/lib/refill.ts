/**
 * Reading again what the first pass over the audio missed.
 *
 * Its own module, as ./remote is, so that it can be tested without the engine
 * or the demuxer that asr.ts pulls in. What it reads, in which order, what it
 * tells the screen while it does, and which reads it can skip are all decided
 * here, and none of it needs a model to check (APP-112).
 *
 * APP-112, in one line: this ran after the progress bar had reached
 * "Listening to the audio · 100%", reported nothing, and took 76 to 233
 * seconds of a two-minute clip -- a finished-looking screen that was still
 * working, and part of that work was reading the same empty span again.
 */
import type { Segment } from "./engine";
import type { AsrProgress, LanguageRun } from "./asr";
// With its extension, so that Node can load this file directly for the test
// in e2e/refill.mjs; Vite and tsc accept it either way.
import { TARGET_SAMPLE_RATE } from "./remote.ts";

export interface WhisperChunk {
  text: string;
  timestamp: [number, number | null];
}

/**
 * Read one span of audio, in one language, the way the first pass did.
 *
 * Given rather than built here: which Whisper options a reading takes belongs
 * to asr.ts, and a test can hand in a reader that returns whatever the case
 * needs -- which is the only way to put a stubborn gap in front of this code
 * on demand, since where Whisper drops a span changes from one run to the
 * next.
 */
export type Read = (slice: Float32Array, language: string) => Promise<WhisperChunk[]>;

/** No spoken segment worth one subtitle runs longer than this. */
export const MAX_SEGMENT_S = 12;
/** Slower than this is not speech, whatever the timestamps claim. */
export const MIN_CHARS_PER_SECOND = 2;

/** A stretch of speech with no subtitle over it is worth looking at again. */
const GAP_S = 4;
/** Past this, the gap is not a recogniser slip and re-reading it is not cheap. */
const MAX_GAP_S = 60;
/**
 * At most this many second readings, however many gaps there turn out to be.
 *
 * Twelve was not enough once boundaries were placed properly: a file with
 * several language changes has several seams, each seam can leave a gap,
 * and each gap can take more than one round to clear. The budget ran out
 * mid-file and left nineteen seconds unread. Each reading is bounded by
 * `MAX_GAP_S`, so the worst case here is minutes of extra work on a file
 * that is already taking minutes -- against silently dropping speech.
 */
const MAX_REFILLS = 30;
/**
 * ...but no more than one re-read per this many seconds of audio.
 *
 * Thirty is right for a four-minute file with two language changes and
 * far too many for one with eight: every seam can leave a gap, every gap
 * costs a full pass, and a fixed budget that is generous for a short file
 * is a way to spend twenty minutes on one that is not much longer.
 */
const REFILL_SECONDS_EACH = 20;
/** And at most this many rounds of them, so a stubborn gap cannot loop. */
const MAX_REFILL_ROUNDS = 4;
/**
 * How loud a gap must be, against the whole clip, to be worth re-reading.
 *
 * Most gaps are real: silence, music, a held shot. Only the ones with
 * someone talking in them are a failure.
 */
const GAP_SPEECH_RATIO = 0.15;

/**
 * Transcribe again over any stretch of speech that produced nothing.
 *
 * Whisper's pipeline reconciles overlapping windows by matching their
 * tokens, and when that match goes wrong it does not error -- it drops
 * the span. Measured on the reported footage: twenty seconds of a Chinese
 * interview, between 1:06 and 1:26, simply absent from the subtitles.
 *
 * It is also *chaotic*. Moving where a pass begins by half a second
 * reshuffles every 30-second window inside it, and the same audio then
 * loses a different span, or none. Three runs over the same file: 210
 * seconds covered, then 184, then 201. So this cannot be tuned away by
 * choosing better boundaries; the boundaries are not the fault, and a
 * boundary that happens to avoid it on one file is luck, not a fix.
 *
 * What can be done is to notice. Silence needs no subtitle, so a gap is
 * only suspicious when there is sound in it, and then the span is read
 * again on its own -- where it is the whole input rather than one window
 * among many, and there is nothing to reconcile it with.
 */
export async function fillGaps(
  segments: Segment[],
  runs: LanguageRun[],
  audio: Float32Array,
  read: Read,
  signal?: AbortSignal,
  onProgress?: (progress: AsrProgress) => void,
): Promise<void> {
  let energy = 0;
  for (let i = 0; i < audio.length; i += 16) energy += audio[i] * audio[i];
  const overall = Math.sqrt(energy / Math.max(1, audio.length / 16));
  if (!(overall > 0)) return;

  // Re-reading is bounded work. A handful of gaps is a recogniser having a
  // bad moment, which is worth fixing; dozens of them means something else
  // is wrong, and grinding through all of them would turn a transcription
  // that finished badly into one that does not finish.
  let budget = Math.min(
    MAX_REFILLS,
    Math.ceil(audio.length / TARGET_SAMPLE_RATE / REFILL_SECONDS_EACH),
  );

  // Rounds, because one re-read often does not finish the job.
  //
  // Measured on the reported footage: asked for 59.5 to 86.5 seconds --
  // twenty-seven seconds of interview -- Whisper returned a single chunk
  // covering the first three, and nonsense at that. Asked for 66.6 to
  // 86.5, it transcribed the lot correctly. Something in the first
  // seconds after the speaker changes poisons the window, and stepping
  // past it is all that is needed. So whatever a re-read leaves uncovered
  // becomes a gap again, and is read again, until nothing new comes back.
  // Spans already read that gave back nothing worth keeping, by exact bounds.
  const empty = new Set<string>();
  for (let round = 0; round < MAX_REFILL_ROUNDS && budget > 0; round += 1) {
    const found = await fillRound(
      segments, runs, audio, read, signal,
      () => budget, (n) => { budget = n; }, overall, round, onProgress, empty,
    );
    if (found.length === 0) break;
    segments.push(...found);
    segments.sort((a, b) => a.start - b.start);
  }
}

async function fillRound(
  segments: Segment[],
  runs: LanguageRun[],
  audio: Float32Array,
  read: Read,
  signal: AbortSignal | undefined,
  getBudget: () => number,
  setBudget: (n: number) => void,
  overall: number,
  round: number,
  onProgress: ((progress: AsrProgress) => void) | undefined,
  empty: Set<string>,
): Promise<Segment[]> {
  segments.sort((a, b) => a.start - b.start);
  const found: Segment[] = [];
  let budget = getBudget();

  // Which spans this round will read, decided before reading any of them.
  //
  // That is the order the reads always had -- what a round finds is kept
  // aside in `found` and only merged after it, so no read changes which gaps
  // the same round sees -- and deciding first is what makes the work
  // countable. It used to be invisible: this ran after the progress bar said
  // "Listening to the audio · 100%" and reported nothing, for 76 to 233
  // seconds on a two-minute clip, which is a finished-looking screen that is
  // still working (APP-112).
  const todo: { from: number; to: number; language: string; key: string }[] = [];
  let skipped = 0;
  for (const run of runs) {
    const from = run.from / TARGET_SAMPLE_RATE;
    const to = run.to / TARGET_SAMPLE_RATE;
    let cursor = from;
    const inside = segments.filter((seg) => seg.start >= from - 0.5 && seg.start < to);
    for (const seg of [...inside, { start: to, end: to, text: "" }]) {
      const gap = seg.start - cursor;
      if (
        budget > 0 &&
        gap >= GAP_S &&
        gap <= MAX_GAP_S &&
        loudness(audio, cursor, seg.start) > overall * GAP_SPEECH_RATIO
      ) {
        // A span already read to the same bounds, that gave back nothing, is
        // not read again. Whisper decodes the same samples the same way, so a
        // second reading of them can only come back empty a second time --
        // and it is charged to the budget, so every repeat is a reading of
        // some other gap that does not happen. Rounds exist for a different
        // case: a partial fill leaves a *new* gap, starting later, and that
        // one has different bounds and is still read.
        const key = `${cursor}:${seg.start}`;
        if (empty.has(key)) {
          skipped += 1;
        } else {
          budget -= 1;
          todo.push({ from: cursor, to: seg.start, language: run.language, key });
        }
      }
      cursor = Math.max(cursor, seg.end);
    }
  }

  // One note per pass, held for the whole pass. The page keys its "time
  // remaining" on the note, so a note that changed with every read -- "2 of
  // 5", "3 of 5" -- would restart that clock each time and never say anything
  // useful. The fraction carries the count instead. A second pass is honestly
  // a second piece of work, so it gets its own note and starts from zero.
  const note = round === 0 ? "Checking for missed lines" : "Checking again for missed lines";
  const began = performance.now();
  let cameBackEmpty = 0;
  for (const [done, span] of todo.entries()) {
    const before = found.length;
    onProgress?.({ stage: "transcribing", fraction: done / todo.length, note });
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const slice = audio.slice(
      Math.round(span.from * TARGET_SAMPLE_RATE),
      Math.round(span.to * TARGET_SAMPLE_RATE),
    );
    const again = await read(slice, span.language);
    for (const chunk of again) {
      const text = readable(chunk.text);
      const [begin, end] = chunk.timestamp;
      if (!text || typeof begin !== "number") continue;
      // A re-read can smear exactly as the first read did, and one
      // that does must not be kept -- keeping it fills the gap with
      // nonsense and stops the next round retrying the span. Same
      // test as `dropOverlong`, applied to what comes back.
      const covers = (typeof end === "number" && end > begin ? end : begin) - begin;
      if (covers > MAX_SEGMENT_S && text.length / covers < MIN_CHARS_PER_SECOND) continue;
      const start = span.from + begin;
      // Never past the gap it was asked to fill: a refilled span that
      // ran long would overlap the subtitle that follows it.
      if (start >= span.to) continue;
      found.push({
        start,
        end: Math.min(
          span.to,
          span.from + (typeof end === "number" && end > begin ? end : begin + 1),
        ),
        text,
      });
    }
    if (found.length === before) {
      cameBackEmpty += 1;
      empty.add(span.key);
    }
  }
  if (todo.length || skipped) {
    if (todo.length) onProgress?.({ stage: "transcribing", fraction: 1, note });
    // One line per pass, at debug level so it is out of the way unless asked
    // for. APP-112 was diagnosed by reading this code and timing the screen;
    // the next report about this pass should be able to start from a log.
    console.debug(
      `opensubs: missed-line pass ${round + 1}: ${todo.length} span(s) read, ` +
        `${skipped} skipped as already read and empty, ${cameBackEmpty} came back empty, ` +
        `${((performance.now() - began) / 1000).toFixed(1)}s`,
    );
  }

  setBudget(budget);
  return found;
}

/** RMS between two times, in seconds. */
export function loudness(audio: Float32Array, from: number, to: number): number {
  const a = Math.max(0, Math.round(from * TARGET_SAMPLE_RATE));
  const b = Math.min(audio.length, Math.round(to * TARGET_SAMPLE_RATE));
  if (b <= a) return 0;
  let sum = 0;
  let n = 0;
  for (let i = a; i < b; i += 16) {
    sum += audio[i] * audio[i];
    n += 1;
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

export function readable(text: string): string {
  return text.replace(/\uFFFD/g, "").replace(/\s+/g, " ").trim();
}
