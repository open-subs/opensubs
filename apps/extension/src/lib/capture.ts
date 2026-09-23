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

// With the extension, because the unit tests run this file in node, which
// resolves no extension for it.
import { FIRST_WINDOW_S } from "./pace.ts";

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

/**
 * A host's site, near enough: its last two labels. "geo.dailymotion.com" and
 * "www.dailymotion.com" are one site; "www.youtube.com" is another. Wrong
 * for a suffix like "co.uk", where it only ever errs toward "same site",
 * which gives the advice that is true for either case.
 */
export function siteOf(host: string): string {
  return host.split(".").slice(-2).join(".");
}

/**
 * Why there is nothing to read, in words the user can act on (APP-133).
 *
 * A page with no video of its own but a frame of reasonable size almost
 * always has its player in that frame, and a content script cannot reach
 * into another origin's frame. What to do depends on whose frame it is. A
 * video embedded from another site -- a YouTube player on a blog -- has a
 * page of its own there, and that page can be subtitled. A site that plays
 * its own videos in a frame of its own, as Dailymotion does from
 * geo.dailymotion.com, has no other page to go to, and saying "open the
 * video on its own page" there sent people looking for one.
 */
export function whyNoMedia(doc: Document = document): string {
  const frames = Array.from(doc.querySelectorAll("iframe")).filter((f) => {
    const r = f.getBoundingClientRect();
    return r.width >= 200 && r.height >= 120;
  });
  if (!frames.length) return "No video or audio is playing on this page. Start the video, then press Start.";
  const here = siteOf(doc.location?.hostname ?? "");
  const elsewhere = frames.some((f) => {
    try {
      return siteOf(new URL(f.src, doc.baseURI).hostname) !== here;
    } catch {
      return false;
    }
  });
  return elsewhere
    ? "The video is in a player embedded from another site, which the extension cannot reach. " +
        "Open the video on that site's own page and press Start again."
    : "This site plays its videos in a separate player frame that the extension cannot reach, so it cannot be subtitled here.";
}

/** The largest element that is actually playing now, or null. */
export function playingMedia(doc: Document = document): HTMLMediaElement | null {
  const live = Array.from(doc.querySelectorAll<HTMLMediaElement>("video, audio"))
    .filter((el) => !el.paused && !el.ended && el.readyState >= 2);
  const area = (el: HTMLMediaElement) => {
    const r = el.getBoundingClientRect();
    return r.width * r.height;
  };
  return live.sort((a, b) => area(b) - area(a))[0] ?? null;
}

/**
 * Wait up to `ms` for something to be playing: after an ad, the film starts
 * in the same element with a new source or in another element, a second or
 * two later.
 */
export async function waitForPlaying(ms: number, doc: Document = document): Promise<HTMLMediaElement | null> {
  const until = Date.now() + ms;
  for (;;) {
    const el = playingMedia(doc);
    if (el || Date.now() >= until) return el;
    await new Promise((r) => setTimeout(r, 250));
  }
}

/**
 * Open an element's audio, or say why not. The SecurityError for a
 * cross-origin video -- "Cannot capture from element with cross-origin
 * data", as on Wikimedia Commons -- is the usual failure by a wide margin.
 */
export function openAudio(el: HTMLMediaElement): { stream: MediaStream } | { reason: string } {
  let stream: MediaStream;
  try {
    stream = capture(el);
  } catch (e) {
    const cross = e instanceof Error && (e.name === "SecurityError" || /cross-origin/i.test(e.message));
    return {
      reason: cross
        ? "This site does not let other pages read its video's audio (it is served from another domain), so it cannot be subtitled here."
        : "This video is protected, so its audio cannot be read.",
    };
  }
  if (!stream.getAudioTracks().length) return { reason: "That video has no audio track." };
  return { stream };
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
/** A window shorter than this holds no speech worth sending. */
export const MIN_WINDOW_MS = 1000;
/**
 * Nor does one this small, whatever its clock says.
 *
 * A recorder opened on a track that is not carrying audio -- the video is
 * paused, or ended while the page was not looking -- runs its full length
 * and returns the container header alone, about a hundred bytes. A second
 * of real Opus is ten thousand. The engine could only report that as "that
 * video has no audio track", about a video that was playing.
 */
export const MIN_WINDOW_BYTES = 2000;
/** Empty windows in a row before the silence is reported rather than waited out. */
export const SILENT_WINDOWS = 3;

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

  const began = performance.now();
  const done = new Promise<Window | null>((resolve) => {
    rec.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const finish = () => {
      if (timer !== null) { clearTimeout(timer); timer = null; }
      // A window stopped almost as soon as it started -- the video ended just
      // after it began, as an ad does -- holds a container with no audio in
      // it, and the engine rejected it as "The clip has no length." and ended
      // the session over nothing (APP-133). There is nothing in it to read.
      const long = performance.now() - began >= MIN_WINDOW_MS;
      const blob = parts.length ? new Blob(parts, { type: mime || parts[0].type }) : null;
      resolve(blob && long && blob.size >= MIN_WINDOW_BYTES ? { blob, offset } : null);
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
 * A new window starts `OVERLAP_S` before the one before it ends, while that
 * one is still recording, so there are briefly two MediaRecorders on the
 * track -- which is allowed, and each still produces a self-contained file.
 * The first window is FIRST_WINDOW_S long rather than `seconds`, so the
 * first subtitle does not wait out a whole pass (APP-148).
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

  const live = new Set<() => void>();
  // The first window is short, so something is on screen long before a full
  // pass of audio has played (APP-148). Everything after it is full length.
  let length = Math.min(FIRST_WINDOW_S, seconds);
  // Windows in a row that came back with no audio in them. One is a recorder
  // that opened while the video was paused; a run of them means no sound is
  // reaching the extension at all, and saying nothing about that leaves the
  // session sitting on "Listening" for as long as the film lasts.
  let silent = 0;
  let delivered: Promise<void> = Promise.resolve();
  let ended = media.ended;
  // The first window that could not be delivered. Deliveries are chained, and
  // a rejection in a chain skips everything after it without a word -- so the
  // first cut of this loop let one bad window stop every later one and only
  // said so when the film ended, two minutes on. It is caught here instead,
  // capture stops at once, and the reason reaches the user while it matters.
  let failure: unknown = null;
  const onEnded = () => { ended = true; };
  media.addEventListener("ended", onEnded);

  try {
    while (running() && !ended && failure === null) {
      const current = recordWindow(track, length, () => media.currentTime);
      live.add(current.stop);
      const got = current.done.finally(() => live.delete(current.stop));
      // In order, one at a time, and not at all once Stop has been pressed.
      delivered = delivered
        .then(async () => {
          if (failure !== null) return;
          const w = await got;
          if (!w) {
            silent += 1;
            if (silent >= SILENT_WINDOWS) {
              throw new Error(
                "No sound is reaching the extension from this video. Check that it is not muted, and press Start again.",
              );
            }
            return;
          }
          silent = 0;
          if (running()) await onWindow(w);
        })
        .catch((e) => { failure ??= e; });
      await until(Math.max(1, length - OVERLAP_S) * 1000, () => !running() || ended || failure !== null);
      length = seconds;
    }
    for (const stop of [...live]) stop();
    await delivered;
    if (failure !== null) throw failure;
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
