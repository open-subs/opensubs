/**
 * Taking audio off a page's own video element.
 *
 * # Why the audio comes from the element and not from the tab
 *
 * Chromium has `chrome.tabCapture`, which grabs everything the tab plays.
 * Firefox has no equivalent at all. Rather than write the feature twice and
 * ship a worse version to one browser, both use
 * `HTMLMediaElement.captureStream()`, which is on the element itself and
 * behaves the same in Gecko and Blink -- verified in both before this file
 * was written: one audio track, real samples, and a MediaRecorder blob that
 * decodes.
 *
 * Taking it from the element also gets the *timeline* for free.
 * `media.currentTime` says where a window of audio sits in the film, which
 * is what a subtitle needs. Tab capture would only give wall-clock time, so
 * every seek and pause would have to be tracked by hand to convert one to
 * the other.
 *
 * Two things it cannot do, and both are reported rather than papered over:
 * DRM-protected streams capture as silence, and a plain cross-origin file
 * without CORS headers taints the element so `captureStream` throws.
 */

/**
 * Each window begins this long before the previous one ends.
 *
 * A window is cut where the clock says, not between two sentences, so a
 * sentence often straddles the cut. Whisper drops or garbles the half it
 * cannot finish; with the overlap the next window hears it whole, and
 * `seam.ts` keeps the better reading. Measured on a two-minute lecture
 * before the overlap existed: nine seconds of speech at one seam produced
 * no subtitle at all (APP-110).
 */
export const OVERLAP_S = 3;

export interface Window {
  blob: Blob;
  /** Where this window starts on the media element's timeline. */
  offset: number;
}

/**
 * The biggest media element that is actually playing.
 *
 * Size rather than document order, because ad players, preview thumbnails
 * and muted background loops are all real <video> elements and the one the
 * viewer is watching is the large one. "Playing" is checked first so that a
 * paused hero video does not win over the film below it.
 */
export function findMedia(doc: Document = document): HTMLMediaElement | null {
  const all = Array.from(doc.querySelectorAll<HTMLMediaElement>("video, audio"));
  const area = (el: HTMLMediaElement) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };
  const live = all.filter((el) => !el.paused && !el.ended && el.readyState >= 2);
  const pool = live.length ? live : all.filter((el) => el.readyState >= 1);
  return pool.sort((a, b) => area(b) - area(a))[0] ?? null;
}

export function capture(el: HTMLMediaElement): MediaStream {
  const withCapture = el as HTMLMediaElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  // Gecko shipped this prefixed and still exposes it that way on some
  // builds; Blink never had a prefix.
  const grab = withCapture.captureStream ?? withCapture.mozCaptureStream;
  if (!grab) throw new Error("This browser cannot capture audio from a video element.");
  return grab.call(el);
}

/** The container to ask MediaRecorder for, best first. */
const CONTAINERS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/ogg;codecs=opus",
  "audio/mp4",
];

export function bestContainer(): string {
  if (typeof MediaRecorder === "undefined") return "";
  for (const type of CONTAINERS) {
    if (MediaRecorder.isTypeSupported(type)) return type;
  }
  return "";
}

/**
 * Record one window.
 *
 * A fresh MediaRecorder per window, deliberately. `start(timeslice)` would
 * be the obvious way to get a stream of chunks, but only the *first* chunk
 * carries the container header -- every later one is a headerless fragment
 * that no decoder will open on its own. One recorder per window costs a few
 * milliseconds and gives a self-contained file each time.
 */
export function recordWindow(
  track: MediaStreamTrack,
  seconds: number,
  at: () => number,
): { done: Promise<Window | null>; stop: () => void } {
  const mime = bestContainer();
  // Where recording actually starts. This used to subtract OVERLAP_S, as if
  // the recorder had started earlier than it had -- but nothing ever started
  // it earlier, so every window after the first was stamped three seconds
  // before its own audio, and every subtitle showed three seconds before the
  // words (APP-110). The overlap is now real, in `recordWindows`, and this is
  // just the truth.
  const offset = at();
  const rec = new MediaRecorder(new MediaStream([track]), mime ? { mimeType: mime } : undefined);
  const parts: Blob[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const done = new Promise<Window | null>((resolve) => {
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const finish = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      resolve(parts.length ? { blob: new Blob(parts, { type: mime || parts[0].type }), offset } : null);
    };
    rec.onstop = finish;
    rec.onerror = finish;
  });

  rec.start();
  timer = setTimeout(() => { if (rec.state !== "inactive") rec.stop(); }, seconds * 1000);

  return {
    done,
    stop: () => { if (rec.state !== "inactive") rec.stop(); },
  };
}

/**
 * Record window after window, each overlapping the last, until stopped.
 *
 * A new window starts every `seconds - OVERLAP_S`, while the previous one is
 * still recording, so there are briefly two MediaRecorders on the track --
 * which is allowed, and each still produces a self-contained file.
 *
 * `onWindow` is called in order and never twice at once, so a slow consumer
 * cannot be handed two windows together. It must not be used to throttle
 * capture: recording has to keep pace with playback or the subtitles fall
 * behind the film for good, which is why the engine drops windows rather
 * than queueing them.
 *
 * Returns when `running()` turns false or the film ends. On the end, the
 * windows still recording are closed at once rather than left to run out
 * their clocks over silence -- the last lines of a film should not wait
 * twenty seconds after the credits for a timer.
 */
export async function recordWindows(
  media: HTMLMediaElement,
  stream: MediaStream,
  seconds: number,
  onWindow: (w: Window) => void | Promise<void>,
  running: () => boolean,
): Promise<void> {
  const track = stream.getAudioTracks()[0];
  if (!track) throw new Error("That video has no audio track this extension can read.");

  const step = Math.max(1, seconds - OVERLAP_S);
  const live = new Set<() => void>();
  let delivered: Promise<void> = Promise.resolve();
  let ended = media.ended;
  const onEnded = () => { ended = true; };
  media.addEventListener("ended", onEnded);

  try {
    while (running() && !ended) {
      const current = recordWindow(track, seconds, () => media.currentTime);
      live.add(current.stop);
      const got = current.done.finally(() => live.delete(current.stop));
      // In order, one at a time, and not at all once Stop has been pressed.
      delivered = delivered.then(async () => {
        const w = await got;
        if (w && running()) await onWindow(w);
      });
      await until(step * 1000, () => !running() || ended);
    }
    for (const stop of [...live]) stop();
    await delivered;
  } finally {
    media.removeEventListener("ended", onEnded);
  }
}

/** Wait `ms`, or less if `early()` turns true first. */
function until(ms: number, early: () => boolean): Promise<void> {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      if (early() || Date.now() >= deadline) resolve();
      else setTimeout(tick, Math.min(200, deadline - Date.now()));
    };
    tick();
  });
}
