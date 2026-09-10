// Rendering one libass frame at an exact timestamp, off the playback clock.
//
// The preview attaches JASSUB to a `<video>` and lets it follow playback.
// A burn needs the opposite: no video, no clock, and a rendered bitmap for
// a timestamp we choose, awaited before the next one is asked for.
//
// Two things make that possible, and neither is obvious from JASSUB's
// documented surface:
//
//  1. Passing an explicit `canvas` disables `offscreenRender`, so the
//     bitmaps land in a canvas this thread owns and can composite from.
//     (With a `video` and no `canvas`, JASSUB transfers control of its own
//     canvas to the worker and the pixels become unreadable here.)
//  2. The worker accepts a `demand` message carrying a time, and renders
//     exactly that instant once. `setCurrentTime` only moves the worker's
//     playback clock and renders nothing while paused.
//
// Both are reached through internals (`sendMessage`, `_render`,
// `_videoWidth`). That is a real coupling to a specific JASSUB version and
// is why it is quarantined in this one small file rather than spread
// through the burn loop.

import JASSUB from "jassub";
import workerUrl from "jassub/dist/jassub-worker.js?url";
import wasmUrl from "jassub/dist/jassub-worker.wasm?url";
import fallbackFontUrl from "jassub/dist/default.woff2?url";
import { fontSetupFor } from "./fonts";

/** How long to wait for one frame before giving up on the worker. */
const FRAME_TIMEOUT_MS = 10_000;

/** How long to wait for the worker to compile its wasm and report ready. */
const BOOT_TIMEOUT_MS = 30_000;

/**
 * The JASSUB internals this file depends on, named in one place.
 *
 * None of these are in JASSUB's published types. Declaring them here means
 * a version bump that removes one becomes a compile error in a single
 * file, rather than a silent runtime failure spread across the burn loop.
 */
interface JassubInternals {
  _render(data: unknown): void;
  setTrack(content: string): void;
  _worker: Worker;
  _videoWidth: number;
  _videoHeight: number;
  resize(
    width?: number,
    height?: number,
    top?: number,
    left?: number,
    force?: boolean,
  ): void;
  sendMessage(target: string, data?: unknown): void;
  destroy(): void;
}

export class SubtitleRaster {
  readonly canvas: HTMLCanvasElement;
  #renderer: JassubInternals;
  #pending: (() => void) | null = null;

  private constructor(canvas: HTMLCanvasElement, renderer: JassubInternals) {
    this.canvas = canvas;
    this.#renderer = renderer;
  }

  /**
   * `width`/`height` must match the dimensions the ASS was generated at,
   * and the dimensions frames will be composited at.
   */
  static async create(
    ass: string,
    width: number,
    height: number,
  ): Promise<SubtitleRaster> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const renderer = new JASSUB({
      canvas,
      subContent: ass,
      workerUrl,
      wasmUrl,
      // Chosen from the subtitle text itself, so a burn of Chinese cues
      // gets a font that can draw them. See ./fonts.ts.
      // Cast: JASSUB accepts font bytes but types the map as strings.
      ...((await fontSetupFor(ass, fallbackFontUrl)) as unknown as {
        availableFonts: Record<string, string>;
        fallbackFont: string;
      }),
      // There is no video to hang a frame callback off, and no playback to
      // follow. Every frame is asked for explicitly.
      onDemandRender: false,
      offscreenRender: false,
    }) as unknown as JassubInternals;

    const raster = new SubtitleRaster(canvas, renderer);

    // Intercept the worker's paint so a frame can be awaited. The original
    // still runs -- it is what actually draws into the canvas.
    const draw = renderer._render.bind(renderer);
    renderer._render = (data: unknown) => {
      const result = draw(data);
      raster.#settle();
      return result;
    };

    // Wait for the worker's own `ready`, rather than sleeping and hoping.
    //
    // A fixed delay is not merely inelegant here, it is wrong: until the
    // worker has compiled its wasm and taken the track, every `demand`
    // completes instantly with nothing drawn. That does not fail -- it
    // exports a video with no subtitles on it, which is indistinguishable
    // from success until you look at the pixels. A machine fast enough to
    // beat the timeout hides it completely; a slower one (a CI runner, a
    // headless browser) does not.
    const worker = renderer._worker;
    const onMessage = worker.onmessage;
    const ready = new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, BOOT_TIMEOUT_MS);
      worker.onmessage = (event: MessageEvent) => {
        const result = onMessage?.call(worker, event);
        const target = (event.data as { target?: string } | null)?.target;
        if (target === "ready") {
          clearTimeout(timer);
          resolve();
        }
        // A frame with nothing on it (between cues) never reaches _render;
        // the worker reports "unbusy" instead. Treat that as a completed
        // empty frame rather than hanging.
        if (target === "unbusy") raster.#settle();
        return result;
      };
    });
    await ready;

    // resize() reads `_video.videoWidth` unconditionally, so seed the
    // dimensions it would have taken from an element that does not exist.
    renderer._videoWidth = width;
    renderer._videoHeight = height;
    renderer.resize(width, height, 0, 0, true);

    // One warm-up frame, discarded. The first demand after a resize can
    // still land before the track is laid out, and a dropped first
    // subtitle is exactly the kind of defect that survives review.
    await raster.render(0);

    return raster;
  }

  #settle() {
    const pending = this.#pending;
    this.#pending = null;
    pending?.();
  }

  /**
   * Draw the subtitles for `time` (on the *source* timeline, matching the
   * ASS document) and resolve once the canvas holds them.
   */
  render(time: number): Promise<void> {
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve();
      };
      // A stalled worker must not wedge an entire export. Losing one
      // frame's subtitles is a visible glitch; hanging forever is worse.
      const timer = setTimeout(finish, FRAME_TIMEOUT_MS);
      this.#pending = finish;
      this.#renderer.sendMessage("demand", { time });
    });
  }

  /**
   * Swap in a different subtitle document, reusing the worker.
   *
   * Only safe while the new document needs the same fonts as the one this
   * renderer was constructed with -- `fallbackFont` is fixed at
   * construction (see ./fonts.ts). The style picker satisfies that because
   * every preset renders the same sample line.
   */
  setTrack(ass: string) {
    this.#renderer.setTrack(ass);
  }

  destroy() {
    this.#settle();
    this.#renderer.destroy();
  }
}
