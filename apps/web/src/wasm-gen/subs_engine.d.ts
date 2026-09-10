/* tslint:disable */
/* eslint-disable */

/**
 * Put fetched translations onto their cues, re-wrapping each to the target
 * script's line budget and leaving every timestamp untouched.
 */
export function applyTranslations(cues_json: string, translations_json: string): string;

/**
 * The `opensubs burn` command that reproduces this export locally.
 *
 * This, rather than a raw ffmpeg line, is what the page offers first: the
 * CLI probes the actual file, so it gets colour tags, rotation, VFR and
 * HDR right, none of which a browser can see. The ffmpeg command below is
 * the fallback for someone who does not have OpenSubs installed.
 */
export function cliCommand(request_json: string): string;

/**
 * How long the exported clip runs, for progress and for the UI.
 */
export function clipDuration(start: number, end: number, source_duration: number): number;

/**
 * What one credit is worth in USD, and what a pack costs.
 *
 * Exposed so the interface can print a dollar figure beside every quote
 * from the same constant the pricing uses, rather than keeping its own
 * copy that quietly goes stale.
 */
export function creditPricing(): string;

/**
 * What is free, what is premium, and what this build gates.
 */
export function features(): string;

/**
 * The raw ffmpeg command for the same export, burning an ASS file the page
 * has already produced.
 */
export function ffmpegCommand(request_json: string): string;

/**
 * The offered target languages.
 */
export function languages(): string;

/**
 * The largest emphasis the engine will apply, whatever is requested.
 */
export function maxEmphasisStrength(): number;

/**
 * The strongest glow the engine will apply, whatever is requested.
 */
export function maxGlow(): number;

/**
 * Both languages as one cue list, for the `.srt` and `.vtt` exports.
 *
 * The page could concatenate the two line lists itself, and did. It must
 * not: the ASS writer undoes a machine's line wrap before stacking the
 * languages, so a caller merging them by hand puts a three-line cue in
 * the text export and a two-line one in the burned video. One function,
 * one answer.
 */
export function mergeBilingual(top_json: string, bottom_json: string): string;

/**
 * The smallest a supporting bilingual line may be set, as a fraction.
 */
export function minBilingualScale(): number;

/**
 * Read an existing `.srt` or `.vtt`. Format is detected from content.
 */
export function parseSubtitles(text: string): string;

/**
 * Pull the translations out of a Claude response body, enforcing that the
 * count matches — a short response would otherwise desynchronise every
 * later cue against its timestamp.
 */
export function parseTranslateResponse(body: string, expected: number): string;

/**
 * Every shipped preset, both packs, as a JSON array.
 */
export function presets(): string;

/**
 * What transcribing `seconds` of audio on our own backend costs, in
 * credits. Billed on the trimmed span, which is all that gets sent.
 */
export function quoteTranscription(seconds: number): string;

/**
 * What translating these lines on our own backend will cost, in credits.
 *
 * `lines_json` is an array of strings — the subtitle text as it will be
 * sent. The result is a [`subs_credits::Quote`] as JSON; the interface
 * should show `credits` and nothing else.
 *
 * Quoted here rather than server-side on purpose. The price appears before
 * the user commits, with no round trip and no account needed to see it,
 * and the backend recomputes the identical number from the identical code
 * when it charges — so the two cannot disagree.
 */
export function quoteTranslation(lines_json: string, target: string): string;

/**
 * The dimensions an export would actually encode at, as `[w, h]`.
 */
export function resolveSize(display_w: number, display_h: number, target_height: number): Uint32Array;

/**
 * Turn word-level ASR output into reading-comfortable cues.
 *
 * `fps_num`/`fps_den` are the video's frame rate as an exact rational, so
 * cue boundaries land on real frames. 30/1 is a safe default when the page
 * cannot determine it — a `<video>` element does not expose frame rate.
 */
export function segmentTranscript(transcript_json: string, fps_num: number, fps_den: number): string;

/**
 * Route panics to `console.error` instead of an opaque `unreachable`
 * trap. Idempotent, and safe to call from every entry point.
 */
export function start(): void;

/**
 * One preset as an editable template document.
 */
export function styleTemplate(name: string): string;

/**
 * Render cues to an ASS document at a given display size.
 *
 * `play_w`/`play_h` must be the dimensions the subtitles will actually be
 * composited at. Getting this wrong is the single most common cause of
 * soft, mis-scaled subtitles (design spec §3.4), and it is why the page
 * passes the video's real `videoWidth`/`videoHeight` rather than the size
 * of the element on screen.
 */
export function toAss(cues_json: string, style: string, play_w: number, play_h: number): string;

/**
 * Render two languages in one cue, each at its own size.
 *
 * `top_json` and `bottom_json` are cue arrays of equal length carrying
 * the same timings in two languages; the caller decides which language
 * goes on top. Scales are fractions of the style's own size and are
 * clamped by the engine.
 *
 * This exists because the page cannot do it: cue text is escaped on the
 * way into a Dialogue line, so an override written into the text arrives
 * as literal `\{` -- which is exactly the protection that stops a
 * subtitle file restyling the video, and not something to route around.
 */
export function toAssBilingual(top_json: string, bottom_json: string, style: string, play_w: number, play_h: number, top_scale: number, bottom_scale: number): string;

/**
 * Loudness emphasis on one language of a bilingual cue.
 *
 * The levels belong to the language `effect_on_top` names -- the one the
 * audio was measured against.
 */
export function toAssBilingualEmphasised(top_json: string, bottom_json: string, style: string, play_w: number, play_h: number, top_scale: number, bottom_scale: number, effect_on_top: boolean, emphasis_json: string, strength: number): string;

/**
 * Karaoke on one language of a bilingual cue, the other drawn plainly.
 *
 * `effect_on_top` says which half was spoken. It is not a style choice:
 * word timings come from the audio the transcript was made of, so the
 * highlight belongs to the original whichever way round the two are
 * stacked. The effects used to switch off entirely when both languages
 * were shown, which threw away the half that *was* timed.
 */
export function toAssBilingualKaraoke(top_json: string, bottom_json: string, style: string, play_w: number, play_h: number, top_scale: number, bottom_scale: number, effect_on_top: boolean, strength: number, glow: number, accent: string): string;

/**
 * Render cues to ASS with per-word size emphasis driven by the audio.
 *
 * `emphasis_json` is an array-of-arrays: one array per cue, one value per
 * whitespace-separated word, each 0..1 where 1 is the loudest moment of
 * the clip. `strength` scales the effect and is capped by the engine.
 *
 * A cue whose word count does not match its levels renders unemphasised
 * rather than shifting the emphasis onto the wrong word.
 */
export function toAssEmphasised(cues_json: string, style: string, play_w: number, play_h: number, emphasis_json: string, strength: number): string;

/**
 * Render cues so each word grows and glows at the moment it is spoken.
 *
 * Unlike [`to_ass_emphasised_js`] this is driven by time rather than by
 * loudness, so it needs no audio and works on imported subtitles too.
 * `accent` is the glow colour as `#RRGGBB`.
 */
export function toAssKaraoke(cues_json: string, style: string, play_w: number, play_h: number, strength: number, glow: number, accent: string): string;

export function toSrt(cues_json: string): string;

export function toVtt(cues_json: string): string;

/**
 * Build a transcript from segment-level ASR output, synthesising word
 * timings the same way the desktop does.
 *
 * Browser Whisper reports sentences, not words -- the small quantised ONNX
 * exports are not built with the cross-attentions word timestamps need.
 * The desktop's `af_whisper` has exactly the same limitation, so both go
 * through one shared synthesis rather than each inventing its own, which
 * is what keeps the two front ends breaking lines identically.
 */
export function transcriptFromSegments(segments_json: string, language: string): string;

/**
 * Build the Claude Messages API request body for one batch of cue text.
 *
 * The page performs the `fetch` itself — a browser has one, and linking an
 * HTTP client into wasm to duplicate it would be silly — but the prompt,
 * the schema and the batching rules stay here so the two front ends ask
 * for exactly the same thing.
 */
export function translateRequestBody(texts_json: string, target: string, source: string): string;

/**
 * How many cues go in one translation request.
 */
export function translationBatchSize(): number;

/**
 * Why a clip cannot be exported, or an empty string if it can.
 */
export function trimError(start: number, end: number, source_duration: number): string;

/**
 * Validate a hand-edited template. Returns the normalised document, or an
 * error naming the offending field.
 */
export function validateStyle(json: string): string;

/**
 * The engine version, so the page can show what it is actually running.
 */
export function version(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly applyTranslations: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly cliCommand: (a: number, b: number, c: number) => void;
    readonly creditPricing: (a: number) => void;
    readonly features: (a: number) => void;
    readonly ffmpegCommand: (a: number, b: number, c: number) => void;
    readonly languages: (a: number) => void;
    readonly mergeBilingual: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly parseSubtitles: (a: number, b: number, c: number) => void;
    readonly parseTranslateResponse: (a: number, b: number, c: number, d: number) => void;
    readonly presets: (a: number) => void;
    readonly quoteTranscription: (a: number, b: number) => void;
    readonly quoteTranslation: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly resolveSize: (a: number, b: number, c: number, d: number) => void;
    readonly segmentTranscript: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly styleTemplate: (a: number, b: number, c: number) => void;
    readonly toAss: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly toAssBilingual: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly toAssBilingualEmphasised: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number) => void;
    readonly toAssBilingualKaraoke: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number, m: number, n: number, o: number, p: number) => void;
    readonly toAssEmphasised: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => void;
    readonly toAssKaraoke: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number) => void;
    readonly toSrt: (a: number, b: number, c: number) => void;
    readonly toVtt: (a: number, b: number, c: number) => void;
    readonly transcriptFromSegments: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly translateRequestBody: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => void;
    readonly trimError: (a: number, b: number, c: number, d: number) => void;
    readonly validateStyle: (a: number, b: number, c: number) => void;
    readonly version: (a: number) => void;
    readonly maxEmphasisStrength: () => number;
    readonly maxGlow: () => number;
    readonly minBilingualScale: () => number;
    readonly translationBatchSize: () => number;
    readonly clipDuration: (a: number, b: number, c: number) => number;
    readonly start: () => void;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
