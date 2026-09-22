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
