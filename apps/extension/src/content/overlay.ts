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
import { findMedia, openAudio, playingMedia, recordWindows, waitForPlaying, whyNoMedia } from "../lib/capture";
import { BEHIND_S, liveLine, type Catchup } from "../lib/pace";

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

/**
 * Which line is on the video, and how far behind it is.
 *
 * Reset by a new capture, and by a switch: the lines are another video's.
 */
let catchup: Catchup = { index: -1, until: 0 };
/** Whether the note under the line is ours to clear. See `paint`. */
let sayingBehind = false;

function paint() {
  if (!line || !media) return;
  const shown = liveLine(cues, media.currentTime, Date.now(), catchup);
  // Transcribing a live video always trails it, so the line for this exact
  // moment is usually not made yet. Show the newest one instead, and say how
  // far back it is, rather than showing nothing at all (APP-139).
  const text = shown ? cues[shown.index].text : "";
  if (shown) catchup = { index: shown.index, until: shown.until };
  if (line.textContent !== text) line.textContent = text;
  line.style.fontSize = `calc((1.6vw + 12px) * ${settings?.fontScale ?? 1})`;

  if (note) {
    const behind = shown && shown.lag > BEHIND_S ? `${Math.round(shown.lag)}s behind` : "";
    if (behind) {
      note.textContent = behind;
      sayingBehind = true;
    } else if (sayingBehind) {
      note.textContent = "";
      sayingBehind = false;
    }
  }
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
 * An unreadable clip this close to its end is waited out rather than refused.
 *
 * TED's pre-roll is served from Google's ad domain with no CORS, so its audio
 * cannot be read, and Start pressed during it ended the session with "This
 * site does not let other pages read its video's audio" -- about a film the
 * page had not started yet (APP-133). An ad has seconds left; the film that
 * cannot be read -- a Wikimedia Commons file -- has minutes, and still gets
 * the error at once.
 */
const AD_REMAINING_S = 90;

function endsSoon(el: HTMLMediaElement): boolean {
  const left = el.duration - el.currentTime;
  return Number.isFinite(left) && left <= AD_REMAINING_S;
}

/** Resolve when `el` has finished, been replaced, or stopped playing for good. */
function endOf(el: HTMLMediaElement): Promise<void> {
  return new Promise((resolve) => {
    const left = Number.isFinite(el.duration) ? el.duration - el.currentTime : AD_REMAINING_S;
    const done = () => {
      el.removeEventListener("ended", done);
      el.removeEventListener("emptied", done);
      clearTimeout(timer);
      clearInterval(poll);
      resolve();
    };
    el.addEventListener("ended", done, { once: true });
    el.addEventListener("emptied", done, { once: true });
    // Some players hide the ad element instead of letting it end.
    const poll = setInterval(() => { if (!running || !el.isConnected || (el.paused && el !== playingMedia())) done(); }, 500);
    const timer = setTimeout(done, (left + 10) * 1000);
  });
}

type Found = { el: HTMLMediaElement; stream: MediaStream } | { reason: string } | null;

/**
 * The first readable video, starting from `el`: an unreadable clip that ends
 * soon is waited out and whatever plays next is tried. Null when nothing is
 * playing at all.
 */
async function readable(el: HTMLMediaElement | null, onWait: (reason: string) => void): Promise<Found> {
  let reason = "";
  for (let tries = 0; el && tries < 10 && running; tries += 1) {
    const opened = openAudio(el);
    if ("stream" in opened) return { el, stream: opened.stream };
    reason = opened.reason;
    if (!endsSoon(el)) return { reason };
    onWait(reason);
    await endOf(el);
    if (!running) return null;
    el = await waitForPlaying(SWITCH_WAIT_MS);
  }
  return reason ? { reason } : null;
}

/** Start reading `found`, a new take whose lines replace the last one's. */
async function adopt(found: { el: HTMLMediaElement; stream: MediaStream }, announce: boolean) {
  media = found.el;
  stream = found.stream;
  take += 1;
  cues = [];
  catchup = { index: -1, until: 0 };
  paint();
  if (announce) await tell<FromPage>({ kind: "switched", take, duration: found.el.duration || 0 });
  void record();
}

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
  if ("reason" in opened && !endsSoon(el)) return { found: false, reason: opened.reason };

  running = true;
  catchup = { index: -1, until: 0 };
  if (settings.overlay) {
    ensureOverlay();
    ticker = window.setInterval(paint, 120);
  }
  if ("stream" in opened) {
    void adopt({ el, stream: opened.stream }, false);
    return { found: true, duration: el.duration || 0 };
  }
  // Unreadable, and about to end: an ad. Answer now, wait it out, and move
  // to what plays next -- or say why not, if nothing readable does.
  void (async () => {
    const found = await readable(el, () => undefined);
    if (!running) return;
    if (found && "el" in found) { await adopt(found, true); return; }
    await tell<FromPage>({
      kind: "media", found: false, duration: 0,
      reason: found?.reason ?? "The clip that was playing ended, and nothing played after it. Start the video and press Start again.",
    });
    halt();
  })();
  return { found: true, duration: 0, waiting: "Waiting for the ad to finish -- its audio cannot be read" };
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
  if (!running || !media || !stream || !settings) return;
  const el = media;
  const current = stream;
  let replaced = false;
  const onEmptied = () => { replaced = true; };
  el.addEventListener("emptied", onEmptied, { once: true });
  try {
    const mine = take;
    await recordWindows(
      el,
      current,
      settings.window,
      async (w) => {
        const audio = await blobToWire(w.blob);
        const reply = (await tell<FromPage>({ kind: "window", audio, mime: w.blob.type, offset: w.offset, take: mine })) as
          | { lost?: boolean }
          | undefined;
        // The background lost this session (APP-121: suspended by the
        // browser). It has said so; recording on would only send audio
        // nowhere.
        if (reply?.lost) halt();
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

  current.getTracks().forEach((t) => t.stop());
  stream = null;
  const next = await waitForPlaying(SWITCH_WAIT_MS);
  if (!running) return;
  if (!next) {
    // Finished, not failed. The overlay stays: lines still queued in the
    // engine arrive after the video ends, and are there on a replay.
    await tell<FromPage>({ kind: "finished" });
    return;
  }
  const found = await readable(next, () => undefined);
  if (!running) return;
  if (found && "el" in found) { await adopt(found, true); return; }
  if (!found) { await tell<FromPage>({ kind: "finished" }); return; }
  await tell<FromPage>({ kind: "media", found: false, duration: 0, reason: found.reason });
  halt();
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
