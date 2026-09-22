/**
 * Every message that crosses a boundary in this extension.
 *
 * There are three boundaries and they are not interchangeable:
 *
 *   content script  <-> background   the page's world to the extension's
 *   background      <-> engine host  routing to where Whisper actually runs
 *   popup           <-> background   the controls
 *
 * The engine host is an offscreen document on Chromium and the background
 * page itself on Firefox (see `background.ts`), so the same message shapes
 * have to work whether the far side is a separate document or the sender.
 */

/** A finished subtitle line on the *media element's* timeline, in seconds. */
export interface Cue {
  start: number;
  end: number;
  text: string;
}

export type Stage = "idle" | "model" | "listening" | "transcribing" | "error";

export interface Status {
  stage: Stage;
  /** 0..1 while a model downloads, null when there is nothing to show. */
  fraction: number | null;
  note: string;
  /** Whether the engine will run on the GPU. Decided once, at model load. */
  device?: "webgpu" | "wasm";
}

export interface Settings {
  model: string;
  /** A language code, or "auto". */
  language: string;
  /** Seconds of audio per pass. Longer is more accurate and less prompt. */
  window: number;
  /** Render cues over the video, as opposed to only collecting them. */
  overlay: boolean;
  fontScale: number;
  /**
   * Where the model runs. "auto" is the engine's call (see
   * engine.ts `startsOnCpu`); "gpu" and "cpu" are the user's.
   */
  backend: "auto" | "gpu" | "cpu";
}

export const DEFAULT_SETTINGS: Settings = {
  model: "onnx-community/whisper-base",
  language: "auto",
  window: 20,
  overlay: true,
  fontScale: 1,
  backend: "auto",
};

/** Sent by the popup; handled by the background. */
export type Command =
  | { kind: "start"; tabId?: number; settings: Settings }
  | { kind: "stop"; tabId?: number }
  | { kind: "state"; tabId?: number }
  | { kind: "cues"; tabId?: number };

/**
 * One recorded window of audio, as it crosses a message boundary.
 *
 * Base64 text, not an ArrayBuffer. Chromium serialises extension messages as
 * JSON, and JSON has no binary type: an ArrayBuffer handed to
 * `runtime.sendMessage` arrives on the other side as `{}` -- no error, no
 * warning, just an empty object where the audio was. The engine then reports
 * "Input has an unsupported or unrecognizable format", which reads as a codec
 * problem and is not one (APP-109). Firefox structured-clones messages and
 * would have carried the buffer fine, so the fault is invisible there.
 *
 * Text survives both. It costs a third more bytes on the wire -- about 30 KB
 * on a 20-second Opus window -- which is nothing next to the model.
 */
export type WireAudio = string;

/** Sent by the content script to the background. */
export type FromPage =
  /**
   * `take` counts the videos read in this session: it goes up when the page
   * moves to another element (an ad giving way to the film), so lines from
   * the one before, still in the engine's queue, can be told apart.
   */
  | { kind: "window"; audio: WireAudio; mime: string; offset: number; take: number }
  | { kind: "media"; found: boolean; duration: number; reason?: string }
  /** The video being read ended or was replaced, and another is playing. */
  | { kind: "switched"; take: number; duration: number }
  /** The video being read ended and nothing else started. Not an error. */
  | { kind: "finished" }
  | { kind: "ended" };

/**
 * The page's answer to "begin", as the reply to that message itself.
 *
 * It used to be a separate message sent after "begin" returned, and the
 * background set "Listening" as soon as the send resolved -- which was before
 * the page had looked for a video. On a page with none, "No video" arrived
 * first and "Listening" overwrote it, for good (APP-133).
 */
export type BeginAnswer = { found: true; duration: number } | { found: false; reason: string };

/** Sent by the background down to the content script. */
export type ToPage =
  | { kind: "begin"; settings: Settings }
  | { kind: "halt" }
  | { kind: "cues"; cues: Cue[] }
  | { kind: "status"; status: Status };

/** Background <-> engine host. */
export type ToEngine =
  | { kind: "warm"; model: string }
  | { kind: "transcribe"; audio: WireAudio; mime: string; offset: number; settings: Settings; take?: number }
  | { kind: "release" };

/**
 * Replies from the engine.
 *
 * `segments` rather than `cues`, even though it carries cues: the popup
 * *asks* for cues with `{kind:"cues"}`, and one router cannot tell a
 * request from an answer when both are spelled the same. Naming them apart
 * is cheaper than sniffing the payload shape, and does not quietly stop
 * working when a field is added.
 */
export type FromEngine =
  | { kind: "status"; status: Status }
  | { kind: "segments"; cues: Cue[]; offset: number; take?: number }
  | { kind: "failed"; message: string };

/** The one place that knows both browsers' name for the API. */
export const api: typeof chrome =
  (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome;

/**
 * Chromium resolves `chrome.runtime.sendMessage` with `undefined` and sets
 * `lastError` when nothing is listening; Firefox rejects. Neither is worth
 * propagating -- a closed popup is not an error -- so both are swallowed
 * here rather than at forty call sites.
 */
export async function tell<T>(message: T): Promise<unknown> {
  try {
    const reply = await api.runtime.sendMessage(message);
    void api.runtime.lastError;
    return reply;
  } catch {
    return undefined;
  }
}

/**
 * Bytes to base64, in slices.
 *
 * `btoa(String.fromCharCode(...bytes))` is the one-line version and it throws
 * "Maximum call stack size exceeded" on anything over a few hundred kilobytes,
 * because every byte becomes a function argument. A long window at a high
 * bitrate gets there. Slicing keeps each call small.
 */
export function toWire(buffer: ArrayBuffer): WireAudio {
  const bytes = new Uint8Array(buffer);
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(text);
}

/** Base64 back to bytes. */
export function fromWire(audio: WireAudio): Uint8Array {
  const text = atob(audio);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i);
  return bytes;
}

/**
 * A recorded window, straight to wire text.
 *
 * Through FileReader's data URL, never through the bytes, because of Firefox.
 * There a content script sees objects the page's APIs make through a security
 * wrapper, and the ArrayBuffer from `blob.arrayBuffer()` is one of them:
 * building a Uint8Array over it reads the buffer's `constructor`, the wrapper
 * refuses, and every window failed with 'Permission denied to access property
 * "constructor"' -- so the fix for Chromium's JSON messaging, written against
 * the bytes, sent Firefox no audio at all. A data URL is a string, the encoding
 * is the browser's own, and a string crosses every boundary there is.
 *
 * Node has Blob and no FileReader, so the unit tests take the byte path; no
 * browser does.
 */
export function blobToWire(blob: Blob): Promise<WireAudio> {
  if (typeof FileReader === "undefined") return blob.arrayBuffer().then(toWire);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result ?? "");
      const comma = url.indexOf(",");
      resolve(comma >= 0 ? url.slice(comma + 1) : "");
    };
    reader.onerror = () => reject(reader.error ?? new Error("The recorded audio could not be read."));
    reader.readAsDataURL(blob);
  });
}
