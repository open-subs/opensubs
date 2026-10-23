/**
 * Which language a live capture is in, decided across the whole capture.
 *
 * A capture reaches the engine as twenty-second windows. Detecting the
 * language in each window on its own let one Korean video come out in
 * three languages: windows whose four-second cells disagreed went through
 * per-cell detection, so a cell Whisper heard as Japanese was transcribed
 * as Japanese ("あっす") and one it heard as English as English ("I'm
 * sorry."); and the first window that happened to agree with itself
 * locked the whole capture to its language -- a window of stalled playback
 * and a line or two of speech can agree on English as easily as on
 * Korean, and every line after that was English. Forcing English onto
 * Korean speech does not fail, it translates: the rest of the video came
 * out as fluent English nobody said.
 *
 * So each window only contributes evidence -- seconds of speech per
 * language, weighted by how sure Whisper was and by its own estimate that
 * somebody was speaking at all (see `languageEvidence` in asr.ts) -- and
 * the language is decided on everything heard so far. Silence and stalls
 * contribute nothing, a window of mixed readings adds to the right
 * language as well as the wrong one, and the decision gets steadier with
 * every window instead of being taken from one.
 *
 * Kept free of the engine so the rule can be tested on numbers.
 */

/** Seconds of speech heard per Whisper language code. */
export type Evidence = Record<string, number>;

/**
 * Less evidence than this, in total, is nothing heard: the window is left
 * without lines rather than transcribed in a language chosen from noise.
 */
export const MIN_HEARD_S = 1;

/**
 * A second language is believed once it holds this share of what has
 * been heard *and* this many seconds of it.
 *
 * Both, because either alone is wrong. The share keeps a long capture's
 * stray readings out -- Whisper Tiny on Korean puts a few percent of its
 * weight on Japanese and Chinese all the way through. The seconds keep a
 * short capture from calling one misheard sentence a second language. A
 * real bilingual capture -- an interview in one language inside a report
 * in another -- clears both within a minute or two.
 */
export const SECOND_SHARE = 0.25;
export const SECOND_S = 20;

/**
 * When to stop detecting: this much speech heard, with the leader holding
 * this share of it.
 *
 * Detection is not free -- one encoder pass per four seconds of audio, on
 * top of the transcription -- and on a machine that only just keeps up it
 * is the difference between keeping up and not. Once a capture has
 * plainly been one language for this long, the rest is transcribed in it
 * without asking again. A capture that is genuinely in two never locks,
 * and keeps paying for detection, as it has to.
 */
export const LOCK_S = 30;
export const LOCK_SHARE = 0.7;

/** Add one window's evidence to the capture's. Returns the total. */
export function addEvidence(total: Evidence, window: Evidence): Evidence {
  for (const [code, seconds] of Object.entries(window)) {
    if (!(seconds > 0)) continue;
    total[code] = (total[code] ?? 0) + seconds;
  }
  return total;
}

function ranked(total: Evidence): [string, number][] {
  return Object.entries(total)
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

/**
 * The language(s) to transcribe the next window in.
 *
 * One language almost always; two when a second has earned it (detection
 * then chooses between only those two, cell by cell); null when nothing
 * has been heard yet.
 */
export function chooseLanguages(total: Evidence): string[] | null {
  const order = ranked(total);
  const sum = order.reduce((n, [, s]) => n + s, 0);
  if (sum < MIN_HEARD_S || order.length === 0) return null;
  const [first, second] = order;
  if (second && second[1] >= SECOND_S && second[1] / sum >= SECOND_SHARE) {
    return [first[0], second[0]];
  }
  return [first[0]];
}

/** The language to stop detecting and stay in, once there is one. */
export function settledLanguage(total: Evidence): string | null {
  const order = ranked(total);
  const sum = order.reduce((n, [, s]) => n + s, 0);
  if (sum < LOCK_S || order.length === 0) return null;
  const chosen = chooseLanguages(total);
  if (!chosen || chosen.length !== 1) return null;
  return order[0][1] / sum >= LOCK_SHARE ? order[0][0] : null;
}
