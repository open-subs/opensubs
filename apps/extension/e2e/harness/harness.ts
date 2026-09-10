/**
 * The extension's pipeline, wired up in a plain page.
 *
 * Chrome 137 stopped honouring `--load-extension`, and on Chrome 153 the
 * CDP `Extensions.loadUnpacked` route loads an extension that never starts
 * its service worker. So the packaged extension cannot currently be driven
 * from an automated browser at all.
 *
 * That is a limit on testing the *host*, not on testing the product. The
 * risk in this extension is not the message routing -- it is whether real
 * audio comes off a real video element, whether the recorded container
 * decodes, whether the model loads under an extension-shaped CSP, and
 * whether what comes back is a transcript rather than hallucinated music.
 * All of that is these modules, imported here exactly as the extension
 * imports them, and run against a real file.
 */

import { capture, findMedia, recordWindows } from "../../src/lib/capture";
import { Input, BlobSource, ALL_FORMATS, AudioBufferSink } from "mediabunny";
import { createEngine } from "../../src/engine/engine";
import { stitch, toSrt } from "../../src/lib/seam";
import type { Cue, Settings } from "../../src/lib/protocol";

declare global {
  interface Window {
    runPipeline(settings: Settings, windows: number): Promise<unknown>;
    __log: string[];
    __probe: unknown;
  }
}

/**
 * Decode one recorded window two ways and report what each got.
 *
 * Whisper answers "Thank you." to silence, and that answer is
 * indistinguishable from a transcript until you look at the samples. This
 * says whether the container decoded at all, and how loud what came out
 * of it was.
 */
async function probeBlob(blob: Blob) {
  const out: Record<string, unknown> = { size: blob.size, type: blob.type };
  try {
    const ctx = new OfflineAudioContext(1, 1, 48000);
    const buf = await ctx.decodeAudioData(await blob.slice(0).arrayBuffer());
    const d = buf.getChannelData(0);
    let sum = 0;
    for (const v of d) sum += v * v;
    out.webAudio = { frames: d.length, seconds: +(d.length / buf.sampleRate).toFixed(2), rms: +Math.sqrt(sum / d.length).toFixed(5) };
  } catch (e) {
    out.webAudio = `threw: ${(e as Error).message}`;
  }
  try {
    const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const track = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    if (!track) { out.mediabunny = "no audio track"; }
    else {
      const sink = new AudioBufferSink(track);
      let frames = 0, sum = 0, rate = 0;
      for await (const w of sink.buffers(0, duration || 60)) {
        const d = w.buffer.getChannelData(0);
        rate = w.buffer.sampleRate;
        frames += d.length;
        for (const v of d) sum += v * v;
      }
      out.mediabunny = { duration, frames, seconds: rate ? +(frames / rate).toFixed(2) : 0, rms: frames ? +Math.sqrt(sum / frames).toFixed(5) : 0 };
    }
  } catch (e) {
    out.mediabunny = `threw: ${(e as Error).message}`;
  }
  return out;
}

const logEl = document.getElementById("log") as HTMLPreElement;
window.__log = [];
const log = (line: string) => {
  window.__log.push(line);
  logEl.textContent = window.__log.slice(-14).join("\n");
};

window.runPipeline = async (settings, windows) => {
  const media = findMedia();
  if (!media) return { error: "no media element" };
  media.muted = false;
  media.volume = 0.0001;
  await media.play();

  let cues: Cue[] = [];
  let failure: string | null = null;
  let finished = 0;

  const engine = createEngine((m) => {
    if (m.kind === "status") log(`${m.status.stage}: ${m.status.note}${m.status.fraction !== null ? ` ${Math.round(m.status.fraction * 100)}%` : ""}`);
    if (m.kind === "failed") { failure = m.message; log(`FAILED ${m.message}`); }
    if (m.kind === "segments") {
      cues = stitch(cues, m.cues);
      finished += 1;
      log(`window at ${m.offset.toFixed(1)}s -> ${m.cues.length} cues (${cues.length} total)`);
    }
  });

  const stream = capture(media);
  log(`audio tracks: ${stream.getAudioTracks().length}`);

  // Measure what is actually on the wire. A silent capture and a working
  // one look identical from the outside until Whisper answers "Thank you."
  // -- which is what it says about silence, and reads like a transcript.
  const ctx = new AudioContext();
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  ctx.createMediaStreamSource(stream).connect(analyser);
  const frame = new Float32Array(analyser.fftSize);
  let peak = 0;
  const meter = setInterval(() => {
    analyser.getFloatTimeDomainData(frame);
    for (const v of frame) peak = Math.max(peak, Math.abs(v));
  }, 100);

  let sent = 0;
  await recordWindows(
    media,
    stream,
    settings.window,
    async (w) => {
      sent += 1;
      log(`recorded window ${sent}: ${(w.blob.size / 1024).toFixed(0)} KB ${w.blob.type} at ${w.offset.toFixed(1)}s`);
      if (sent === 1) window.__probe = await probeBlob(w.blob);
      engine.handle({
        kind: "transcribe",
        audio: await w.blob.arrayBuffer(),
        mime: w.blob.type,
        offset: w.offset,
        settings,
      });
    },
    () => sent < windows,
  );

  // The engine runs behind capture by design; wait for it to catch up.
  const deadline = Date.now() + 240_000;
  while (finished < 1 && !failure && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
  }
  media.pause();
  clearInterval(meter);
  await ctx.close();
  log(`peak captured level: ${peak.toFixed(4)}`);

  return {
    probe: window.__probe,
    peak,
    playedTo: media.currentTime,
    failure,
    windowsSent: sent,
    windowsDone: finished,
    cues: cues.length,
    srt: toSrt(cues),
    text: cues.map((c) => c.text).join(" "),
  };
};

log("ready");
