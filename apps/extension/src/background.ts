/**
 * Routing, and the one piece of genuine per-browser divergence.
 *
 * Chromium MV3 gives you a service worker: no DOM, no Web Audio, no
 * WebGPU, and it is killed after 30 seconds of inactivity. Whisper needs
 * all three of those and rather longer than 30 seconds, so the engine goes
 * in an *offscreen document* and the worker only forwards to it.
 *
 * Firefox MV3 gives you an event page, which is a document. It has no
 * chrome.offscreen at all, and needs none: the engine runs in this page,
 * called directly. Note that it must be called and not messaged --
 * `runtime.sendMessage` does not deliver to listeners in the sending page,
 * so the obvious uniform version of this file silently does nothing on
 * Firefox.
 *
 * The branch is a capability test rather than a browser sniff, so it keeps
 * working if Firefox ships the API.
 */

import {
  api,
  DEFAULT_SETTINGS,
  type BeginAnswer,
  type Command,
  type Cue,
  type FromEngine,
  type FromPage,
  type Settings,
  type Status,
  type ToEngine,
  type ToPage,
} from "./lib/protocol";
import { FIRST_WINDOW_S } from "./lib/pace";
import { stitch, toSrt, toVtt } from "./lib/seam";
import type { Engine } from "./engine/engine";

const offscreenApi = (globalThis as unknown as {
  chrome?: {
    offscreen?: {
      hasDocument(): Promise<boolean>;
      createDocument(o: { url: string; reasons: string[]; justification: string }): Promise<void>;
      closeDocument(): Promise<void>;
    };
  };
}).chrome?.offscreen;

interface Session {
  tabId: number;
  settings: Settings;
  cues: Cue[];
  status: Status;
  /** The page's current take; lines from an earlier one are dropped. */
  take: number;
  /** The page's own address, from its answer to "begin". See `kept`. */
  url?: string;
  /** Which video in that page is being read. See `kept`. */
  video?: string;
}

let session: Session | null = null;
/**
 * What the last session transcribed, after it stopped (APP-146).
 *
 * Stop used to drop the session, and the subtitles with it: the count went to
 * zero, Save .srt greyed out, and several minutes of transcription were gone
 * with no warning -- for someone who only meant to pause, or to change the
 * model. Stopping ends the recording; it does not throw away what was made.
 *
 * They are kept against the page they were made from, so pressing Start again
 * on that page carries on the same file, and a different page starts a new
 * one. The page says which page it is, because this extension asks for no
 * `tabs` permission and so cannot look a tab's address up.
 */
let kept: { tabId: number; url?: string; video?: string; cues: Cue[] } | null = null;

/** The lines held for this tab, if any -- what Save .srt would write. */
function held(tabId?: number): Cue[] {
  if (!kept) return [];
  return tabId === undefined || kept.tabId === tabId ? kept.cues : [];
}

/** How Stop reads once there is something to save. */
function stoppedNote(lines: number): string {
  if (!lines) return "Stopped";
  return `Stopped. ${lines} line${lines === 1 ? "" : "s"} kept -- save them, or press Start to carry on.`;
}
/**
 * What went wrong last, kept after the session it ended. A Start that fails
 * clears the session, and the popup asks for state when it opens -- without
 * this it would open on nothing, and the reason would have been shown only
 * to a popup that happened to be open at the time (APP-133).
 */
let lastError: Status | null = null;
/**
 * Keeps an event page from being suspended while a session runs (APP-121).
 *
 * Firefox suspends an idle MV3 background page after 30 seconds and, with it,
 * everything in its memory -- on Firefox that is the session and the engine
 * itself. From Firefox 156, the windows arriving every twenty seconds and the
 * popup's polling no longer count as activity: a session died about a minute
 * in, went back to idle with no error, and produced no subtitles. What does
 * count, in Firefox's own lifecycle code (ext-backgroundPage.js, "reset-idle"
 * with reason "parentapicall"), is the background page itself calling an
 * extension API implemented in the parent process. So while a session runs,
 * it asks for something cheap every five seconds, and stops when the session
 * does, so the page still sleeps when there is nothing to do.
 */
let keepAlive: ReturnType<typeof setInterval> | null = null;
function holdAwake(on: boolean) {
  if (on && keepAlive === null) {
    keepAlive = setInterval(() => void api.runtime.getPlatformInfo().catch(() => undefined), 5_000);
  } else if (!on && keepAlive !== null) {
    clearInterval(keepAlive);
    keepAlive = null;
  }
}

/** Set only on Firefox, where the engine is a local object. */
let local: Engine | null = null;
let starting: Promise<void> | null = null;

// --- the engine host -----------------------------------------------------

async function startEngine(): Promise<void> {
  if (offscreenApi) {
    if (await offscreenApi.hasDocument()) return;
    await offscreenApi.createDocument({
      url: "engine.html",
      // AUDIO_PLAYBACK unlocks Web Audio in an offscreen document;
      // WORKERS covers the threads ONNX Runtime starts for wasm.
      reasons: ["AUDIO_PLAYBACK", "WORKERS"],
      justification: "Runs the speech recognition model, which needs Web Audio and WebGPU.",
    });
    return;
  }
  if (local) return;
  const { createEngine } = await import("./engine/engine");
  local = createEngine((message) => void fromEngine(message));
}

function toEngine(message: ToEngine) {
  if (local) { local.handle(message); return Promise.resolve(); }
  return api.runtime.sendMessage(message).catch(() => undefined);
}

// --- talking to the page -------------------------------------------------

/** Send "begin" and read the page's answer; null if it never answered. */
async function ask(tabId: number, message: ToPage): Promise<BeginAnswer | null> {
  try {
    const answer = (await api.tabs.sendMessage(tabId, message)) as BeginAnswer | undefined;
    return answer && typeof answer.found === "boolean" ? answer : null;
  } catch {
    return null;
  }
}

/** Whether the page took the message. */
async function page(tabId: number, message: ToPage): Promise<boolean> {
  try {
    await api.tabs.sendMessage(tabId, message);
    return true;
  } catch {
    // The tab navigated or closed mid-flight. Stopping is the right answer
    // to both, and neither deserves an error in the console.
    if (session?.tabId === tabId) { session = null; holdAwake(false); }
    return false;
  }
}

/**
 * Put the content script in the page, or say why it could not go in.
 *
 * This used to swallow every failure on the theory that the only one was
 * "already injected". There is no such failure -- executeScript runs the file
 * again, and overlay.ts guards itself against that -- so the catch only ever
 * hid real ones: a page the browser will not script (the Web Store, a PDF, a
 * browser page), a permission that was refused, and, in 1.0.1, a content.js
 * that was a syntax error from its first line (APP-109). Each of those left
 * the popup saying "Listening" over a page with nothing in it.
 */
async function inject(tabId: number): Promise<string | null> {
  try {
    await api.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

function setStatus(status: Status) {
  if (session) session.status = status;
  lastError = status.stage === "error" ? status : null;
  void api.runtime.sendMessage({ kind: "status", status }).catch(() => undefined);
  if (session) void page(session.tabId, { kind: "status", status });
}

// --- replies from the engine ---------------------------------------------

async function fromEngine(message: FromEngine) {
  if (!session) return;
  if (message.kind === "segments") {
    // From a video the page has since moved on from (see "switched").
    if (message.take !== undefined && message.take !== session.take) return;
    session.cues = stitch(session.cues, message.cues);
    await page(session.tabId, { kind: "cues", cues: session.cues });
    setStatus({
      stage: "listening",
      fraction: null,
      note: `${session.cues.length} line${session.cues.length === 1 ? "" : "s"}`,
      device: session.status.device,
    });
    return;
  }
  if (message.kind === "failed") {
    setStatus({ stage: "error", fraction: null, note: message.message });
    return;
  }
  if (message.kind === "status") setStatus(message.status);
}

// --- commands ------------------------------------------------------------

async function start(tabId: number, next: Settings) {
  if (session && session.tabId !== tabId) await stop(session.tabId);
  await api.storage.local.set({ settings: next });
  session = { tabId, settings: next, cues: [], status: { stage: "model", fraction: null, note: "Starting" }, take: 0 };
  holdAwake(true);
  starting ??= startEngine();
  await starting;
  const refused = await inject(tabId);
  if (refused) {
    setStatus({ stage: "error", fraction: null, note: `This page cannot be subtitled: ${refused}` });
    session = null;
    holdAwake(false);
    return;
  }
  await toEngine({ kind: "warm", model: next.model, backend: next.backend });
  // The page answers "begin" once it has found the video and opened its
  // audio, or with why it could not. Only then is "Listening" true -- set
  // before, it overwrote the page's "no video" and stayed there (APP-133).
  // No answer at all is how 1.0.1 looked to everyone who tried it.
  const answer = await ask(tabId, { kind: "begin", settings: next });
  if (!answer) {
    setStatus({ stage: "error", fraction: null, note: "The page did not answer. Reload it and press Start again." });
    session = null;
    holdAwake(false);
    return;
  }
  if (!answer.found) {
    setStatus({ stage: "error", fraction: null, note: answer.reason });
    session = null;
    holdAwake(false);
    return;
  }
  session.take = 1;
  session.url = answer.url;
  session.video = answer.video;
  // Start again on the same video and it is one file, carried on where it
  // left off (APP-146); on another page, or another video within the same
  // page -- YouTube's next film, which never navigates -- it is a new one,
  // because the two clocks both begin at zero and the lines would interleave
  // into a file nobody can use (APP-153).
  const sameVideo = kept && kept.tabId === tabId && kept.url === answer.url
    && kept.video === answer.video;
  const carried = sameVideo ? kept!.cues : [];
  kept = null;
  if (carried.length) {
    session.cues = carried;
    await page(tabId, { kind: "cues", cues: carried, seen: true });
  }
  setStatus({
    stage: "listening",
    fraction: null,
    // Recording has to happen before there is anything to read, and on a
    // second Start that wait is all there is to see (APP-148).
    note: answer.waiting ?? `Listening -- recording the first ${FIRST_WINDOW_S} seconds`,
  });
}

async function stop(tabId: number) {
  if (session?.tabId === tabId) {
    await page(tabId, { kind: "halt" });
    kept = session.cues.length
      ? { tabId, url: session.url, video: session.video, cues: session.cues }
      : null;
    session = null;
    holdAwake(false);
  }
  setStatus({ stage: "idle", fraction: null, note: stoppedNote(held(tabId).length) });
}

async function storedSettings(): Promise<Settings> {
  const stored = await api.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...(stored.settings as Partial<Settings> | undefined) };
}

// --- one router ----------------------------------------------------------

api.runtime.onMessage.addListener(
  (message: Command | FromPage | FromEngine, sender, respond) => {
    void (async () => {
      const tabId =
        ("tabId" in message && typeof message.tabId === "number" ? message.tabId : undefined) ??
        sender.tab?.id;

      switch (message.kind) {
        case "start":
          if (tabId) await start(tabId, message.settings);
          return respond({ ok: !!tabId });

        case "stop":
          if (tabId) await stop(tabId);
          return respond({ ok: true });

        // Settings changed while the popup is open. Kept for next time, and
        // applied to a running session at once: the subtitle size is a thing
        // you judge by looking at it (APP-144).
        case "settings": {
          const next = message.settings;
          await api.storage.local.set({ settings: next });
          if (session) {
            session.settings = next;
            await page(session.tabId, { kind: "settings", settings: next });
          }
          return respond({ ok: true });
        }

        case "state": {
          const lines = session?.cues ?? held(tabId);
          return respond({
            running: !!session,
            tabId: session?.tabId ?? null,
            status: session?.status ?? lastError ?? { stage: "idle", fraction: null, note: stoppedNote(lines.length) },
            count: lines.length,
            settings: session?.settings ?? (await storedSettings()),
          });
        }

        // Save .srt, which is offered after Stop as well as during a session.
        case "cues": {
          const lines = session?.cues ?? held(tabId);
          return respond({ srt: toSrt(lines), vtt: toVtt(lines), count: lines.length });
        }

        // From the page: one recorded window, on its way to the engine.
        case "window":
          // Audio for a session this background no longer has: it was
          // suspended and restarted with nothing in memory. Say so, and tell
          // the page to stop, rather than dropping every window in silence.
          if (!session) {
            setStatus({
              stage: "error",
              fraction: null,
              note: "The browser stopped the extension in the background, so subtitling stopped. Press Start again.",
            });
            return respond({ ok: false, lost: true });
          }
          // A window from a take the page has moved past is stale (an ad's,
          // see "switched"). One from a *later* take means the page counted
          // ahead of this session -- which cost APP-145 every window of a
          // second Start -- so follow the page rather than drop its audio.
          if (session.tabId === tabId && message.take > session.take) session.take = message.take;
          if (session.tabId === tabId && message.take === session.take) {
            await toEngine({
              kind: "transcribe",
              audio: message.audio,
              mime: message.mime,
              offset: message.offset,
              settings: session.settings,
              take: message.take,
            });
          }
          return respond({ ok: true });

        // The video being read ended and another is playing -- an ad gave way
        // to the film. The ad's lines go, and the film's start clean.
        case "switched":
          if (session && session.tabId === tabId) {
            session.take = message.take;
            session.cues = [];
            await page(tabId, { kind: "cues", cues: [] });
            setStatus({ stage: "listening", fraction: null, note: "Listening (moved to the video now playing)" });
          }
          return respond({ ok: true });

        case "finished":
          if (session && session.tabId === tabId) {
            setStatus({
              stage: "listening",
              fraction: null,
              note: "The video ended. Save .srt to keep the subtitles, or play another and press Start.",
            });
          }
          return respond({ ok: true });

        case "media":
          if (!message.found) {
            setStatus({ stage: "error", fraction: null, note: message.reason ?? "No video found." });
          }
          return respond({ ok: true });

        case "ended":
          return respond({ ok: true });

        // Save .srt, from here rather than from the popup -- where that is
        // possible. Firefox's background is a document, so it has
        // createObjectURL and, unlike the popup, it is still there after the
        // save dialog opens (APP-152). Chromium's is a service worker, which
        // has neither, and says so: the popup then downloads it itself.
        case "save": {
          const lines = session?.cues ?? held(tabId);
          if (!lines.length) return respond({ ok: false });
          const make = (globalThis as { URL?: { createObjectURL?: (b: Blob) => string } }).URL;
          if (typeof make?.createObjectURL !== "function" || typeof Blob === "undefined") {
            return respond({ ok: false });
          }
          const url = make.createObjectURL(new Blob([toSrt(lines)], { type: "text/plain" }));
          // Not awaited: `saveAs` opens a dialog, and the promise waits for
          // the person to answer it. The popup is already closing -- on
          // Firefox the dialog is what closes it -- so waiting would only
          // hold a reply nobody is left to hear.
          // `saveAs` is left out on purpose: then each browser follows its
          // own "ask where to save each file" setting, which is the answer
          // the person has already given once. Asking always meant a dialog
          // on every save for people who had said they did not want one --
          // and on Firefox that dialog is what closed the popup and killed
          // the download (APP-152).
          void api.downloads.download({ url, filename: "subtitles.srt" })
            .catch((e: unknown) => {
              const why = e instanceof Error ? e.message : String(e);
              // Closing the dialog is an answer, not a fault.
              if (/cancel/i.test(why)) return;
              setStatus({ stage: "error", fraction: null, note: `The subtitles could not be saved: ${why}` });
            })
            // Long after the dialog: the URL has to outlive the person
            // deciding where to put the file, and this page is not going
            // anywhere.
            .finally(() => setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000));
          return respond({ ok: true });
        }

        // The popup's Clear: the lines go, whether a session is running or
        // not, and the overlay stops showing them (APP-153).
        case "clear":
          if (kept && (tabId === undefined || kept.tabId === tabId)) kept = null;
          if (session && (tabId === undefined || session.tabId === tabId)) {
            session.cues = [];
            await page(session.tabId, { kind: "cues", cues: [] });
            setStatus({ ...session.status, note: "Subtitles cleared" });
          } else {
            setStatus({ stage: "idle", fraction: null, note: "Subtitles cleared" });
          }
          return respond({ ok: true });

        // The page has gone: the lines were that page's, so they go too.
        case "gone":
          if (kept?.tabId === tabId) kept = null;
          return respond({ ok: true });

        // From the engine, on Chromium, where it is a separate document.
        case "segments":
        case "failed":
          await fromEngine(message);
          return respond({ ok: true });

        case "status":
          // The engine and this file both broadcast status; only the
          // engine's is news, and it arrives with no tab attached.
          if (session && !sender.tab) await fromEngine(message);
          return respond({ ok: true });

        default:
          return respond({ ok: false });
      }
    })();
    return true;
  },
);

api.tabs.onRemoved.addListener((tabId) => {
  if (session?.tabId === tabId) { session = null; holdAwake(false); }
  if (kept?.tabId === tabId) kept = null;
});
