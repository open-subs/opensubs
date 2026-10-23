/**
 * Recorded windows, replayed through the extension's engine.
 *
 * `pipeline.mjs` records a video in real time, which is the honest test of
 * capture but takes as long as the film and records differently each run.
 * What this one tests is what the engine does with a *sequence* of windows
 * on "Automatic" language -- which language it settles on and whether it
 * stays there -- so it hands the engine windows cut beforehand, the same
 * length, overlap and container the recorder makes, and gets the same
 * answer every time.
 */
import { createEngine } from "../../src/engine/engine";
import { capture, recordWindows } from "../../src/lib/capture";
import { transcribeLocally, loadLocalModel, probeLanguageCells } from "../../../web/src/lib/asr";
import { stitch, toSrt } from "../../src/lib/seam";
import { blobToWire, type Cue, type Settings } from "../../src/lib/protocol";

interface Planned {
  url: string;
  offset: number;
  mime: string;
}

declare global {
  interface Window {
    replay(windows: Planned[], settings: Settings): Promise<unknown>;
    transcribeFile(url: string, model: string): Promise<unknown>;
    probeCells(url: string, model: string): Promise<unknown>;
    live(url: string, settings: Settings, stutter: { every: number; hold: number } | null): Promise<unknown>;
    __log: string[];
  }
}

const logEl = document.getElementById("log") as HTMLPreElement;
window.__log = [];
const log = (line: string) => {
  window.__log.push(line);
  logEl.textContent = window.__log.slice(-20).join("\n");
};

window.replay = async (windows, settings) => {
  let cues: Cue[] = [];
  const perWindow: { offset: number; cues: Cue[] }[] = [];
  const notes: string[] = [];
  let failure: string | null = null;
  let finished = 0;

  const engine = createEngine((m) => {
    if (m.kind === "status") {
      const note = m.status.note;
      if (note && notes[notes.length - 1] !== note) notes.push(note);
    }
    if (m.kind === "failed") {
      failure = m.message;
      log(`FAILED ${m.message}`);
    }
    if (m.kind === "segments") {
      perWindow.push({ offset: m.offset, cues: m.cues });
      cues = stitch(cues, m.cues);
      finished += 1;
      log(`window at ${m.offset.toFixed(1)}s -> ${m.cues.map((c) => c.text).join(" | ")}`);
    }
  });

  // As the background does on Start.
  engine.handle({ kind: "warm", model: settings.model, backend: settings.backend });

  // Handed over one at a time, as the recorder does, rather than all at
  // once: the engine's queue and its "fallen behind" switch see the same
  // traffic they would see live, compressed in time.
  for (const w of windows) {
    const blob = await (await fetch(w.url)).blob();
    engine.handle({
      kind: "transcribe",
      audio: await blobToWire(new Blob([blob], { type: w.mime })),
      mime: w.mime,
      offset: w.offset,
      settings,
    });
    await new Promise((r) => setTimeout(r, 50));
  }

  const deadline = Date.now() + 30 * 60_000;
  while (finished < windows.length && !failure && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }

  return { finished, failure, notes, perWindow, cues, srt: toSrt(cues) };
};

/**
 * A real capture: the video plays in this page and is recorded as the
 * extension records it, in real time. With `stutter`, playback is held for
 * `hold` seconds every `every` seconds, as a buffering or overloaded player
 * holds it -- the recorder keeps running, so each hold is a stretch of
 * whatever the browser hands a capture of a stalled element.
 */
window.live = async (url, settings, stutter) => {
  const media = document.createElement("video");
  media.src = url;
  media.muted = false;
  media.volume = 0.0001;
  document.body.prepend(media);
  await new Promise((r) => media.addEventListener("canplay", r, { once: true }));
  await media.play();

  let cues: Cue[] = [];
  const perWindow: { offset: number; cues: Cue[] }[] = [];
  const notes: string[] = [];
  let failure: string | null = null;
  let sent = 0;
  let finished = 0;
  const engine = createEngine((m) => {
    if (m.kind === "status" && m.status.note && notes[notes.length - 1] !== m.status.note) notes.push(m.status.note);
    if (m.kind === "failed") failure = m.message;
    if (m.kind === "segments") {
      perWindow.push({ offset: m.offset, cues: m.cues });
      cues = stitch(cues, m.cues);
      finished += 1;
      log(`window at ${m.offset.toFixed(1)}s -> ${m.cues.map((c) => c.text).join(" | ")}`);
    }
  });
  engine.handle({ kind: "warm", model: settings.model, backend: settings.backend });

  let stalls = 0;
  const holder = stutter
    ? setInterval(() => {
        if (media.ended) return;
        media.pause();
        stalls += 1;
        setTimeout(() => void media.play(), stutter.hold * 1000);
      }, stutter.every * 1000)
    : null;

  const stream = capture(media);
  await recordWindows(
    media,
    stream,
    settings.window,
    async (w) => {
      sent += 1;
      engine.handle({ kind: "transcribe", audio: await blobToWire(w.blob), mime: w.blob.type, offset: w.offset, settings });
    },
    () => !media.ended,
  );
  if (holder) clearInterval(holder);
  const deadline = Date.now() + 30 * 60_000;
  while (finished < sent && !failure && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 500));
  }
  return { finished, sent, stalls, failure, notes, perWindow, cues, srt: toSrt(cues) };
};

/**
 * The whole file at once, as the web app transcribes an upload: the same
 * call with the language left on "auto", so the file path is held to the
 * same standard as a capture.
 */
window.transcribeFile = async (url, model) => {
  const blob = await (await fetch(url)).blob();
  const file = new File([blob], url.split("/").pop() ?? "clip", { type: blob.type });
  const notes: string[] = [];
  const result = await transcribeLocally({
    file,
    model,
    device: "wasm",
    language: undefined,
    start: 0,
    end: null,
    onProgress: (p) => {
      if (notes[notes.length - 1] !== p.note) notes.push(p.note);
    },
  });
  const cues = result.transcript.segments.map((s) => ({ start: s.start, end: s.end, text: s.text.trim() }));
  return { finished: 1, failure: null, notes, languages: result.languages, perWindow: [], cues, srt: toSrt(cues) };
};

/**
 * What Whisper reads in every four-second cell of the file, unsmoothed: the
 * language it names, how sure it is, and how likely it thinks silence is.
 * The raw material every rule above is built on.
 */
window.probeCells = async (url, model) => {
  const blob = await (await fetch(url)).blob();
  const buf = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const decoded = await ctx.decodeAudioData(buf);
  const oc = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
  const src = oc.createBufferSource();
  src.buffer = decoded;
  src.connect(oc.destination);
  src.start();
  const mono = (await oc.startRendering()).getChannelData(0);
  await loadLocalModel({ model, device: "wasm" });
  return { cells: await probeLanguageCells(mono) };
};

(document.getElementById("log") as HTMLElement).textContent = "ready";
