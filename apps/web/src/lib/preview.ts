// Live subtitle preview, rendered by libass itself.
//
// This is the reason the browser preview is worth trusting. JASSUB is
// libass compiled to wasm, and libass is exactly what ffmpeg's `ass` filter
// uses when the desktop app burns a video. So the glyphs, the outlines, the
// line positions and the timing you see over the `<video>` element are
// produced by the same renderer that will produce the exported pixels --
// not by a CSS approximation that drifts from the real output.
//
// The alternative (drawing cue text with the Canvas API or DOM elements)
// would have been far less code and would have quietly lied about outline
// width, alignment, margins and CJK shaping.
//
// # Fonts, and the two ways this goes silently wrong
//
// JASSUB defaults to `availableFonts: {'liberation sans': './default.woff2'}`
// with `fallbackFont: 'liberation sans'`. Both halves of that default are
// traps here:
//
//  1. The URL is *relative*. It resolves next to the page in dev, where the
//     file happens to sit under /node_modules/, and 404s in a built bundle
//     where the worker lives in hashed /assets/. So the production build
//     had no font at all.
//  2. The key is the literal string `liberation sans` -- lowercase, with a
//     space. Supplying the font under any other key (`default`, say) leaves
//     `fallbackFont` pointing at nothing.
//
// Either mistake produces the same symptom, and it is a nasty one: libass
// logs `fontselect: failed to find any fallback`, emits **zero** bitmaps,
// throws nothing, and the video plays or exports with no subtitles on it.
// Passing the bundler-resolved URL under the exact expected key fixes both.

import JASSUB from "jassub";
import workerUrl from "jassub/dist/jassub-worker.js?url";
import wasmUrl from "jassub/dist/jassub-worker.wasm?url";
import fallbackFontUrl from "jassub/dist/default.woff2?url";
import { fontSetupFor } from "./fonts";

export interface Preview {
  /** Swap in a newly generated ASS document without recreating the worker. */
  update(ass: string): void;
  destroy(): void;
}

/**
 * JASSUB internals used to force a repaint. Not in its published types.
 */
interface Repaintable {
  setTrack(content: string): void;
  sendMessage(target: string, data?: unknown): void;
  destroy(): void;
}

/**
 * Attach a libass renderer to `video`.
 *
 * `ass` must have been generated at the video's *intrinsic* size, since an
 * ASS document is resolution-bound; JASSUB scales the rendered result to
 * whatever size the element happens to be on screen, which is the same
 * thing a player does.
 */
export async function attachPreview(
  video: HTMLVideoElement,
  ass: string,
): Promise<Preview> {
  // The font set depends on what the subtitles actually say -- see
  // ./fonts.ts. It is fixed for the life of a JASSUB instance, so
  // `attachPreview` must be called again when the script changes (a
  // translation into Chinese, say); `update()` alone would keep the old
  // fallback and draw tofu.
  const renderer = new JASSUB({
    video,
    subContent: ass,
    workerUrl,
    wasmUrl,
    // Cast: JASSUB accepts font bytes but types the map as strings.
      ...((await fontSetupFor(ass, fallbackFontUrl)) as unknown as {
        availableFonts: Record<string, string>;
        fallbackFont: string;
      }),
  });

  const control = renderer as unknown as Repaintable;

  /**
   * Force libass to draw `video.currentTime` again.
   *
   * Required whenever the subtitles change while playback is paused, which
   * is most of the time in an editor. JASSUB renders on
   * `requestVideoFrameCallback`, and a paused video presents no frames --
   * so `setTrack` alone updates the worker's copy of the subtitles and
   * nothing on screen changes. Toggling a style or the emphasis switch
   * appeared to do nothing at all until you pressed play.
   *
   * `demand` is the worker's one-shot render for an exact timestamp, the
   * same message the burn's rasteriser uses.
   */
  const repaint = () => {
    try {
      control.sendMessage("demand", { time: video.currentTime });
    } catch {
      // A destroyed or not-yet-ready worker simply misses this frame.
    }
  };

  // Scrubbing while paused has the same problem, so redraw on seek too.
  const onSeeked = () => repaint();
  video.addEventListener("seeked", onSeeked);

  return {
    update(next: string) {
      control.setTrack(next);
      // After the track, so the worker has the new subtitles to draw.
      repaint();
    },
    destroy() {
      video.removeEventListener("seeked", onSeeked);
      renderer.destroy();
    },
  };
}
