// How much longer a long job has to run.
//
// # Why this exists at all
//
// Transcribing an hour of video in the browser takes minutes, and until
// now the only thing on screen was a bar with nothing behind it: the whole
// transcription reported `fraction: null`, so it animated without ever
// moving. A bar that moves but never advances is worse than no bar, because
// it looks identical to a hang, and the person watching it has a decision to
// make -- wait, or switch to a hosted route -- that they cannot make without
// a number.
//
// # Why the estimate is deliberately coarse
//
// Remaining time is extrapolated from the rate so far, and that rate is
// noisy: a window of silence decodes far faster than a window of dense
// speech. Reported to the second, the number visibly jitters -- "2:14 left"
// then "1:58" then "2:20" -- and a figure that contradicts itself every
// second reads as a guess, which it is. Rounding to buckets a person would
// actually use ("about 5 min") hides the noise the estimate genuinely has
// rather than pretending to a precision it does not.
//
// # Why it stays silent at the start
//
// One window in, the estimate is one sample of a noisy rate multiplied by
// everything still to come, which is how progress bars end up promising
// four minutes and taking twenty. Nothing is shown until enough has
// elapsed for the rate to mean something.

/** Below this fraction there is not enough of a sample to extrapolate. */
const MIN_FRACTION = 0.02;
/** And below this many seconds, neither is there. */
const MIN_ELAPSED = 4;

/**
 * Seconds still to run, or `null` when it is too early to say.
 *
 * `elapsed` and the fraction must belong to the *same* stage of work.
 * Averaging across stages that run at different speeds -- decoding audio
 * is quick, transcribing it is not -- produces a confident number that is
 * wrong in both directions at different moments.
 */
export function secondsRemaining(elapsed: number, fraction: number | null): number | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  if (fraction <= 0 || fraction >= 1) return null;
  if (elapsed < MIN_ELAPSED || fraction < MIN_FRACTION) return null;
  const remaining = (elapsed / fraction) * (1 - fraction);
  return Number.isFinite(remaining) ? remaining : null;
}

/**
 * The same number as a person would say it.
 *
 * Buckets widen with the estimate, because the error does too: half a
 * minute out matters at "about a minute left" and does not at "about
 * 40 min left".
 */
export function humanRemaining(seconds: number): string {
  if (seconds < 45) return "under a minute left";
  if (seconds < 90) return "about a minute left";
  const minutes = Math.round(seconds / 60);
  if (minutes < 10) return `about ${minutes} min left`;
  if (minutes < 60) return `about ${Math.round(minutes / 5) * 5} min left`;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round((minutes % 60) / 10) * 10;
  if (rest === 0 || rest === 60) return `about ${hours + (rest === 60 ? 1 : 0)} hr left`;
  return `about ${hours} hr ${rest} min left`;
}

/**
 * Progress as one line of text: what it is doing, how far in, how long left.
 *
 * Assembled here rather than in the markup so the burn and the
 * transcription read the same way; they are the same kind of wait and
 * there is no reason for them to be worded differently.
 */
export function progressLabel(note: string, percent: number | null, remaining: string): string {
  const parts = [note];
  if (percent !== null) parts.push(`${percent}%`);
  if (remaining) parts.push(remaining);
  return parts.filter(Boolean).join(" · ");
}
