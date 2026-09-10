// Typed facade over the Rust engine compiled to wasm (crates/subs-wasm).
//
// The generated glue in ../wasm-gen speaks JSON strings; everything above
// this file speaks objects. Keeping the parsing here means one place knows
// the boundary format, and the rest of the app never sees a JSON.parse.
//
// This is the same code the desktop app and the CLI run. Line breaking,
// reading-speed limits, ASS generation, translation rewrapping and the
// free/premium catalogue are all decided in Rust, so the browser cannot
// drift from the other two front ends.

import init, {
  applyTranslations,
  cliCommand,
  clipDuration,
  features,
  ffmpegCommand,
  languages,
  parseSubtitles,
  parseTranslateResponse,
  presets,
  resolveSize,
  segmentTranscript,
  styleTemplate,
  toAss,
  toAssEmphasised,
  toAssKaraoke,
  toAssBilingual,
  toAssBilingualKaraoke,
  toAssBilingualEmphasised,
  mergeBilingual,
  minBilingualScale,
  maxGlow,
  maxEmphasisStrength,
  toSrt,
  transcriptFromSegments,
  toVtt,
  translateRequestBody,
  translationBatchSize,
  trimError,
  validateStyle,
  version,
} from "../wasm-gen/subs_engine.js";

// Vite resolves this to a hashed URL at build time and leaves the .wasm as
// a separate file, so the browser can stream-compile it.
import wasmUrl from "../wasm-gen/subs_engine_bg.wasm?url";

export interface Cue {
  start: number;
  end: number;
  lines: string[];
}

export interface Style {
  name: string;
  pack: "Core" | "Advanced" | "Custom";
  font: string;
  sizePct: number;
  alignment: number;
  primaryHex: string;
  backHex: string;
  borderStyle: "outline" | "box";
}

export interface Feature {
  id: string;
  title: string;
  tier: "Free" | "Premium";
  /** Matches `subs_tier::Cost` — the shared vocabulary the badges use. */
  cost: "free" | "free-or-own-key" | "own-key" | "paid";
  costLabel: string;
  costNote: string;
  why: string;
  unlocked: boolean;
}

export interface Language {
  code: string;
  name: string;
  endonym: string;
}

export interface BurnRequest {
  input: string;
  output: string;
  width: number;
  height: number;
  duration: number;
  fps?: number;
  style?: string;
  start?: number;
  end?: number;
  targetHeight?: number;
  assPath?: string;
}

let ready: Promise<void> | null = null;

/** Compile and instantiate the engine. Safe to call repeatedly. */
export function load(): Promise<void> {
  ready ??= init({ module_or_path: wasmUrl }).then(() => undefined);
  return ready;
}

export function engineVersion(): string {
  return version();
}

// --- styles ------------------------------------------------------------

export function listStyles(): Style[] {
  return JSON.parse(presets());
}

export function styleDocument(name: string): string {
  return styleTemplate(name);
}

/** Returns the normalised template, or throws with the offending field. */
export function checkStyle(json: string): string {
  return validateStyle(json);
}

// --- cues --------------------------------------------------------------

/** Read an existing .srt/.vtt. Throws a readable message on a bad file. */
export function readSubtitles(text: string): Cue[] {
  return JSON.parse(parseSubtitles(text));
}

export function writeSrt(cues: Cue[]): string {
  return toSrt(JSON.stringify(cues));
}

export function writeVtt(cues: Cue[]): string {
  return toVtt(JSON.stringify(cues));
}

/**
 * `playW`/`playH` must be the video's intrinsic size, not the size of the
 * element on screen -- the ASS document is resolution-bound.
 */
export function writeAss(
  cues: Cue[],
  style: string,
  playW: number,
  playH: number,
): string {
  return toAss(JSON.stringify(cues), style, playW, playH);
}

/**
 * As `writeAss`, but each word is sized by how loud it was.
 *
 * `emphasis` is one array per cue, one value per whitespace-separated
 * word. A cue whose counts do not line up renders unemphasised rather
 * than putting the emphasis on the wrong word.
 */
export function writeAssEmphasised(
  cues: Cue[],
  style: string,
  playW: number,
  playH: number,
  emphasis: number[][],
  strength: number,
): string {
  return toAssEmphasised(
    JSON.stringify(cues),
    style,
    playW,
    playH,
    JSON.stringify(emphasis),
    strength,
  );
}

/** The largest emphasis the engine will apply, whatever is asked for. */
export function emphasisCap(): number {
  return maxEmphasisStrength();
}

/**
 * Render cues so each word grows and glows as it is spoken.
 *
 * Driven by the cue's own timings rather than by measured loudness, so
 * this needs no audio and applies to imported subtitles too. `accent` is
 * the glow colour as `#RRGGBB`.
 */
export function writeAssKaraoke(
  cues: Cue[],
  style: string,
  playW: number,
  playH: number,
  strength: number,
  glow: number,
  accent: string,
): string {
  return toAssKaraoke(JSON.stringify(cues), style, playW, playH, strength, glow, accent);
}

/**
 * Render two languages in one cue, each at its own size.
 *
 * `top` and `bottom` are the same cues in two languages and must be the
 * same length; the caller decides which language leads. Scales are
 * fractions of the style's size, clamped by the engine.
 *
 * This has to happen in the engine. Merging the two line lists in JS and
 * calling `writeAss` is the obvious approach and gives both languages the
 * same size -- cue text is escaped on the way in, so an override written
 * into the text arrives as a literal brace, which is exactly the
 * protection that stops a subtitle file restyling someone's video.
 */
export function writeAssBilingual(
  top: Cue[],
  bottom: Cue[],
  style: string,
  playW: number,
  playH: number,
  topScale: number,
  bottomScale: number,
): string {
  return toAssBilingual(
    JSON.stringify(top),
    JSON.stringify(bottom),
    style,
    playW,
    playH,
    topScale,
    bottomScale,
  );
}

/**
 * Karaoke on one language of a bilingual cue, the other drawn plainly.
 *
 * `effectOnTop` says which half was spoken, and it is not a style choice:
 * the word timings come from the audio the transcript was made of, so the
 * highlight belongs to the original however the two are stacked. Running it
 * down the translation would march through a line whose word order and word
 * count nothing here can map to the audio.
 */
export function writeAssBilingualKaraoke(
  top: Cue[],
  bottom: Cue[],
  style: string,
  playW: number,
  playH: number,
  topScale: number,
  bottomScale: number,
  effectOnTop: boolean,
  strength: number,
  glow: number,
  accent: string,
): string {
  return toAssBilingualKaraoke(
    JSON.stringify(top),
    JSON.stringify(bottom),
    style,
    playW,
    playH,
    topScale,
    bottomScale,
    effectOnTop,
    strength,
    glow,
    accent,
  );
}

/**
 * Loudness emphasis on one language of a bilingual cue.
 *
 * `emphasis` belongs to the language `effectOnTop` names -- the one the
 * audio was measured against.
 */
export function writeAssBilingualEmphasised(
  top: Cue[],
  bottom: Cue[],
  style: string,
  playW: number,
  playH: number,
  topScale: number,
  bottomScale: number,
  effectOnTop: boolean,
  emphasis: number[][],
  strength: number,
): string {
  return toAssBilingualEmphasised(
    JSON.stringify(top),
    JSON.stringify(bottom),
    style,
    playW,
    playH,
    topScale,
    bottomScale,
    effectOnTop,
    JSON.stringify(emphasis),
    strength,
  );
}

/**
 * Both languages as one cue list, for the `.srt` and `.vtt` exports.
 *
 * Not a JS concatenation of the two line lists, which is what this was.
 * The ASS writer undoes a machine's line wrap before stacking the
 * languages -- otherwise a cue that arrived wrapped onto two lines becomes
 * a three-line cue the moment a translation goes under it -- and a text
 * export that merged the lines itself would disagree with the picture.
 */
export function mergeBilingualCues(top: Cue[], bottom: Cue[]): Cue[] {
  return JSON.parse(mergeBilingual(JSON.stringify(top), JSON.stringify(bottom))) as Cue[];
}

/** The smallest a supporting bilingual line may be set. */
export function bilingualScaleFloor(): number {
  return minBilingualScale();
}

/** The strongest glow the engine will apply, whatever is asked for. */
export function glowCap(): number {
  return maxGlow();
}

export interface Word {
  start: number;
  end: number;
  text: string;
  confidence: number;
}

export interface Transcript {
  language: string;
  duration: number;
  words: Word[];
  segments: { start: number; end: number; text: string }[];
}

/**
 * Word timings in, reading-comfortable cues out. A `<video>` element does
 * not expose a frame rate, so 30/1 is the default; it only affects which
 * frame boundary a cue snaps to.
 */
export function segment(
  transcript: Transcript,
  fpsNum = 30,
  fpsDen = 1,
): Cue[] {
  return JSON.parse(segmentTranscript(JSON.stringify(transcript), fpsNum, fpsDen));
}

export interface Segment {
  start: number;
  end: number;
  text: string;
}

/**
 * Turn sentence-level ASR output into a transcript with per-word timings.
 *
 * The synthesis lives in Rust and is shared with the desktop, which needs
 * it for exactly the same reason: neither ffmpeg's `af_whisper` nor the
 * quantised ONNX Whisper exports report real word timestamps.
 */
export function transcriptFrom(segments: Segment[], language = "en"): Transcript {
  return JSON.parse(transcriptFromSegments(JSON.stringify(segments), language));
}

// --- clip and size -----------------------------------------------------

/** Empty string when the clip is exportable. */
export function clipError(start: number, end: number, duration: number): string {
  return trimError(start, end, duration);
}

export function clipLength(start: number, end: number, duration: number): number {
  return clipDuration(start, end, duration);
}

/** `targetHeight` of 0 means the source's own height. */
export function exportSize(
  width: number,
  height: number,
  targetHeight: number,
): [number, number] {
  const out = resolveSize(width, height, targetHeight);
  return [out[0], out[1]];
}

// --- handing the burn off ----------------------------------------------

export function opensubsCommand(request: BurnRequest): string {
  return cliCommand(JSON.stringify(request));
}

export function rawFfmpegCommand(request: BurnRequest): string {
  return ffmpegCommand(JSON.stringify(request));
}

// --- translation -------------------------------------------------------

export function listLanguages(): Language[] {
  return JSON.parse(languages());
}

export function batchSize(): number {
  return translationBatchSize();
}

// Re-exported for src/lib/translate.ts, which owns provider selection. The
// prompt, the response schema and the cue rewrapping stay in the engine so
// every provider is held to the same contract.
export { applyTranslations, translateRequestBody, parseTranslateResponse };

export function listFeatures(): Feature[] {
  return JSON.parse(features());
}
