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

/** Windows are recorded with this much of the previous one repeated. */
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
  const offset = Math.max(0, at() - OVERLAP_S);
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
 * Record window after window until stopped.
 *
 * `onWindow` is awaited, but only so that a slow consumer cannot be handed
 * two windows at once; it must not be used to throttle capture. Recording
 * has to keep pace with playback or the subtitles fall behind the film for
 * good, which is why the engine drops windows rather than queueing them.
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
  while (running()) {
    const { done } = recordWindow(track, seconds, () => media.currentTime);
    const got = await done;
    if (!running()) break;
    if (got) await onWindow(got);
  }
}
