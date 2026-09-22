/**
 * The half that lives in the page: find the video, take its audio, and put
 * the subtitles back on top of it.
 *
 * The capture itself is in `lib/capture.ts` -- it is the part with the
 * browser differences in it, and it is the part worth testing on real
 * pages, so it is kept out of here where a test would need an extension
 * host to reach it.
 */

import { api, blobToWire, tell, type BeginAnswer, type Cue, type FromPage, type Settings, type ToPage } from "../lib/protocol";
import { findMedia, openAudio, recordWindows, waitForPlaying, whyNoMedia } from "../lib/capture";
import { cueAt } from "../lib/seam";

const HOST_ID = "opensubs-overlay-host";

let media: HTMLMediaElement | null = null;
let stream: MediaStream | null = null;
let running = false;
let cues: Cue[] = [];
let settings: Settings | null = null;
let host: HTMLElement | null = null;
let line: HTMLElement | null = null;
let note: HTMLElement | null = null;
let ticker: number | null = null;

/**
 * The subtitle sits in a closed shadow root inside a fixed-position host.
 *
 * Closed, because the page's own stylesheet is not ours to fight: a site
 * with `* { text-transform: uppercase }` or a z-index war would otherwise
 * reach in. Fixed rather than appended to the player, because appending
 * inside the player subtree gets the node destroyed the moment the site
 * re-renders its controls, and several do that on every mouse move.
 */
function ensureOverlay() {
  if (host && host.isConnected) return;
  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:2147483647;pointer-events:none;";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    .wrap { display:flex; flex-direction:column; align-items:center; gap:6px;
            padding:0 4vw 4vh; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    .line { max-width:min(90vw, 1100px); text-align:center; color:#fff;
            background:rgba(0,0,0,.72); border-radius:6px; padding:.25em .6em;
            line-height:1.35; font-weight:500; text-shadow:0 1px 3px rgba(0,0,0,.9);
            white-space:pre-wrap; }
    .line:empty { display:none; }
    .note { font-size:12px; color:#fff; background:rgba(0,0,0,.6);
            border-radius:99px; padding:3px 10px; }
    .note:empty { display:none; }
  `;
  const wrap = document.createElement("div");
  wrap.className = "wrap";
  line = document.createElement("div");
  line.className = "line";
  note = document.createElement("div");
  note.className = "note";
  wrap.append(line, note);
  root.append(style, wrap);
  document.documentElement.appendChild(host);
}

function removeOverlay() {
  host?.remove();
  host = null;
  line = null;
  note = null;
}

function paint() {
  if (!line || !media) return;
  const cue = cueAt(cues, media.currentTime);
  const text = cue ? cue.text : "";
  if (line.textContent !== text) line.textContent = text;
  line.style.fontSize = `calc((1.6vw + 12px) * ${settings?.fontScale ?? 1})`;
}

/**
 * How long to wait, when the video being read ends, for another to start:
 * after an ad the film begins a second or two later, in the same element
 * with a new source or in another one.
 */
const SWITCH_WAIT_MS = 8000;

/** Counts the videos read this session; see FromPage "window". */
let take = 0;

/**
 * Find the video, open its audio, and answer -- then record, without making
 * the answer wait for it. The answer is the reply to "begin" itself, so
 * nothing the background says afterwards can overwrite it (APP-133).
 */
async function begin(next: Settings): Promise<BeginAnswer> {
  settings = next;
  const el = findMedia();
  if (!el) return { found: false, reason: whyNoMedia() };
  const opened = openAudio(el);
  if ("reason" in opened) return { found: false, reason: opened.reason };

  media = el;
  stream = opened.stream;
  take += 1;
  cues = [];
  running = true;
  if (settings.overlay) {
    ensureOverlay();
    ticker = window.setInterval(paint, 120);
  }
  void record();
  return { found: true, duration: el.duration || 0 };
}

/**
 * Record whatever is playing, for as long as the session runs.
 *
 * Starting on an ad was the third case in APP-133: the largest playing video
 * at Start was a fifteen-second pre-roll, and when it ended the extension
 * went on saying "Listening" over a film it was not reading. So when the
 * video being read ends or is replaced, this looks for what is playing now
 * and moves to it -- a new take, whose lines replace the last one's. If
 * nothing starts, the video simply finished, and the page says so.
 */
async function record() {
  while (running && media && stream && settings) {
    const el = media;
    let replaced = false;
    const onEmptied = () => { replaced = true; };
    el.addEventListener("emptied", onEmptied, { once: true });
    try {
      const mine = take;
      await recordWindows(
        el,
        stream,
        settings.window,
        async (w) => {
          const audio = await blobToWire(w.blob);
          await tell<FromPage>({ kind: "window", audio, mime: w.blob.type, offset: w.offset, take: mine });
        },
        () => running && !replaced,
      );
    } catch (e) {
      await tell<FromPage>({
        kind: "media", found: false, duration: 0,
        reason: e instanceof Error ? e.message : String(e),
      });
      halt();
      return;
    } finally {
      el.removeEventListener("emptied", onEmptied);
    }
    if (!running) return;

    stream.getTracks().forEach((t) => t.stop());
    stream = null;
    const next = await waitForPlaying(SWITCH_WAIT_MS);
    if (!running) return;
    if (!next) {
      // Finished, not failed. The overlay stays: lines still queued in the
      // engine arrive after the video ends, and are there on a replay.
      await tell<FromPage>({ kind: "finished" });
      return;
    }
    const opened = openAudio(next);
    if ("reason" in opened) {
      await tell<FromPage>({ kind: "media", found: false, duration: 0, reason: opened.reason });
      halt();
      return;
    }
    media = next;
    stream = opened.stream;
    take += 1;
    cues = [];
    paint();
    await tell<FromPage>({ kind: "switched", take, duration: next.duration || 0 });
  }
}

function halt() {
  running = false;
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
  if (ticker !== null) { clearInterval(ticker); ticker = null; }
  removeOverlay();
  void tell<FromPage>({ kind: "ended" });
}

// Registered once per page, however many times this file is injected.
//
// Every Start injects it again -- the background cannot cheaply tell whether
// an earlier injection is still alive, and a page that navigated needs a fresh
// one. Content scripts from one extension share an isolated world, so a flag
// on it survives between injections. Without the flag a second Start leaves
// two copies listening: both receive "begin", both record, every window goes
// to the engine twice, and the engine's one-deep queue drops half of them --
// which looks exactly like transcription failing to keep up (APP-110).
const INSTALLED = "__opensubsOverlay";
const world = globalThis as unknown as Record<string, boolean>;
if (!world[INSTALLED]) {
  world[INSTALLED] = true;
  listen();
}

function listen() {
api.runtime.onMessage.addListener((message: ToPage, _sender, respond) => {
  switch (message.kind) {
    case "begin":
      // Answered when the video has been found and opened, not before: see
      // BeginAnswer.
      void begin(message.settings).then(respond, (e) =>
        respond({ found: false, reason: e instanceof Error ? e.message : String(e) } satisfies BeginAnswer));
      return true;
    case "halt": halt(); break;
    case "cues": cues = message.cues; paint(); break;
    case "status":
      if (note) {
        const s = message.status;
        note.textContent =
          s.stage === "model" && s.fraction !== null
            ? `${s.note} ${Math.round(s.fraction * 100)}%`
            : s.stage === "listening" ? "" : s.note;
      }
      break;
    default: return false;
  }
  respond({ ok: true });
  return true;
});

// A page that navigates away (an SPA route change, a next episode) leaves a
// recorder pointed at a detached element. Stop rather than record silence.
window.addEventListener("pagehide", halt);
}
