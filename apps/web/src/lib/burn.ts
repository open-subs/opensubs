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

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
}

export async function burnInBrowser(options: BurnOptions): Promise<BurnResult> {
  const { file, ass, width, height, start, end, onProgress, signal } = options;

  const support = await burnSupport(width, height);
  if (!support.ok) throw new Error(support.reason ?? "Encoding is not supported here.");

  onProgress?.(0, "Reading the video");

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) throw new Error("That file has no video track.");

  const sourceDuration = await input.computeDuration();
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
    throw error;
  } finally {
    raster.destroy();
    input.dispose();
  }
}
