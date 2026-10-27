// Burning subtitles into the video, entirely in the browser.
//
// The pipeline mirrors what the desktop app asks ffmpeg to do, with the
// same priorities:
//
//   demux -> decode -> composite libass over the frame -> encode -> mux
//                                        audio: copied, never re-encoded
//
// WebCodecs does the decode and encode (hardware-backed on most machines),
// mediabunny does the demux and mux, and libass rasterises the subtitles --
// so the text in the exported file is drawn by the same library ffmpeg's
// `ass` filter uses. That is the whole reason this is worth doing properly
// rather than screen-recording a `<video>` through `MediaRecorder`: a
// capture would be realtime, re-encode the audio, and bake in whatever the
// compositor felt like doing.
//
// # What is preserved, and what is not
//
// Preserved: audio packets are copied, never decoded and re-encoded (the
// desktop's Q1 claim) -- no AudioDecoder or AudioEncoder is constructed
// anywhere in this file. The exported file is not byte-identical to the
// source's audio, because the container repackages the same packets with
// its own sample tables, but the coded audio itself is untouched: measured
// against the source, speech onsets land on exactly the same instants.
// Subtitles are real libass output at the output resolution (Q4), and
// output timestamps come from the source samples rather than a synthetic
// clock, so variable frame rate survives (Q3).
//
// Not preserved: colour metadata. The browser gives a decoded frame, not
// the container's colour tags, so an HDR source is tone-mapped by the
// decoder in a way this code does not control and cannot describe. The CLI
// probes the real file and does this correctly; the page cannot. HDR
// sources are therefore flagged to the user rather than silently mangled.

import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
} from "mediabunny";

import { SubtitleRaster } from "./raster";
import { Say } from "./say";

export interface BurnOptions {
  file: File;
  /** The ASS document, generated at `width`x`height`, on the source timeline. */
  ass: string;
  width: number;
  height: number;
  /** Clip start on the source timeline. */
  start: number;
  /** Clip end, or `null` for the end of the source. */
  end: number | null;
  onProgress?: (fraction: number, note: string) => void;
  signal?: AbortSignal;
}

export interface BurnResult {
  blob: Blob;
  extension: "mp4" | "webm";
  /** True when the source had audio that could not be carried over. */
  audioDropped: boolean;
}

export interface BurnSupport {
  ok: boolean;
  codec: VideoCodec;
  container: "mp4" | "webm";
  /** Present when `ok` is false. */
  reason?: string;
}

/**
 * What this browser can actually produce, checked before the UI offers it.
 *
 * H.264 in MP4 is strongly preferred: it is what every phone, editor and
 * social platform ingests without re-encoding. VP9 in WebM is the fallback
 * for browsers without an H.264 encoder (some Linux builds, older Firefox).
 */
export async function burnSupport(
  width = 1280,
  height = 720,
): Promise<BurnSupport> {
  if (typeof VideoEncoder === "undefined") {
    return {
      ok: false,
      codec: "avc",
      container: "mp4",
      reason:
        "This browser has no WebCodecs video encoder. Chrome, Edge and Safari 16.4+ do; " +
        "Firefox is still catching up.",
    };
  }

  // Encoders care about dimensions, so ask about the real ones.
  const even = (n: number) => Math.max(2, n - (n % 2));
  const w = even(width);
  const h = even(height);

  if (await canEncodeVideo("avc", { width: w, height: h })) {
    return { ok: true, codec: "avc", container: "mp4" };
  }
  if (await canEncodeVideo("vp9", { width: w, height: h })) {
    return { ok: true, codec: "vp9", container: "webm" };
  }
  if (await canEncodeVideo("vp8", { width: w, height: h })) {
    return { ok: true, codec: "vp8", container: "webm" };
  }
  return {
    ok: false,
    codec: "avc",
    container: "mp4",
    reason: `This browser cannot encode video at ${w}x${h}.`,
  };
}

/**
 * A quality-led bitrate for the output size.
 *
 * The desktop encodes with `-crf 16`, a quality target rather than a rate.
 * WebCodecs has no CRF, so this approximates it: roughly 0.1 bits per pixel
 * per frame at 30fps, which is generous enough that the subtitle edges --
 * the first thing a starved encoder smears -- stay sharp.
 */
function bitrateFor(width: number, height: number): number {
  const perFrame = width * height * 0.1;
  return Math.round(Math.min(Math.max(perFrame * 30, 2_000_000), 40_000_000));
}

/**
 * A failure the person can act on, with the category the burn is counted
 * under and the name of the error behind it (never its message, which can
 * carry a file name).
 */
export type BurnFailure = Say & { category: string; ename: string };

function failure(say: Say, category: string, ename: string): BurnFailure {
  return Object.assign(say, { category, ename });
}

/**
 * The chosen file can no longer be read.
 *
 * A `File` from a picker is a reference to bytes on disk, checked against
 * the file as it was when it was chosen. If it has since been moved,
 * changed or deleted, or it is a cloud placeholder whose bytes never
 * arrived, Chromium fails every read: the demuxer then reports "Input has an
 * unsupported or unrecognizable format" when nothing was read at all, or a
 * TypeError "network error" when a read stream breaks. Both said the wrong
 * thing, and retrying the same `File` fails the same way every time. The
 * only cure is choosing the file again.
 */
function unreadable(error: unknown): BurnFailure {
  const name = (error as { name?: string } | null)?.name || "NotReadableError";
  return failure(
    new Say(
      "OpenSubs can no longer read this video. It may have been moved, changed or deleted since you chose it, or it is still in the cloud or still being saved. Save a copy on this device, then choose it again.",
    ),
    "file-read",
    name,
  );
}

/**
 * Read both ends of the file, so a file that has gone fails here, at once,
 * with a sentence that says what to do.
 *
 * Three ways it goes are checked: a read that throws; a read that comes
 * back short; and a size of zero -- Chromium re-reads a picked file's size,
 * so one deleted after it was chosen reports 0 bytes and every slice of it
 * reads "successfully" as nothing, which the demuxer then called an
 * unrecognizable format. Reading the whole of an empty file is what makes
 * the browser name the real cause (NotFoundError).
 */
async function checkReadable(file: File): Promise<void> {
  if (file.size === 0) {
    try {
      await file.arrayBuffer();
    } catch (error) {
      throw unreadable(error);
    }
    throw unreadable({ name: "EmptyFile" });
  }
  const edge = 64 * 1024;
  const ends = file.size > edge ? [[0, edge], [file.size - edge, file.size]] : [[0, file.size]];
  for (const [from, to] of ends) {
    let got: number;
    try {
      got = (await file.slice(from, to).arrayBuffer()).byteLength;
    } catch (error) {
      throw unreadable(error);
    }
    if (got !== to - from) throw unreadable({ name: "ShortRead" });
  }
}

/** A read failure from the demuxer, said as what it is. */
async function demuxFailure(file: File, error: unknown): Promise<unknown> {
  const e = error as { name?: string; message?: string } | null;
  if (e?.name === "AbortError") return error;
  // A file that went away mid-read looks like a bad format; ask the file.
  try {
    await checkReadable(file);
  } catch (gone) {
    return gone;
  }
  if (e?.name === "TypeError" && /^network error$/i.test(e?.message ?? "")) return unreadable(error);
  if (e?.name === "UnsupportedInputFormatError" || /unsupported or unrecognizable format/i.test(e?.message ?? "")) {
    return failure(
      new Say("This video's format cannot be read for burning here. Convert it to MP4 and choose it again."),
      "unsupported-format",
      e?.name || "UnsupportedInputFormatError",
    );
  }
  return error;
}

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

export async function burnInBrowser(options: BurnOptions): Promise<BurnResult> {
  const { file, ass, width, height, start, end, onProgress, signal } = options;

  const support = await burnSupport(width, height);
  if (!support.ok) throw new Error(support.reason ?? "Encoding is not supported here.");

  onProgress?.(0, "Reading the video");
  await checkReadable(file);

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const { videoTrack, sourceDuration } = await (async () => {
    try {
      const track = await input.getPrimaryVideoTrack();
      if (!track) throw new Error("That file has no video track.");
      return { videoTrack: track, sourceDuration: await input.computeDuration() };
    } catch (error) {
      input.dispose();
      throw await demuxFailure(file, error);
    }
  })();
  // Said here, before anything is set up, rather than as a decode error on
  // the first frame.
  if (!(await videoTrack.canDecode().catch(() => true))) {
    input.dispose();
    throw failure(
      new Say("This browser cannot decode this video ({codec}). Convert it to MP4 (H.264) and choose it again.", {
        codec: String(videoTrack.codec ?? "unknown"),
      }),
      "codec-unsupported",
      "NotSupportedError",
    );
  }
  const clipStart = Math.max(0, start);
  const clipEnd = end != null && end > clipStart ? Math.min(end, sourceDuration) : sourceDuration;
  const clipDuration = Math.max(0, clipEnd - clipStart);
  if (clipDuration <= 0) throw new Error("The clip has no length.");

  const output = new Output({
    format:
      support.container === "mp4" ? new Mp4OutputFormat() : new WebMOutputFormat(),
    target: new BufferTarget(),
  });

  // The canvas everything is composited onto, and the encoder's input.
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("This browser gave us no 2D canvas context.");

  const videoSource = new CanvasSource(canvas, {
    codec: support.codec,
    bitrate: bitrateFor(width, height),
  });
  output.addVideoTrack(videoSource);

  // Audio: copied, not re-encoded. The packets are handed to the muxer
  // exactly as they came out of the source container.
  const audioTrack = await input.getPrimaryAudioTrack();
  let audioSource: EncodedAudioPacketSource | null = null;
  let audioDropped = false;
  if (audioTrack) {
    try {
      const codec = audioTrack.codec as AudioCodec | null;
      if (codec && output.format.getSupportedAudioCodecs().includes(codec)) {
        audioSource = new EncodedAudioPacketSource(codec);
        output.addAudioTrack(audioSource);
      } else {
        // e.g. AAC into WebM, which the container cannot hold. Re-encoding
        // would violate the one audio promise this project makes, so the
        // honest move is to drop it and say so rather than quietly
        // degrade it.
        audioDropped = true;
      }
    } catch {
      audioDropped = true;
    }
  }

  const raster = await SubtitleRaster.create(ass, width, height);

  try {
    await output.start();
    assertNotAborted(signal);

    // --- audio first: copying packets is cheap and bounded -------------
    if (audioTrack && audioSource) {
      onProgress?.(0, "Copying audio");
      const decoderConfig = await audioTrack.getDecoderConfig();
      const packetSink = new EncodedPacketSink(audioTrack);
      let first = true;
      for await (const packet of packetSink.packets()) {
        assertNotAborted(signal);
        if (packet.timestamp + packet.duration <= clipStart) continue;
        if (packet.timestamp >= clipEnd) break;
        // Rebase onto the clip's own clock, which starts at zero.
        const shifted = packet.clone({ timestamp: packet.timestamp - clipStart });
        audioSource.add(
          shifted,
          first && decoderConfig ? { decoderConfig } : undefined,
        );
        first = false;
      }
    }

    // --- video: decode, composite, encode ------------------------------
    const sampleSink = new VideoSampleSink(videoTrack);
    let frames = 0;
    // Said before the first frame, not after the fifth, so a failure on
    // frame one is reported as the burn and not as the audio copy.
    onProgress?.(0, "Burning 0%");

    for await (const sample of sampleSink.samples(clipStart, clipEnd)) {
      assertNotAborted(signal);

      // libass is asked for the *source* time, because that is the
      // timeline the ASS document was written on -- exactly the rule the
      // desktop follows when it burns a trimmed clip.
      await raster.render(sample.timestamp);

      // Picture first, subtitles over it -- the obvious order, and the only
      // one that works. Drawing the subtitles first and slipping the frame
      // underneath with `destination-over` composites onto nothing: the
      // context is `alpha: false`, so the canvas is already opaque and
      // there is no transparency for the picture to land in. That produced
      // a perfectly subtitled black video.
      //
      // `draw` applies the source's rotation and pixel aspect ratio, and
      // scales to the output size in one step.
      sample.draw(ctx, 0, 0, width, height);
      ctx.drawImage(raster.canvas, 0, 0, width, height);

      const timestamp = Math.max(0, sample.timestamp - clipStart);
      await videoSource.add(timestamp, sample.duration);
      sample.close();

      frames += 1;
      if (frames % 5 === 0) {
        const done = Math.min(1, timestamp / clipDuration);
        onProgress?.(done, `Burning ${Math.round(done * 100)}%`);
      }
    }

    onProgress?.(1, "Finishing the file");
    await output.finalize();

    const buffer = (output.target as BufferTarget).buffer;
    if (!buffer) throw new Error("The muxer produced no output.");

    return {
      blob: new Blob([buffer], {
        type: support.container === "mp4" ? "video/mp4" : "video/webm",
      }),
      extension: support.container,
      audioDropped,
    };
  } catch (error) {
    // Leave no half-written muxer behind; a cancelled export must not
    // wedge the next one.
    await output.cancel().catch(() => {});
    // The file is read again for every frame, so it can go away mid-burn.
    const e = error as { name?: string; message?: string } | null;
    if (e?.name === "TypeError" && /^network error$/i.test(e?.message ?? "")) throw await demuxFailure(file, error);
    if (e?.name === "NotReadableError" || e?.name === "NotFoundError") throw unreadable(error);
    throw error;
  } finally {
    raster.destroy();
    input.dispose();
  }
}
