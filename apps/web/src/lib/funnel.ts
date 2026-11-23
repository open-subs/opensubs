// Anonymous funnel events for burning a video: how far a visitor got, never
// what they were working on.
//
// # Off unless the site says so
//
// Nothing is sent unless the site's switch file (exportgate.ts) holds
// `"funnelEvents": true`. The file lives only on the server, so turning
// this on or off is an edit there, not a build. The phone and desktop apps
// run this same page inside a native shell, never read the file, and never
// send anything.
//
// # What is sent
//
// The events go to the site's own page-view counter, through the
// `umami.track` function its tag defines; this file carries no address and
// no id of its own. With the tag blocked, nothing is sent and nothing
// breaks.
//
//   transcribe-start   { tool, device, lang, engine,     subtitle generation began. `lang` is the
//                        dur }                             spoken language asked for ("auto" if unset),
//                                                          `engine` where it ran (local, opensubs, or a
//                                                          provider id), `dur` a coarse clip-length bucket
//   transcribe-complete{ tool, device, lang, engine,     subtitles came back. On-device runs also carry
//                        dur, src }                        `src` on all three transcribe events: where the
//                                                          model came from, cn (ModelScope) or us (Hugging
//                                                          Face)
//   transcribe-failed  { tool, device, stage, error,     it stopped. `stage` is the step reached (read,
//                        ename, lang, engine, dur }         model, transcribe), `error` a category (a
//                                                          no-speech result is one), `ename` the error's
//                                                          type name. error=interrupted is the one
//                                                          backfilled on the next load, from a run whose
//                                                          page was closed or reloaded mid-transcription;
//                                                          it carries `bg` ("1"/"0"), whether the page had
//                                                          gone to the background
//   burn-click         { tool, device }                 Burn pressed
//   signin-shown       { tool, device }                 the sign-in sheet opened in front of it
//   signin-complete    { tool, device, method }         signed in after that sheet, in the page
//                                                       or back from a provider
//   burn-start         { tool, device }                 the export started
//   burn-complete      { tool, device }                 the video is ready to save
//   burn-failed        { tool, device, stage, error,    it stopped (stage reached, error category,
//                        ename }                          and the error's name, e.g. NotReadableError)
//   burn-cancelled     { tool, device, stage, after }   the visitor stopped it (never counted as failed);
//                                                       `after` is a coarse bucket of how long in
//   transcribe-cancelled { tool, device, stage, lang,   the visitor stopped a transcription; same
//                          engine, dur, after }          request fields as transcribe-*, plus `after`
//   subtitle-download  { tool, device }                 .srt / .vtt / .ass / .txt saved; tool is the format
//   signin-dismissed   { tool, device }                 Not now on the sign-in sheet
//   pending-restored   { tool, device }                 subtitles kept from an earlier visit were
//                                                       offered back to a signed-out visitor with the
//                                                       switch on
//   pending-recovered  { tool, device }                 after that, signed in, the burn started
//   pending-expired    { tool, device }                 kept subtitles passed their age and were
//                                                       deleted on page load, with the video pointer
//
// `tool` is "burn" for the video export, "transcribe" for subtitle
// generation. `device` is a coarse class
// (android, iphone, ipad, other-mobile, desktop). `method` is how the
// sign-in was done (google, apple, github, nostr, wallet, email). `stage`
// and `error` are categories, never a message; `ename` is the error's type
// name (TypeError, NotReadableError, UnsupportedInputFormatError), letters
// only, never its message, which can carry a file name. No video, no
// subtitle text, no file name, no account detail.
//
// # Why sessionStorage
//
// Google, Apple and GitHub sign in by leaving the page. That the sheet was
// shown, and the method chosen, are kept for the tab so the return is
// reported as the end of the same journey, once. The record is dropped once
// reported, when the sheet is dismissed, or after an hour.

import { account } from "./account";
import { onWeb, siteSwitches } from "./exportgate";
import { burnStage, errorName, errorType, transcribeStage, cancelAfterBucket } from "./burnerror";

export { burnStage, errorName, errorType, failureCode, transcribeStage, durationBucket, cancelAfterBucket } from "./burnerror";

const CONTEXT_KEY = "opensubs.funnel.signin";
const METHOD_KEY = "opensubs.funnel.method";
const MAX_AGE_MS = 60 * 60 * 1000;
/** How long an event waits for the counter's tag, which loads deferred. */
const TAG_WAIT_MS = 8000;

type Props = Record<string, string>;
type Track = (name: string, data: Props) => void;

let on: Promise<boolean> | null = null;
/** Is sending switched on, for this page load? */
export function enabled(): Promise<boolean> {
  on ??= onWeb() ? siteSwitches().then((s) => s.funnelEvents === true) : Promise.resolve(false);
  return on;
}

export function deviceType(
  ua = typeof navigator === "undefined" ? "" : navigator.userAgent,
  touch = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints,
): string {
  if (/Android/i.test(ua)) return "android";
  if (/iPhone|iPod/i.test(ua)) return "iphone";
  if (/iPad/i.test(ua) || (/Macintosh/.test(ua) && touch > 1)) return "ipad";
  if (/Mobi/i.test(ua)) return "other-mobile";
  return "desktop";
}

function tag(): Promise<Track | null> {
  return new Promise((resolve) => {
    const started = Date.now();
    const look = () => {
      const umami = (globalThis as { umami?: { track?: Track } }).umami;
      if (typeof umami?.track === "function") return resolve(umami.track.bind(umami));
      if (Date.now() - started > TAG_WAIT_MS) return resolve(null);
      setTimeout(look, 200);
    };
    look();
  });
}

// One after another, so the counter receives them in the order they happened.
let queue: Promise<void> = Promise.resolve();
function send(name: string, props: Props): void {
  queue = queue.then(async () => {
    if (!(await enabled())) return;
    const track = await tag();
    try {
      track?.(name, { ...props, device: deviceType() });
    } catch {
      // Reporting is never worth breaking an export over.
    }
  });
}

function read<T>(key: string): T | null {
  try {
    return JSON.parse(sessionStorage.getItem(key) || "null") as T | null;
  } catch {
    return null;
  }
}
function write(key: string, value: unknown): void {
  try {
    if (value == null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Without storage a provider sign-in is not reported; nothing else changes.
  }
}

interface Context {
  tool: string;
  at: number;
  reported?: boolean;
}
function context(): Context | null {
  const c = read<Context>(CONTEXT_KEY);
  if (!c || !Number.isFinite(c.at) || Date.now() - c.at > MAX_AGE_MS) return null;
  return c;
}

// How the visitor signs in is decided inside the login element. Its client
// is the page's one shared client, so its sign-in calls are wrapped to note
// the route taken: a challenge names the signing scheme, an email code is
// email, and a provider redirect names the provider before the page is left.
const SCHEMES: Record<string, string> = { eip155: "wallet", nostr: "nostr" };
const clean = (v: unknown) =>
  String(v ?? "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 20) || "other";
function watchMethod(): void {
  try {
    const auth = account().auth as unknown as Record<string, unknown> & { __funnelWrapped?: boolean };
    if (!auth || auth.__funnelWrapped) return;
    const wrap = (name: string, method: (...args: unknown[]) => string) => {
      const fn = auth[name];
      if (typeof fn !== "function") return;
      auth[name] = function (this: unknown, ...args: unknown[]) {
        write(METHOD_KEY, method(...args));
        return (fn as (...a: unknown[]) => unknown).apply(this, args);
      };
    };
    wrap("challenge", (scheme) => SCHEMES[String(scheme)] ?? clean(scheme));
    wrap("emailStart", () => "email");
    wrap("emailVerify", () => "email");
    wrap("redirectStartUrl", (provider) => clean(provider));
    auth.__funnelWrapped = true;
  } catch {
    // The sign-in is reported without a method.
  }
}

const TOOL = "burn";

export function burnClick(): void {
  send("burn-click", { tool: TOOL });
}

export function signinShown(): void {
  void enabled().then((yes) => {
    if (!yes) return;
    write(CONTEXT_KEY, { tool: TOOL, at: Date.now() });
    write(METHOD_KEY, null);
    watchMethod();
    send("signin-shown", { tool: TOOL });
  });
}

export function signinDismissed(): void {
  write(CONTEXT_KEY, null);
  write(METHOD_KEY, null);
  send("signin-dismissed", { tool: TOOL });
}

// Kept work, around the sign-in. Tool and device only: never the file, its
// name, the subtitles or their age.
export function pendingRestored(): void {
  send("pending-restored", { tool: TOOL });
}

export function pendingRecovered(): void {
  send("pending-recovered", { tool: TOOL });
}

export function pendingExpired(): void {
  send("pending-expired", { tool: TOOL });
}

/**
 * A session now exists. Reported once per sheet: the session listener can
 * hear one sign-in several times, and a return from a provider is heard
 * both at start-up and when the exchange lands.
 */
export function signedIn(): void {
  const c = context();
  if (!c || c.reported) return;
  write(CONTEXT_KEY, { ...c, reported: true });
  const method = read<string>(METHOD_KEY) || "unknown";
  write(METHOD_KEY, null);
  send("signin-complete", { tool: c.tool, method });
}

// When the current burn began, for the "how long before it was cancelled"
// bucket. This tab only, one burn at a time; 0 until a burn starts.
let burnStartedAt = 0;

export function burnStart(): void {
  // The journey the sheet began is over: a later sign-in is not its.
  if (context()?.reported) write(CONTEXT_KEY, null);
  burnStartedAt = Date.now();
  send("burn-start", { tool: TOOL });
}

export function burnComplete(): void {
  send("burn-complete", { tool: TOOL });
}

export function burnFailed(note: string | null | undefined, error: unknown): void {
  // A run the visitor stopped is not a failure, and must not be counted as
  // one: the Cancel button aborts the export, which lands here. It is reported
  // as its own event instead, never as burn-failed, with the step it had
  // reached and how far in the cancel came -- so where and when people give up
  // can be seen without inflating the failure count.
  if (errorType(error) === "cancelled") {
    send("burn-cancelled", {
      tool: TOOL,
      stage: burnStage(note),
      after: cancelAfterBucket(burnStartedAt ? Date.now() - burnStartedAt : -1),
    });
    return;
  }
  send("burn-failed", { tool: TOOL, stage: burnStage(note), error: errorType(error), ename: errorName(error) });
}

export function subtitleDownload(format: "srt" | "vtt" | "ass" | "txt"): void {
  send("subtitle-download", { tool: format });
}

// Subtitle generation (speech to text). The same shape as burn-*, plus an
// interrupted that the next load backfills when a run's page was closed or
// reloaded mid-transcription — the step that was missing, so there was no
// way to see how many people failed to get subtitles or where it stopped.
//
// The in-progress marker is in localStorage (not sessionStorage): it has to
// survive the tab being ended for memory and the page loading again, which
// is exactly the case it is for. Written at the start, kept current with the
// stage and whether the page went to the background, and removed the moment
// the run ends in a way the page sees.
const TRANSCRIBE = "transcribe";
const RUN_KEY = "opensubs.funnel.transcribe";
const RUN_MAX_AGE_MS = 6 * 60 * 60 * 1000;

interface TranscribeInfo {
  lang: string;
  engine: string;
  dur: string;
  /** On-device runs only: where the model came from, "cn" (ModelScope) or "us" (Hugging Face). */
  src?: string;
}
interface TranscribeRun extends TranscribeInfo {
  stage: string;
  bg: boolean;
  at: number;
}

function readRun(): TranscribeRun | null {
  try {
    return JSON.parse(globalThis.localStorage?.getItem(RUN_KEY) || "null") as TranscribeRun | null;
  } catch {
    return null;
  }
}
function writeRun(value: TranscribeRun | null): void {
  try {
    if (value == null) globalThis.localStorage?.removeItem(RUN_KEY);
    else globalThis.localStorage?.setItem(RUN_KEY, JSON.stringify(value));
  } catch {
    // Private browsing or storage full: the run goes unmarked, and a reload
    // in the middle of it is not reported, as it was not before.
  }
}

// The page went to the background while a transcription ran; noted on the
// marker so an interruption can say whether backgrounding was involved —
// the phone case this whole event exists for.
let watchingTranscribe = false;
function watchTranscribeHidden(): void {
  if (watchingTranscribe || typeof document === "undefined") return;
  watchingTranscribe = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "hidden") return;
    const run = readRun();
    if (run && !run.bg) writeRun({ ...run, bg: true });
  });
}

export function transcribeStart(info: TranscribeInfo): void {
  void enabled().then((yes) => {
    if (!yes) return;
    writeRun({ ...info, stage: "prepare", bg: false, at: Date.now() });
    watchTranscribeHidden();
    send("transcribe-start", { tool: TRANSCRIBE, ...info });
  });
}

/** Keep the marker's stage current, so an interruption names where it died. */
export function transcribeProgress(stage: string | null | undefined): void {
  const run = readRun();
  const named = transcribeStage(stage);
  if (run && run.stage !== named) writeRun({ ...run, stage: named });
}

export function transcribeComplete(info: TranscribeInfo): void {
  writeRun(null);
  send("transcribe-complete", { tool: TRANSCRIBE, ...info });
}

export function transcribeFailed(
  stage: string | null | undefined,
  error: unknown,
  info: TranscribeInfo,
): void {
  // Read the marker (for when the run began) before clearing it. The marker
  // goes either way, so a stopped run is never backfilled as interrupted on
  // the next load.
  const run = readRun();
  writeRun(null);
  // A run the visitor cancelled is not a failure, the same as a burn: its own
  // event, never transcribe-failed, carrying the same lang/engine/dur plus the
  // step reached and how far in the cancel came.
  if (errorType(error) === "cancelled") {
    send("transcribe-cancelled", {
      tool: TRANSCRIBE,
      stage: transcribeStage(stage),
      after: cancelAfterBucket(run && Number.isFinite(run.at) ? Date.now() - run.at : -1),
      ...info,
    });
    return;
  }
  send("transcribe-failed", {
    tool: TRANSCRIBE,
    stage: transcribeStage(stage),
    error: errorType(error),
    ename: errorName(error),
    ...info,
  });
}

/**
 * A transcription whose page the browser ended — a memory kill on a phone, a
 * reload, the tab closed — leaves its marker behind, since nothing ran to
 * remove it. Called once at start-up: if a marker is here and recent, it is
 * that interruption, reported as transcribe-failed with error=interrupted and
 * the stage it had reached, then cleared so it is counted once.
 */
export function reportTranscribeInterrupted(): void {
  const run = readRun();
  if (!run) return;
  writeRun(null);
  if (!Number.isFinite(run.at) || Date.now() - run.at > RUN_MAX_AGE_MS) return;
  send("transcribe-failed", {
    tool: TRANSCRIBE,
    stage: run.stage || "prepare",
    error: "interrupted",
    bg: run.bg ? "1" : "0",
    lang: run.lang ?? "",
    engine: run.engine ?? "",
    dur: run.dur ?? "",
  });
}
