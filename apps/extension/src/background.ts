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
  type Command,
  type Cue,
  type FromEngine,
  type FromPage,
  type Settings,
  type Status,
  type ToEngine,
  type ToPage,
} from "./lib/protocol";
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
}

let session: Session | null = null;
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

async function page(tabId: number, message: ToPage) {
  try {
    await api.tabs.sendMessage(tabId, message);
  } catch {
    // The tab navigated or closed mid-flight. Stopping is the right answer
    // to both, and neither deserves an error in the console.
    if (session?.tabId === tabId) session = null;
  }
}

async function inject(tabId: number) {
  try {
    await api.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
  } catch {
    // Already injected, which is the common case on a second start.
  }
}

function setStatus(status: Status) {
  if (session) session.status = status;
  void api.runtime.sendMessage({ kind: "status", status }).catch(() => undefined);
  if (session) void page(session.tabId, { kind: "status", status });
}

// --- replies from the engine ---------------------------------------------

async function fromEngine(message: FromEngine) {
  if (!session) return;
  if (message.kind === "segments") {
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
  session = { tabId, settings: next, cues: [], status: { stage: "model", fraction: null, note: "Starting" } };
  starting ??= startEngine();
  await starting;
  await inject(tabId);
  await toEngine({ kind: "warm", model: next.model });
  await page(tabId, { kind: "begin", settings: next });
  setStatus({ stage: "listening", fraction: null, note: "Listening" });
}

async function stop(tabId: number) {
  if (session?.tabId === tabId) {
    await page(tabId, { kind: "halt" });
    session = null;
  }
  setStatus({ stage: "idle", fraction: null, note: "Stopped" });
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

        case "state":
          return respond({
            running: !!session,
            tabId: session?.tabId ?? null,
            status: session?.status ?? { stage: "idle", fraction: null, note: "" },
            count: session?.cues.length ?? 0,
            settings: session?.settings ?? (await storedSettings()),
          });

        case "cues":
          return respond({
            srt: toSrt(session?.cues ?? []),
            vtt: toVtt(session?.cues ?? []),
            count: session?.cues.length ?? 0,
          });

        // From the page: one recorded window, on its way to the engine.
        case "window":
          if (session && session.tabId === tabId) {
            await toEngine({
              kind: "transcribe",
              audio: message.audio,
              mime: message.mime,
              offset: message.offset,
              settings: session.settings,
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
  if (session?.tabId === tabId) session = null;
});
