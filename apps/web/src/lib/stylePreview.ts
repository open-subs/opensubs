// Thumbnails for the style picker, rendered by libass.
//
// The obvious implementation is CSS: a div with the preset's colour, a
// text-shadow standing in for the outline, a background for the box. It
// would be a fraction of this code and it would be a lie — the whole point
// of this app is that what you see is what gets burned, and a CSS lookalike
// drifts from libass on exactly the things a style is chosen for (outline
// weight, box padding, vertical position, CJK shaping).
//
// So the thumbnails come from the same renderer as the preview and the
// burn. One JASSUB instance is reused across every preset rather than one
// per tile: each instance is a worker plus a 2 MB wasm module, and twelve
// of those would cost more than the feature is worth.

import { SubtitleRaster } from "./raster";
import { writeAss, type Cue } from "./engine";

/**
 * Longest edge of the internal render. The tile shows a *crop* of this.
 *
 * Subtitle size is a percentage of frame height, so a whole-frame
 * thumbnail at tile resolution produces ~5px text: proportionally correct
 * and useless for judging a typeface. Rendering large and cropping to the
 * band the subtitle occupies keeps the type legible and the proportions
 * honest.
 */
const RENDER_LONG_EDGE = 960;

/**
 * How much of the frame height the crop keeps, centred on the subtitle.
 *
 * Uniform across presets on purpose: cropping each one tightly to its own
 * text would make every tile a different shape, and the grid would look
 * broken. 30% comfortably contains two lines of even the largest preset.
 */
const BAND_FRACTION = 0.3;

/** Long enough to show wrapping behaviour, short enough to stay readable. */
const SAMPLE_TEXT = "The words, burned in";

export interface StyleThumbnail {
  name: string;
  /** A data URL, ready for an <img>. */
  url: string;
}

export interface ThumbnailOptions {
  /** Preset names to render, in order. */
  styles: string[];
  /**
   * The video's display dimensions. The render matches this aspect ratio,
   * so a portrait clip is previewed portrait rather than squashed into a
   * landscape tile.
   */
  aspect?: { width: number; height: number };
  /**
   * A frame from the user's own video, drawn behind the subtitle. Nothing
   * conveys "is this legible over my footage" like the actual footage.
   */
  background?: CanvasImageSource | null;
  /** Defaults to a neutral sample line. */
  text?: string;
  signal?: AbortSignal;
}

/**
 * Render one thumbnail per preset.
 *
 * Sequential on purpose: the renderer is single-threaded behind a worker,
 * and firing twelve overlapping demands at it interleaves their results.
 */
export async function renderStyleThumbnails(
  options: ThumbnailOptions,
): Promise<StyleThumbnail[]> {
  const { styles, background, text, signal, aspect } = options;
  if (styles.length === 0) return [];

  const line = (text ?? SAMPLE_TEXT).trim() || SAMPLE_TEXT;
  const cue: Cue = { start: 0, end: 10, lines: [line] };

  // Match the source's shape. An ASS document is resolution-bound and
  // subtitle geometry is expressed in percentages of height, so rendering
  // a portrait clip at 16:9 would misplace and mis-size everything before
  // any cropping happened.
  const { width: RENDER_WIDTH, height: RENDER_HEIGHT } = renderSize(aspect);
  const bandHeight = Math.round(RENDER_HEIGHT * BAND_FRACTION);

  const composite = document.createElement("canvas");
  composite.width = RENDER_WIDTH;
  composite.height = RENDER_HEIGHT;
  const ctx = composite.getContext("2d");
  if (!ctx) return [];

  // The tile: the subtitle band only, at the source's own width.
  const tile = document.createElement("canvas");
  tile.width = RENDER_WIDTH;
  tile.height = bandHeight;
  const tileCtx = tile.getContext("2d");
  if (!tileCtx) return [];

  // The first preset's document decides which fonts the renderer loads,
  // and that is fixed for its lifetime — so build it from every preset's
  // text at once. In practice they all share `line`, but a CJK sample
  // must reach the font chooser on the first construction, not the third.
  const first = writeAss([cue], styles[0], RENDER_WIDTH, RENDER_HEIGHT);
  const raster = await SubtitleRaster.create(first, RENDER_WIDTH, RENDER_HEIGHT);

  const out: StyleThumbnail[] = [];
  try {
    for (const name of styles) {
      if (signal?.aborted) break;

      let ass: string;
      try {
        ass = writeAss([cue], name, RENDER_WIDTH, RENDER_HEIGHT);
      } catch {
        // A preset that will not render is simply not offered a thumbnail;
        // the tile falls back to its colour swatch.
        continue;
      }

      raster.setTrack(ass);
      await raster.render(1);

      drawBackground(ctx, background, RENDER_WIDTH, RENDER_HEIGHT);
      ctx.drawImage(raster.canvas, 0, 0, RENDER_WIDTH, RENDER_HEIGHT);

      // Crop to where this preset actually put its text, measured from the
      // rendered pixels rather than recomputed from the style's alignment
      // and margin -- libass is the authority on where the text landed.
      const centre = inkCentre(raster.canvas, RENDER_WIDTH, RENDER_HEIGHT);
      const top = clamp(
        Math.round((centre ?? RENDER_HEIGHT * 0.85) - bandHeight / 2),
        0,
        Math.max(0, RENDER_HEIGHT - bandHeight),
      );
      tileCtx.clearRect(0, 0, RENDER_WIDTH, bandHeight);
      tileCtx.drawImage(
        composite,
        0, top, RENDER_WIDTH, bandHeight,
        0, 0, RENDER_WIDTH, bandHeight,
      );
      out.push({ name, url: tile.toDataURL("image/webp", 0.85) });
    }
  } finally {
    raster.destroy();
  }

  return out;
}

/** Render dimensions matching the source's aspect, longest edge capped. */
function renderSize(aspect?: { width: number; height: number }): {
  width: number;
  height: number;
} {
  const w = aspect?.width ?? 16;
  const h = aspect?.height ?? 9;
  if (w <= 0 || h <= 0) return { width: 960, height: 540 };
  const scale = RENDER_LONG_EDGE / Math.max(w, h);
  return {
    width: Math.max(2, Math.round(w * scale)),
    height: Math.max(2, Math.round(h * scale)),
  };
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

/**
 * The vertical centre of whatever libass drew, or null if it drew nothing.
 *
 * Scans the alpha channel row by row; the subtitle is the only thing on
 * this canvas, so any opaque pixel is text.
 */
function inkCentre(canvas: HTMLCanvasElement, width: number, height: number): number | null {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { data } = ctx.getImageData(0, 0, width, height);
  let top = -1;
  let bottom = -1;
  for (let y = 0; y < height; y += 1) {
    let rowHasInk = false;
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x += 1) {
      if (data[rowStart + x * 4 + 3] > 8) {
        rowHasInk = true;
        break;
      }
    }
    if (rowHasInk) {
      if (top < 0) top = y;
      bottom = y;
    }
  }
  return top < 0 ? null : (top + bottom) / 2;
}

/**
 * The frame behind the subtitle.
 *
 * The fallback is a mid-grey gradient rather than a flat colour: a style
 * with a dark outline and one with a light box look identical against
 * uniform grey, and telling them apart is the entire job of this picker.
 */
function drawBackground(
  ctx: CanvasRenderingContext2D,
  background: CanvasImageSource | null | undefined,
  width: number,
  height: number,
) {
  ctx.clearRect(0, 0, width, height);
  if (background) {
    try {
      ctx.drawImage(background, 0, 0, width, height);
      return;
    } catch {
      // A tainted or not-yet-ready source falls through to the gradient.
    }
  }
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, "#5b6b7a");
  gradient.addColorStop(0.5, "#2b333c");
  gradient.addColorStop(1, "#7d6a58");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}

/**
 * Grab the current frame of a video, for use as a thumbnail background.
 *
 * Retries, because a single attempt is not reliable. `readyState` reaching
 * HAVE_ENOUGH_DATA is not a promise that `drawImage` will copy anything:
 * called right after a layout change, it returns a fully transparent
 * canvas — no exception, no warning, just nothing — and a few hundred
 * milliseconds later the identical call on the identical element works.
 * So this checks whether any pixels actually arrived and tries again if
 * not, rather than trusting the element's own readiness flags.
 *
 * Returns null when there is still nothing after `attempts`, or when the
 * browser refuses the read: a cross-origin source taints the canvas, and
 * the picker falls back to its gradient rather than failing.
 */
export async function captureFrame(
  video: HTMLVideoElement | null,
  attempts = 6,
  delayMs = 120,
): Promise<HTMLCanvasElement | null> {
  if (!video || !video.videoWidth || video.readyState < 2) return null;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(video, 0, 0);

      // Sample a coarse grid rather than the whole frame: this runs on
      // every attempt and a full 1080p readback is far more work than the
      // question needs.
      if (hasPixels(ctx, canvas.width, canvas.height)) return canvas;
    } catch {
      // A tainted canvas will never succeed; stop trying.
      return null;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return null;
}

function hasPixels(ctx: CanvasRenderingContext2D, width: number, height: number): boolean {
  const step = Math.max(1, Math.floor(Math.min(width, height) / 16));
  for (let y = step; y < height; y += step) {
    for (let x = step; x < width; x += step) {
      if (ctx.getImageData(x, y, 1, 1).data[3] > 0) return true;
    }
  }
  return false;
}
