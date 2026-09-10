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
}

export const DEFAULT_SETTINGS: Settings = {
  model: "onnx-community/whisper-base",
  language: "auto",
  window: 20,
  overlay: true,
  fontScale: 1,
};

/** Sent by the popup; handled by the background. */
export type Command =
  | { kind: "start"; tabId?: number; settings: Settings }
  | { kind: "stop"; tabId?: number }
  | { kind: "state"; tabId?: number }
  | { kind: "cues"; tabId?: number };

/** Sent by the content script to the background. */
export type FromPage =
  | { kind: "window"; audio: ArrayBuffer; mime: string; offset: number }
  | { kind: "media"; found: boolean; duration: number; reason?: string }
  | { kind: "ended" };

/** Sent by the background down to the content script. */
export type ToPage =
  | { kind: "begin"; settings: Settings }
  | { kind: "halt" }
  | { kind: "cues"; cues: Cue[] }
  | { kind: "status"; status: Status };

/** Background <-> engine host. */
export type ToEngine =
  | { kind: "warm"; model: string }
  | { kind: "transcribe"; audio: ArrayBuffer; mime: string; offset: number; settings: Settings }
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
  | { kind: "segments"; cues: Cue[]; offset: number }
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
