/**
 * How the engine keeps pace with a live capture: where it runs, and how far
 * behind it may fall. Its own module so the rules can be tested without the
 * engine, which pulls in the whole of Whisper.
 */

/** The part of `AsrSupport` (../../../web/src/lib/asr) the choice reads. */
export interface Support {
  integrated?: boolean;
  cpuFirst?: boolean;
}

/**
 * How much audio may wait, in seconds: fifteen minutes.
 *
 * Nothing short of that is dropped. The first window waits for the model to
 * load, and every window recorded meanwhile queues behind it -- on a slow
 * machine that alone is four or five windows, and a bound of a minute
 * dropped one of them on every run (APP-110). After that, a machine a little
 * slower than the film falls a little further behind each window, and still
 * delivers every line: the overlay puts each one on its own moment in the
 * video, and the SRT comes out whole. Fifteen minutes is the safety valve
 * for a machine that can never keep up, on a film that goes on for hours.
 */
export const MAX_WAITING_S = 15 * 60;

/** Windows that fit in MAX_WAITING_S at this pass length. */
export function maxWaiting(windowSeconds: number): number {
  return Math.max(1, Math.ceil(MAX_WAITING_S / Math.max(1, windowSeconds)));
}

/**
 * Queue a window; past `max` waiting, the oldest goes. Returns whether one
 * went -- the only case the user is told "skipped".
 */
export function enqueue<T>(waiting: T[], item: T, max: number): boolean {
  waiting.push(item);
  if (waiting.length <= max) return false;
  waiting.shift();
  return true;
}

/**
 * The status line while windows wait. Past two behind, it names the way to
 * keep up for good -- unless that is already the model in use.
 */
export function behindNote(waiting: number, model: string): string {
  const n = `${waiting} window${waiting === 1 ? "" : "s"}`;
  if (waiting < 2 || /tiny/i.test(model)) return `Transcribing (catching up: ${n} waiting)`;
  return `Transcribing (${n} behind -- the Tiny model keeps up on slower machines)`;
}

/**
 * Whether "auto" runs on the CPU although WebGPU is there.
 *
 * Measured on one laptop, an i7-1360P with Intel Iris Xe, reading 20-second
 * windows with Base:
 *
 *   Chrome,  WebGPU   14-30 s a window; dropped windows on 4 runs of 5 (APP-110)
 *   Firefox, WebGPU   285 s for the first window, then everything dropped (APP-121)
 *   Firefox, CPU      8-16 s a window; nothing dropped, 98% covered (APP-121)
 *
 * So the CPU wherever the evidence says WebGPU is the slow path here: an
 * integrated Intel GPU (by the rule the web page uses, ../web device.ts),
 * and Firefox, whose adapter says nothing about itself and cannot be judged.
 * The page itself keeps WebGPU on an Iris Xe (APP-111) because there the
 * CPU runs on the page's own thread and freezes it; here the engine has a
 * document of its own, and nothing the user sees stops. The cost is the
 * download: the CPU needs full-precision weights, about four times the size.
 */
export function startsOnCpu(s: Support): boolean {
  return Boolean(s.integrated || s.cpuFirst);
}

/**
 * How far the subtitles may trail the picture before the overlay stops
 * looking for the line that belongs to this moment.
 *
 * Live transcription is always behind: a twenty-second window is only
 * complete when it has played, and reading it takes seconds more. So the
 * line for 0:40 is ready when the film is at 1:20, and an overlay that asks
 * "what belongs at 1:20?" is handed nothing, for ever -- the subtitles were
 * there, in the exported file, and never on the video (APP-139).
 *
 * Five seconds separates that from an ordinary pause in speech, where there
 * genuinely is no line and the overlay should stay empty.
 */
export const BEHIND_S = 5;

/** How long one line stays up while catching up, in seconds. */
const MIN_HOLD_S = 1.2;
const MAX_HOLD_S = 5;
/** Lines still unseen past this, and each is held for the minimum. */
const BACKLOG_HURRY = 6;

/** Which line the overlay is showing while it catches up. */
export interface Catchup {
  /** Index into the cues, or -1 before anything has been shown. */
  index: number;
  /** Show it at least until this moment (ms, from the same clock as `now`). */
  until: number;
}

export interface Shown {
  index: number;
  until: number;
  /** Seconds between this line's end and where the video is now. */
  lag: number;
}

/**
 * The line to put on the video: the one that belongs to this moment if there
 * is one, otherwise the next one the viewer has not seen yet.
 *
 * Returning null means show nothing -- no lines at all, or a real silence.
 * Lines are held long enough to read and no longer, and a backlog is gone
 * through faster, so the overlay walks up to the newest rather than sitting
 * on the oldest.
 */
export function liveLine(
  cues: { start: number; end: number }[],
  at: number,
  now: number,
  state: Catchup,
): Shown | null {
  if (!cues.length) return null;

  for (let i = cues.length - 1; i >= 0; i -= 1) {
    if (cues[i].start <= at && at < cues[i].end) return { index: i, until: now, lag: 0 };
    if (cues[i].end <= at) break;
  }

  const last = cues.length - 1;
  const lag = at - cues[last].end;
  if (lag <= BEHIND_S) return null;

  if (state.index >= 0 && state.index <= last && now < state.until) {
    return { index: state.index, until: state.until, lag: at - cues[state.index].end };
  }
  const next = Math.min(Math.max(state.index + 1, 0), last);
  const cue = cues[next];
  const behind = last - next;
  const hold = behind > BACKLOG_HURRY
    ? MIN_HOLD_S
    : Math.min(Math.max(cue.end - cue.start, MIN_HOLD_S), MAX_HOLD_S);
  return { index: next, until: now + hold * 1000, lag: at - cue.end };
}


/**
 * The models "Automatic" chooses between.
 *
 * Base is the better recogniser and the slower one. On an Intel integrated
 * GPU it does not keep up: the subtitles fell thirty to seventy seconds
 * behind the picture and stayed there, which is no use to someone watching
 * (APP-142). Tiny reads the same window in about a third of the time.
 *
 * Multilingual Tiny, not the English-only one: "Automatic" cannot know what
 * language is coming, and handing an English-only model a French video would
 * be a worse failure than being slow.
 */
export const AUTO_FAST = "onnx-community/whisper-tiny";
export const AUTO_GOOD = "onnx-community/whisper-base";

/** Windows waiting before "Automatic" gives up on keeping Base. */
export const AUTO_BEHIND = 2;

/**
 * Which model to read this window with.
 *
 * A model the user chose is theirs, always. "Automatic" starts on Tiny where
 * the engine is already running on the processor -- the machines that cannot
 * carry Base -- and drops to Tiny anywhere else that falls behind, because a
 * backlog only grows.
 */
export function pickModel(chosen: string, device: "webgpu" | "wasm", behind: boolean): string {
  if (chosen !== "auto") return chosen;
  return device === "wasm" || behind ? AUTO_FAST : AUTO_GOOD;
}

/**
 * The first window of a capture is short.
 *
 * Every window has to be recorded before it can be read, so the first
 * subtitle cannot arrive until a whole pass of audio has played -- twenty
 * seconds on the default setting, during which the extension has nothing to
 * show and looks broken. It is most obvious on a second Start, where the
 * model is already in memory and the wait is purely this (APP-148). Six
 * seconds is enough for a sentence or two, and Whisper pads a short clip to
 * its own thirty either way, so the only cost is one extra pass at the top
 * of each video.
 */
export const FIRST_WINDOW_S = 6;

/**
 * The sizes the subtitle can be set to, smallest first.
 *
 * They were 0.8 / 1 / 1.3 / 1.7 and the whole set read too large: the
 * smallest still covered the picture in a normal YouTube window, and nobody
 * reached for the largest (APP-147). Each step is now one notch down from
 * where it was, and the extra-large step is gone.
 */
export const SIZES = [0.6, 0.8, 1] as const;

/** The offered size nearest `scale` -- what a setting saved before the sizes moved becomes. */
export function nearestSize(scale: number): number {
  if (!Number.isFinite(scale) || scale <= 0) return DEFAULT_SIZE;
  return SIZES.reduce((best, s) => (Math.abs(s - scale) < Math.abs(best - scale) ? s : best), SIZES[0]);
}

/** Medium: a little smaller than the picture's own captions, and legible on a phone. */
export const DEFAULT_SIZE = SIZES[1];
