// Generating subtitles from the video's own audio, on this machine.
//
// Whisper, compiled to ONNX and run by transformers.js on WebGPU (falling
// back to WASM). The audio never leaves the browser; the only thing
// fetched from the network is the model itself, once, after which it lives
// in the browser's cache. That is the same arrangement the desktop app
// already uses -- it downloads ggml Whisper weights from the same
// huggingface.co repository into `~/.cache/opensubs-models`.
//
// # "Can this be done without AI?"
//
// Not usefully, and it is worth being straight about why rather than
// shipping something weak to tick a box. Every speech recogniser that
// works on real audio is a statistical acoustic model; the pre-neural ones
// (Sphinx, Kaldi's GMM-HMM) are still models, just older and markedly less
// accurate, and they need per-domain grammars to be tolerable. There is no
// rule-based path from a waveform to words.
//
// The distinction that *does* matter for a user is **local versus cloud**,
// and that is the one this file acts on: this runs on your machine, costs
// nothing, needs no key, and uploads nothing.

import {
  ALL_FORMATS,
  AudioBufferSink,
  BlobSource,
  Input,
} from "mediabunny";

import { load, transcriptFrom, type Segment, type Transcript } from "./engine";
import { cleanUp, mergeBriefs } from "./cleanup";

/** Whisper's native input rate. Anything else is resampled to it. */
const TARGET_SAMPLE_RATE = 16_000;

/** Matches `subs_tier::Cost`; the badges come from one vocabulary. */
export type Cost = "free" | "free-or-own-key" | "own-key" | "paid";

export interface AsrEngineOption {
  id: string;
  label: string;
  note: string;
  cost: Cost;
  needsKey: boolean;
  keyPlaceholder?: string;
  /** Lets a user point at any OpenAI-compatible transcription endpoint. */
  needsBaseUrl?: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
}

/**
 * Where the speech recognition runs.
 *
 * Local is the default and always will be: it is free, private, and good
 * enough for clear speech. The hosted options exist because a large cloud
 * model is markedly better on accents, noise and proper nouns — which is
 * exactly where a local `tiny` model earns its complaints.
 */
export const ASR_ENGINES: AsrEngineOption[] = [
  {
    id: "local",
    label: "On this device",
    note: "Whisper running here. Nothing is uploaded and nothing is charged.",
    cost: "free",
    needsKey: false,
  },
  {
    id: "openai",
    label: "OpenAI-compatible API",
    note:
      "Any server with a Whisper transcription endpoint — OpenAI, Groq (very fast), or a local one. Sends the clip's audio to that service.",
    cost: "own-key",
    needsKey: true,
    keyPlaceholder: "sk-...",
    needsBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "whisper-1",
  },
  {
    id: "opensubs",
    label: "OpenSubs",
    note:
      "Our own backend. A large hosted model with no key and no account elsewhere \u2014 paid in credits, priced before you run it.",
    cost: "paid",
    needsKey: false,
  },
];

/**
 * Our own transcription endpoint. Unset in a default build, which is what
 * keeps the OpenSubs option out of the list entirely: a paid route that
 * cannot run is worse than an absent one.
 */
const OPENSUBS_ASR_ENDPOINT: string = import.meta.env.VITE_OPENSUBS_ASR_URL ?? "";

/** Whether the hosted recogniser can be offered at all in this build. */
export function opensubsAsrConfigured(): boolean {
  return Boolean(OPENSUBS_ASR_ENDPOINT);
}

/** The transcription routes this build can actually run. */
export function availableAsrEngines(): AsrEngineOption[] {
  return ASR_ENGINES.filter((e) => e.id !== "opensubs" || opensubsAsrConfigured());
}

export interface AsrModel {
  id: string;
  label: string;
  /** Approximate download, once. */
  size: string;
  note: string;
  /** English-only models are smaller and better at English. */
  englishOnly: boolean;
}

/**
 * The offered models, smallest first.
 *
 * Deliberately short. The desktop ships three for the same reason: a
 * dropdown of fifteen checkpoints is a worse product than three that span
 * the real trade-off, which is download size against accuracy.
 */
export const ASR_MODELS: AsrModel[] = [
  {
    id: "onnx-community/whisper-tiny.en",
    label: "Tiny (English)",
    size: "~40 MB",
    note: "Fastest. Fine for clear speech.",
    englishOnly: true,
  },
  {
    id: "onnx-community/whisper-base",
    label: "Base",
    size: "~80 MB",
    note: "A good default. Handles 99 languages.",
    englishOnly: false,
  },
  {
    id: "onnx-community/whisper-small",
    label: "Small",
    size: "~250 MB",
    note: "Most accurate here, and the slowest.",
    englishOnly: false,
  },
];

export interface AsrProgress {
  stage: "audio" | "model" | "transcribing";
  /** 0..1 where known, otherwise null for an indeterminate stage. */
  fraction: number | null;
  note: string;
}

/**
 * How loud each word was, relative to the loudest in the clip.
 *
 * One array per cue, one value per whitespace-separated word, 0..1. Feeds
 * the ASS writer's size emphasis.
 */
export type Loudness = number[][];

export interface AsrResult {
  transcript: Transcript;
  /**
   * The languages actually heard, in the order they first appear.
   *
   * More than one means the audio is bilingual and the transcript now
   * carries both -- which the interface has to say out loud, because a
   * subtitle file that switches script halfway looks like a fault
   * otherwise.
   */
  languages?: string[];
  /** The decoded mono audio, kept so loudness can be measured per cue. */
  audio: Float32Array;
  /** Seconds of source timeline the audio starts at. */
  audioOffset: number;
}

export interface AsrOptions {
  file: File;
  model: string;
  /** Clip start on the source timeline. */
  start: number;
  /** Clip end, or null for the end of the file. */
  end: number | null;
  /** A language code, or "auto"/undefined to detect it from the audio. */
  language?: string;
  /**
   * A second language, when the speaker knows there are exactly two.
   *
   * Detection is then only allowed to choose between the two, which is
   * strictly more accurate than choosing between ninety-nine: a stretch
   * of accented English or a noisy interview that came back as Korean
   * cannot, because Korean is not on the ballot.
   */
  secondLanguage?: string;
  onProgress?: (progress: AsrProgress) => void;
  signal?: AbortSignal;
  /**
   * Whether a clip that is *entirely* hallucination may come back empty.
   *
   * For a whole file the answer is no, and `false` is the default: if the
   * clean-up would remove every line, the file was probably quiet rather
   * than fake, and an empty subtitle file is not an improvement on a wrong
   * one. The user can see and delete a bad line; they cannot recover a
   * good one that was never written.
   *
   * For one window of a live capture the answer is yes. A ten-second
   * window of silence, music or applause is ordinary -- it happens before
   * the speaker starts and between every scene -- and its only output is
   * whatever the model says over nothing. Restoring that is not caution,
   * it is putting "Music" on screen for ten seconds. There are more
   * windows coming, so declining to be the reason there is nothing costs
   * the caller nothing.
   */
  allowEmpty?: boolean;
}

export interface AsrSupport {
  ok: boolean;
  /** "webgpu" is roughly an order of magnitude faster than "wasm". */
  device: "webgpu" | "wasm";
  reason?: string;
}

/**
 * How much bigger the download is without WebGPU.
 *
 * The WASM backend cannot load the quantised weights at all (see
 * `transcribeLocally`), so it pulls the fp32 export instead -- roughly
 * four times the bytes. Worth telling the user before they wait for it.
 */
export const WASM_SIZE_MULTIPLIER = 4;

export async function asrSupport(): Promise<AsrSupport> {
  if (typeof AudioBuffer === "undefined" || typeof OfflineAudioContext === "undefined") {
    return { ok: false, device: "wasm", reason: "This browser has no Web Audio support." };
  }
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (gpu) {
    try {
      if (await gpu.requestAdapter()) return { ok: true, device: "webgpu" };
    } catch {
      // Fall through to WASM; an adapter request can throw on machines
      // where WebGPU is present but unusable.
    }
  }
  return { ok: true, device: "wasm" };
}

/**
 * Decode the clip's audio to mono 16 kHz.
 *
 * Only the trimmed range is decoded, which matters: transcription time is
 * proportional to audio length, so cutting a 30-second clip out of an hour
 * costs 30 seconds of work rather than an hour of it.
 */
async function extractAudio(
  file: File,
  start: number,
  end: number | null,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<Float32Array> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error("That video has no audio track to transcribe.");

    const duration = await input.computeDuration();
    const from = Math.max(0, start);
    const to = end != null && end > from ? Math.min(end, duration) : duration;
    const span = Math.max(0, to - from);
    if (span <= 0) throw new Error("The clip has no length.");

    const sink = new AudioBufferSink(track);
    const chunks: Float32Array[] = [];
    let total = 0;
    let sourceRate = TARGET_SAMPLE_RATE;

    for await (const wrapped of sink.buffers(from, to)) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const buffer = wrapped.buffer;
      sourceRate = buffer.sampleRate;

      // Downmix to mono by averaging: Whisper wants one channel, and
      // taking only the left would lose anything panned right.
      const frames = buffer.length;
      const mono = new Float32Array(frames);
      for (let c = 0; c < buffer.numberOfChannels; c += 1) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < frames; i += 1) mono[i] += data[i];
      }
      if (buffer.numberOfChannels > 1) {
        for (let i = 0; i < frames; i += 1) mono[i] /= buffer.numberOfChannels;
      }

      chunks.push(mono);
      total += frames;
      onProgress?.(Math.min(1, (wrapped.timestamp - from) / span));
    }

    if (total === 0) throw new Error("No audio could be decoded from that clip.");

    const joined = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      joined.set(chunk, offset);
      offset += chunk.length;
    }

    if (Math.abs(sourceRate - TARGET_SAMPLE_RATE) < 1) return joined;
    return await resample(joined, sourceRate, TARGET_SAMPLE_RATE);
  } finally {
    input.dispose();
  }
}

/** Resample via OfflineAudioContext, which does it properly. */
async function resample(
  samples: Float32Array,
  from: number,
  to: number,
): Promise<Float32Array> {
  const frames = Math.max(1, Math.round((samples.length * to) / from));
  const context = new OfflineAudioContext(1, frames, to);
  const buffer = context.createBuffer(1, samples.length, from);
  buffer.copyToChannel(samples, 0);
  const source = context.createBufferSource();
  source.buffer = buffer;
  source.connect(context.destination);
  source.start();
  const rendered = await context.startRendering();
  return rendered.getChannelData(0).slice();
}

/** transformers.js is imported lazily: it is ~10 MB and most sessions never transcribe. */
let pipelinePromise: Promise<unknown> | null = null;
let loadedModelId: string | null = null;

interface WhisperChunk {
  text: string;
  timestamp: [number, number | null];
}

/**
 * Per-word loudness for a set of cues, as RMS normalised across the clip.
 *
 * Accurate only to the accuracy of the word timings it samples, and those
 * are synthesised — no backend here reports real per-word times, so a
 * word's span is its share of its segment by character count. The
 * emphasis therefore lands on approximately the right word; on a short
 * emphatic word beside a long quiet one it can land one word out.
 *
 * A perceptual curve, not raw RMS: amplitude is linear and loudness is
 * not, so the square root keeps ordinary speech from all reading as
 * "quiet" next to one shouted word.
 */
export function loudnessFor(
  cues: { start: number; end: number; lines: string[] }[],
  audio: Float32Array,
  audioOffset = 0,
  sampleRate = TARGET_SAMPLE_RATE,
): Loudness {
  const rmsAt = (from: number, to: number): number => {
    const a = Math.max(0, Math.floor((from - audioOffset) * sampleRate));
    const b = Math.min(audio.length, Math.ceil((to - audioOffset) * sampleRate));
    if (b <= a) return 0;
    let sum = 0;
    for (let i = a; i < b; i += 1) sum += audio[i] * audio[i];
    return Math.sqrt(sum / (b - a));
  };

  // Measure every word first, then normalise: "loud" only means anything
  // relative to the rest of this clip.
  const perCue: number[][] = [];
  let peak = 0;
  let floor = Infinity;
  for (const cue of cues) {
    const words = cue.lines.join(" ").split(/\s+/).filter(Boolean);
    const span = Math.max(0.001, cue.end - cue.start);
    const chars = words.reduce((n, w) => n + w.length, 0) || 1;
    let cursor = cue.start;
    const levels: number[] = [];
    for (const word of words) {
      const width = (word.length / chars) * span;
      const value = rmsAt(cursor, cursor + width);
      cursor += width;
      levels.push(value);
      if (value > peak) peak = value;
      if (value < floor) floor = value;
    }
    perCue.push(levels);
  }

  // Normalise against the clip's own range, not against silence. Speech
  // sits in a narrow band of amplitudes, so dividing by the peak alone
  // maps every word into roughly 0.6..1.0 and the emphasis is invisible --
  // measured on a real clip, the quietest word still came out 17% larger.
  // Anchoring the quietest word at zero spends the whole range on the
  // differences that exist.
  const range = peak - floor;
  if (!(range > 0)) return perCue.map((levels) => levels.map(() => 0));
  // Square root because loudness is perceived logarithmically; without it
  // only the single loudest word looks emphasised at all.
  return perCue.map((levels) =>
    levels.map((v) => Math.sqrt(Math.min(1, Math.max(0, (v - floor) / range)))),
  );
}

/**
 * Transcribe by posting the audio to an OpenAI-compatible endpoint.
 *
 * The audio really does leave the machine here — that is the trade the
 * user makes for a bigger model, and the UI says so before they choose it.
 * Only the trimmed span is sent, encoded as a WAV, so a 20-second clip
 * from an hour-long file uploads 20 seconds.
 */
export async function transcribeRemotely(
  options: AsrOptions & {
    apiKey: string;
    baseUrl?: string;
    remoteModel?: string;
    /**
     * Send to our own endpoint instead, with no key. It speaks the same
     * multipart shape on purpose -- one upload path, one set of error
     * messages, and swapping a user's key for our backend changes a URL
     * rather than a code path.
     */
    hosted?: boolean;
  },
): Promise<AsrResult> {
  const { file, start, end, language, onProgress, signal, apiKey } = options;
  if (options.hosted && !OPENSUBS_ASR_ENDPOINT) {
    throw new Error(
      "The OpenSubs transcription endpoint is not configured in this build. " +
        "Use \u201cOn this device\u201d, which is free, or bring your own key.",
    );
  }
  const base = options.hosted
    ? OPENSUBS_ASR_ENDPOINT.replace(/\/+$/, "")
    : (options.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = options.remoteModel || "whisper-1";

  onProgress?.({ stage: "audio", fraction: 0, note: "Reading the audio" });
  const audio = await extractAudio(
    file,
    start,
    end,
    (fraction) => onProgress?.({ stage: "audio", fraction, note: "Reading the audio" }),
    signal,
  );

  onProgress?.({ stage: "transcribing", fraction: null, note: "Sending the audio" });

  const form = new FormData();
  form.append("file", new Blob([wavFrom(audio)], { type: "audio/wav" }), "audio.wav");
  form.append("model", model);
  // Sentence-level timings, which is all these endpoints offer and all the
  // engine needs -- per-word times are synthesised either way.
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  // ISO-639-1, which is what these endpoints take; the app's own codes
  // carry script and region that Whisper has no notion of.
  //
  // Nothing was sent here before, so the service auto-detected once for
  // the whole file and applied that one language throughout -- which on
  // bilingual audio means the majority language is forced onto every
  // other speaker. Unlike the on-device route this cannot be fixed per
  // window from here: one file goes up, one language comes back. Naming
  // the language is the only lever, and now it reaches the wire.
  if (language && language !== "auto") form.append("language", whisperCode(language));

  const response = await fetch(`${base}/audio/transcriptions`, {
    method: "POST",
    // Our own endpoint authenticates the account, not a vendor key, so
    // there is nothing to send here yet.
    headers: options.hosted ? {} : { authorization: `Bearer ${apiKey}` },
    body: form,
    signal,
  });

  const raw = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new Error("That transcription service rejected the key.");
    }
    throw new Error(`The transcription service returned ${response.status}: ${raw.slice(0, 200)}`);
  }

  let parsed: { segments?: { start: number; end: number; text: string }[]; text?: string };
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("The transcription service did not return JSON.");
  }

  const segments: Segment[] = (parsed.segments ?? [])
    .map((seg) => ({ start: seg.start, end: seg.end, text: readable(seg.text ?? "") }))
    .filter((seg) => seg.text);

  if (segments.length === 0) {
    throw new Error("No speech was recognised in that clip.");
  }

  // The Rust engine has to be instantiated before it can be called, and
  // this module cannot assume its host has done it. The web app happens to
  // load the engine while the interface is starting up; the extension and
  // any future front end have no such moment. `load()` is idempotent and
  // resolves immediately once it has run, so paying for the check here
  // costs the web app nothing and makes this file self-contained.
  await load();

  return {
    transcript: transcriptFrom(segments, language ?? "auto"),
    audio,
    audioOffset: 0,
  };
}

/** Wrap mono 16 kHz float samples as a 16-bit PCM WAV. */
function wavFrom(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i += 1) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return buffer;
}

/**
 * The size at which a downloaded file is worth putting on the progress bar.
 *
 * The config and tokeniser files are kilobytes; the weights are hundreds of
 * megabytes. Only the second kind is what anyone is waiting for.
 */
const SUBSTANTIAL_DOWNLOAD = 1_000_000;

/** Whisper's context window, in seconds of audio. */
const CHUNK_LENGTH_S = 30;
/** Overlap between neighbouring windows, so a word on a seam is not lost. */
const STRIDE_LENGTH_S = 5;

/**
 * How much audio each language reading looks at, in seconds.
 *
 * Measured against the reported footage, whose switch from an English
 * voiceover to a Chinese interview falls at about 60 seconds:
 *
 *   30 s -> called it Chinese from 45 s: fifteen seconds early
 *   15 s -> correct at the switch, one stray reading later on
 *   10 s -> correct throughout
 *    5 s -> correct throughout
 *
 * Thirty seconds is not merely imprecise, it is *wrong*: a window holding
 * twenty seconds of English and ten of Chinese comes back as Chinese, so
 * the English is transcribed as Chinese and arrives as plausible Chinese
 * nonsense -- the same failure this exists to fix, mirrored.
 *
 * Ten was the next answer and was also wrong, for a reason the single
 * seam under test could not show. A news package does not switch language
 * twice; it switches constantly, and the stretches are short. Mapped
 * across the whole of the reported file, the English narration returns
 * for 104-112 s, 140-148 s and 192-208 s. A ten-second cell cannot see an
 * eight-second insert at all: both cells overlapping it read as the
 * language on either side, and sixteen seconds of narration was
 * transcribed as Chinese -- which is not a wrong word here and there, it
 * is a minute of the video captioned in a language nobody is speaking.
 *
 * Four seconds is short enough that the shortest insert in real footage
 * covers two cells. The cost is one encoder pass per cell -- the encoder
 * runs on a padded 30-second spectrogram whatever it is handed, so a
 * shorter window is not a cheaper one, and this is two and a half times
 * the reads. It buys the difference between subtitles and noise. Naming
 * one language skips all of it.
 */
const DETECT_WINDOW_S = 4;

/**
 * The window and step used to place a change once it has been found.
 *
 * Ten seconds finds a change reliably but reports it on a ten-second
 * grid, so the cut landed up to ten seconds from where the speaker
 * actually changed. Refining it matters more than it sounds: a cut two
 * seconds early leaves two seconds of the *old* language at the head of
 * the new language's pass, and Whisper does not skip what it cannot
 * place -- it invents. Measured on the reported footage, "Businesses are
 * already positioning themselves for the boom" came back as
 * 这已经有提供了财富的资料了。
 *
 * Four-second windows a second apart, which is where the reading stops
 * being ambiguous: on that footage every window through 59 s reads
 * English and every window from 60 s reads Chinese, cleanly, with nothing
 * indeterminate between.
 */
const REFINE_WINDOW_S = 4;
const REFINE_STEP_S = 2;
/**
 * How far either side of the grid boundary the true change can be.
 *
 * One cell: the cells are what found the change, so it cannot be further
 * away than the cell that noticed it.
 */
const REFINE_SPAN_S = 4;

/**
 * How far either side of the estimate to look for a pause to cut at.
 *
 * Deliberately small, and it used to be two seconds. A language change is
 * a speaker change and speaker changes have gaps, so cutting at the
 * quietest moment avoids splitting a word between two passes. But a wide
 * search finds the quietest moment in the *region* rather than the pause
 * at the change, and on the reported footage that dragged the cut a
 * second and a half back into the English -- undoing the refinement that
 * had just placed it correctly. The estimate is good to about a second
 * now, so the search only has to cover a second.
 */
const SNAP_RADIUS_S = 0.75;
/**
 * And it only moves at all for a real pause: a frame has to be this much
 * quieter than the speech around it. Otherwise the estimate stands,
 * because a marginally quieter moment mid-word is not a seam.
 */
const SNAP_QUIET_RATIO = 0.4;

/**
 * How many windows the pipeline will cut this audio into.
 *
 * Deliberately mirrors the loop in transformers.js's
 * `AutomaticSpeechRecognitionPipeline._call_whisper` rather than
 * approximating it with a division: the last window is whatever is left
 * over, and `ceil(length / jump)` is off by one for exactly the lengths
 * that land on a boundary. A count that is one too low shows 105% and one
 * too high stops the bar short of the end, and both look like a bug.
 */
export function whisperWindows(samples: number, chunkLengthS: number, strideLengthS: number): number {
  const window = TARGET_SAMPLE_RATE * chunkLengthS;
  const jump = window - 2 * TARGET_SAMPLE_RATE * strideLengthS;
  if (jump <= 0 || samples <= 0) return 1;
  let offset = 0;
  let count = 0;
  while (true) {
    count += 1;
    if (offset + window >= samples) return count;
    offset += jump;
  }
}

/**
 * Which language is being spoken, and where it changes.
 *
 * # Why this exists rather than being left to the library
 *
 * transformers.js does not implement Whisper's language detection. Asked
 * for none, it takes one:
 *
 *     if (!language) {
 *         // TODO: Implement language detection
 *         logger.warn('No language specified - defaulting to English (en).');
 *         language = 'en';
 *     }
 *
 * So "auto" was English, silently, and a Chinese interview came back as
 * fluent, confident, entirely invented English. Measured on a real
 * bilingual news piece: the Chinese segments produced "Locals are finding
 * ways to benefit from the launches too", "I like it", "you" -- none of
 * which was said. That is worse than failing, because it looks like a
 * transcript.
 *
 * Whisper detects the language itself: after `<|startoftranscript|>` the
 * very next token it predicts *is* the language. One decoder step per
 * window reads it out.
 *
 * # Why per window rather than once per file
 *
 * Because the videos this was reported on are bilingual -- an English
 * news voiceover around Chinese interviews. Detecting once picks the
 * language with the most minutes and forces every other speaker through
 * it. Whisper's window is 30 seconds, so that is the granularity at which
 * the language can change; a window containing a switch resolves to one
 * of the two.
 */
export interface LanguageRun {
  /** Sample offsets into the decoded audio. */
  from: number;
  to: number;
  /** A Whisper language code: "en", "zh", "ja"... */
  language: string;
}

interface WhisperInternals {
  model: {
    generation_config: {
      lang_to_id?: Record<string, number>;
      decoder_start_token_id: number;
      suppress_tokens?: number[];
    };
    generate(options: Record<string, unknown>): Promise<unknown>;
  };
  processor(audio: Float32Array): Promise<{ input_features: unknown }>;
}

/** Read the language token Whisper predicts first for one window. */
async function detectWindow(
  pipe: WhisperInternals,
  window: Float32Array,
  idToLang: Map<number, string>,
  suppress: number[],
): Promise<string | null> {
  const { input_features } = await pipe.processor(window);
  const out = (await pipe.model.generate({
    inputs: input_features,
    max_new_tokens: 1,
    decoder_input_ids: [pipe.model.generation_config.decoder_start_token_id],
    // Appended to the model's own list rather than replacing it: this
    // suppresses the languages the user has ruled out, and must not
    // quietly un-suppress everything Whisper suppresses for its own
    // reasons.
    ...(suppress.length > 0
      ? {
          suppress_tokens: [
            ...(pipe.model.generation_config.suppress_tokens ?? []),
            ...suppress,
          ],
        }
      : {}),
  })) as { sequences?: { tolist(): unknown[] }[] } & { tolist?: () => unknown[] }[];
  const first = (out as { sequences?: { tolist(): unknown[] }[] }).sequences?.[0] ?? out[0];
  const ids = first?.tolist?.() as (number | bigint)[] | undefined;
  if (!ids?.length) return null;
  return idToLang.get(Number(ids[ids.length - 1])) ?? null;
}

/**
 * Split the audio into stretches that are each one language.
 *
 * Adjacent windows agreeing on a language are merged, so a single-language
 * file comes back as one run and is transcribed in one pass -- the common
 * case pays only for the detection, not for a fragmented transcript.
 */
async function languageRuns(
  transcriber: unknown,
  audio: Float32Array,
  allowed: string[],
  onProgress?: (progress: AsrProgress) => void,
  signal?: AbortSignal,
): Promise<LanguageRun[]> {
  const pipe = transcriber as WhisperInternals;
  const langToId = pipe.model?.generation_config?.lang_to_id;
  // An English-only checkpoint has no language tokens to choose between.
  if (!langToId) return [{ from: 0, to: audio.length, language: "en" }];
  const idToLang = new Map(
    Object.entries(langToId).map(([token, id]) => [id, token.replace(/[<|>]/g, "")]),
  );

  // Naming the languages narrows the ballot. Left empty, every language
  // Whisper knows is a candidate -- which is right when nobody has said
  // what is being spoken, and is how a bilingual English/Chinese clip
  // came back reporting Korean as well.
  const suppress =
    allowed.length > 0
      ? [...idToLang].filter(([, code]) => !allowed.includes(code)).map(([id]) => id)
      : [];

  const cell = DETECT_WINDOW_S * TARGET_SAMPLE_RATE;
  const cells = Math.max(1, Math.ceil(audio.length / cell));
  const labels: string[] = [];

  for (let i = 0; i < cells; i += 1) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    // `slice`, not `subarray`: a copy with its own buffer, because what
    // reaches an ONNX session should not depend on a view's byteOffset.
    const window = audio.slice(i * cell, Math.min((i + 1) * cell, audio.length));
    labels.push((await detectWindow(pipe, window, idToLang, suppress)) ?? allowed[0] ?? "en");
    onProgress?.({
      stage: "transcribing",
      fraction: (i + 1) / cells,
      note: "Listening for the language",
    });
  }

  // A single disagreeing cell is treated as noise -- a bar of music, a
  // held silence, one ambiguous sentence.
  //
  // This is a deliberately weak rule and it used to be stronger, when the
  // cells were ten seconds: back then it erased the *only* cell that had
  // caught an eight-second return to English, and the narration was
  // captioned in Chinese. Two cells now means eight seconds, which is
  // about as short as a real stretch of speech gets, so anything that
  // survives two cells is believed.
  for (let i = 1; i < labels.length - 1; i += 1) {
    if (labels[i] !== labels[i - 1] && labels[i - 1] === labels[i + 1]) labels[i] = labels[i - 1];
  }

  const runs: LanguageRun[] = [];
  for (const [i, language] of labels.entries()) {
    const to = Math.min((i + 1) * cell, audio.length);
    const last = runs[runs.length - 1];
    if (last && last.language === language) last.to = to;
    else runs.push({ from: i * cell, to, language });
  }

  // Put each change where it actually happened, not on the grid that
  // found it.
  const refineWindow = REFINE_WINDOW_S * TARGET_SAMPLE_RATE;
  for (let i = 1; i < runs.length; i += 1) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    const after = runs[i].language;
    const span = REFINE_SPAN_S * TARGET_SAMPLE_RATE;
    const lo = Math.max(runs[i - 1].from, runs[i].from - span);
    const hi = Math.min(runs[i].to - refineWindow, runs[i].from + span);
    let lastBefore: number | null = null;
    let firstAfter: number | null = null;
    for (let at = lo; at <= hi; at += REFINE_STEP_S * TARGET_SAMPLE_RATE) {
      const window = audio.slice(at, at + refineWindow);
      const heard = await detectWindow(pipe, window, idToLang, suppress);
      if (heard === after) {
        firstAfter = at;
        break;
      }
      lastBefore = at;
    }
    // A window reads as a language once most of it is that language, so
    // the change lies after the middle of the last window that still read
    // as the old one and before the middle of the first that read as the
    // new one. Taking the midpoint of those two bounds is the estimate;
    // taking only the first window that changed, as this did at first,
    // reports the change up to half a window early.
    const estimate =
      firstAfter === null
        ? runs[i].from
        : lastBefore === null
          ? firstAfter + refineWindow / 2
          : (lastBefore + firstAfter) / 2 + refineWindow / 2;
    const cut = quietestNear(
      audio,
      Math.max(runs[i - 1].from + 1, Math.min(estimate, runs[i].to - 1)),
      SNAP_RADIUS_S * TARGET_SAMPLE_RATE,
    );
    runs[i - 1].to = cut;
    runs[i].from = cut;
  }

  return runs.filter((run) => run.to > run.from);
}

/** Which language was being read at a given time, in seconds. */
function languageAt(runs: LanguageRun[], at: number): string {
  const sample = at * TARGET_SAMPLE_RATE;
  for (const run of runs) {
    if (sample < run.to) return run.language;
  }
  return runs[runs.length - 1]?.language ?? "en";
}

/**
 * The quietest 100 ms within `radius` of `centre`, as a sample offset.
 *
 * Used to choose where one language's pass stops and the next begins, so
 * the seam falls in a gap between utterances rather than through a word.
 */
function quietestNear(audio: Float32Array, centre: number, radius: number): number {
  const frame = Math.round(0.1 * TARGET_SAMPLE_RATE);
  const from = Math.max(0, centre - radius);
  const to = Math.min(audio.length - frame, centre + radius);
  if (to <= from) return Math.max(0, Math.min(centre, audio.length));

  let quietest = centre;
  let lowest = Infinity;
  let total = 0;
  let frames = 0;
  for (let at = from; at <= to; at += frame) {
    let energy = 0;
    for (let i = at; i < at + frame; i += 4) energy += audio[i] * audio[i];
    total += energy;
    frames += 1;
    // Ties go to the frame nearest the estimate: with a long silence the
    // energies are all but equal, and drifting to one end of it would put
    // the cut further from the change than the estimate already was.
    if (energy < lowest - 1e-9) {
      lowest = energy;
      quietest = at;
    }
  }
  // Only move for an actual pause. A moment that is merely a little
  // quieter than its neighbours is somewhere inside a word, and the
  // estimate -- which was measured -- is the better answer.
  const mean = frames > 0 ? total / frames : 0;
  if (!(lowest < mean * SNAP_QUIET_RATIO)) return Math.max(0, Math.min(centre, audio.length));
  return quietest + Math.round(frame / 2);
}

export async function transcribeLocally(options: AsrOptions): Promise<AsrResult> {
  const { file, model, start, end, language, onProgress, signal, allowEmpty } = options;

  const support = await asrSupport();
  if (!support.ok) throw new Error(support.reason ?? "Transcription is not supported here.");

  onProgress?.({ stage: "audio", fraction: 0, note: "Reading the audio" });
  const audio = await extractAudio(
    file,
    start,
    end,
    (fraction) =>
      onProgress?.({ stage: "audio", fraction, note: "Reading the audio" }),
    signal,
  );

  onProgress?.({ stage: "model", fraction: null, note: "Loading the speech model" });

  /** Bytes per weight file, so the download reports as one figure. */
  const downloaded = new Map<string, { loaded: number; total: number }>();

  const { pipeline, env } = await import("@huggingface/transformers");

  // Serve ONNX Runtime's WebAssembly backend from our own origin.
  //
  // Left alone, transformers.js points ORT at cdn.jsdelivr.net and fetches
  // `ort-wasm-simd-threaded.*` from there the first time a model runs. Two
  // problems with that, and the second is the serious one:
  //
  // 1. Our Content-Security-Policy does not list jsdelivr, so the fetch is
  //    blocked and transcription dies with "no available backend found" --
  //    in production only, since a dev server sends no CSP.
  // 2. This product's whole claim is that nothing leaves your machine but
  //    what you choose to send. A silent runtime dependency on a third
  //    party CDN is a claim we would be making falsely, and it is one our
  //    own privacy page enumerates: Hugging Face for the model, and
  //    nothing else.
  //
  // Widening the CSP would fix (1) and make (2) worse. Self-hosting fixes
  // both, and removes a runtime dependency on somebody else's uptime.
  // Optional in the type because a build can target Node, where there is
  // no wasm backend. In a browser it is always there.
  const wasm = env.backends?.onnx?.wasm;
  if (wasm) wasm.wasmPaths = new URL("./ort/", document.baseURI).href;

  if (loadedModelId !== model) {
    pipelinePromise = null;
    loadedModelId = model;
  }
  pipelinePromise ??= pipeline("automatic-speech-recognition", model, {
    device: support.device,
    // Quantised weights on WebGPU, full precision on WASM -- and this is
    // not a tuning preference, it is a hard constraint.
    //
    // `q8` and `int8` both fail outright on ONNX Runtime's WASM backend
    // for these Whisper exports: session creation dies with
    // "TransposeDQWeightsForMatMulNBits Missing required scale". WebGPU
    // loads the same weights happily. Choosing q8 everywhere therefore
    // works on the developer's machine and breaks for every user without
    // WebGPU, which is a large share of Firefox, Safari and older
    // hardware. `fp32` costs a much bigger download but actually runs.
    dtype: support.device === "webgpu" ? "q8" : "fp32",
    // The download reports per *file*, and the model is several.
    //
    // Three shapes were tried against a real cold download before this
    // one. Passing `event.progress` straight through makes the bar jump to
    // whichever file reported last -- 80%, then 12%, then 60%. Labelling
    // each file as a "part" reads well on paper and is unreadable in
    // practice, because the weight files are fetched *concurrently*: the
    // label flickered between "part 2 · 14%" and "part 3 · 1%" several
    // times a second.
    //
    // Summing bytes is the one that behaves. It has a known flaw -- the
    // denominator grows as files announce themselves, so the figure drops
    // once, early, when the first file completes before the rest have said
    // how big they are -- and that is a single step backwards in the first
    // seconds rather than a number that argues with itself throughout.
    progress_callback: (event: {
      status?: string;
      progress?: number;
      file?: string;
      loaded?: number;
      total?: number;
    }) => {
      if (event.status !== "progress") return;
      if (
        event.file &&
        typeof event.loaded === "number" &&
        typeof event.total === "number" &&
        event.total >= SUBSTANTIAL_DOWNLOAD
      ) {
        downloaded.set(event.file, { loaded: event.loaded, total: event.total });
      }
      let loaded = 0;
      let total = 0;
      for (const f of downloaded.values()) {
        loaded += f.loaded;
        total += f.total;
      }
      onProgress?.({
        stage: "model",
        // Nothing substantial has announced itself yet. Say that the size
        // is unknown rather than borrow a figure from a config file that
        // is about to stop mattering.
        fraction: total > 0 ? Math.min(loaded / total, 1) : null,
        note: "Downloading the speech model",
      });
    },
  });

  const transcriber = (await pipelinePromise) as ((
    audio: Float32Array,
    options: Record<string, unknown>,
  ) => Promise<{ text: string; chunks?: WhisperChunk[] }>) &
    Record<string, unknown>;

  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");

  const englishOnly = model.endsWith(".en");
  // A second language only means anything beside a first one: "detect it,
  // but one of them is definitely Chinese" is not a thing to ask for, and
  // reading a leftover second choice as the only choice would silently
  // force the whole file into it.
  const primary = language && language !== "auto" && language !== "none" ? language : null;
  const secondary =
    primary && options.secondLanguage && options.secondLanguage !== "none"
      ? options.secondLanguage
      : null;
  const named = [primary, secondary]
    .filter((code): code is string => Boolean(code))
    .map(whisperCode)
    .filter((code, i, all) => all.indexOf(code) === i);

  // Where each language starts and stops.
  //
  // An English-only checkpoint has one answer by construction, and so does
  // a single named language -- neither pays for detection. Two named
  // languages still need detecting, because the point is knowing which of
  // them is being spoken *when*; naming them only narrows what detection
  // is allowed to answer. Naming nothing leaves it open to all ninety-nine.
  const runs: LanguageRun[] =
    englishOnly || named.length === 1
      ? [{ from: 0, to: audio.length, language: named[0] ?? "en" }]
      : await languageRuns(transcriber, audio, named, onProgress, signal);

  // Real progress through the audio, not a bar that spins.
  //
  // Whisper transcribes one 30-second window at a time and, until this,
  // the whole run was a single `await` that reported nothing. On a long
  // video that is minutes of a moving-but-meaningless bar, which is
  // indistinguishable from a hang -- and the honest thing for someone
  // deciding whether to wait is to say how much is left.
  //
  // `generate()` calls `streamer.end()` once per window, and the pipeline
  // forwards anything it is handed straight into `generate`, so a streamer
  // that counts its own `end()` calls counts finished windows. `put()`
  // fires per token and is deliberately ignored: token counts vary by
  // window, so counting them would make the bar jump about. The total is
  // summed across the runs, so one bar covers the whole job however many
  // languages it turns out to be in.
  const windows = runs.reduce(
    (n, run) => n + whisperWindows(run.to - run.from, CHUNK_LENGTH_S, STRIDE_LENGTH_S),
    0,
  );
  let finished = 0;
  const streamer = {
    put() {},
    end() {
      finished += 1;
      onProgress?.({
        stage: "transcribing",
        // Never past the end: the window count is this file's arithmetic
        // and the pipeline's, and if they ever disagree a bar stuck at
        // 100% beats one reading 130%.
        fraction: Math.min(finished / Math.max(windows, 1), 1),
        note: "Listening to the audio",
      });
    },
  };
  onProgress?.({ stage: "transcribing", fraction: 0, note: "Listening to the audio" });

  const segments: Segment[] = [];
  /** How far the previous pass got, including any sentence it finished. */
  let spokenUpTo = 0;
  for (const run of runs) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    // Each stretch goes through the pipeline whole rather than window by
    // window, so its own overlap handling still stitches words that span a
    // seam. Only a real language change breaks that continuity, and a
    // language change is a change of speaker.
    // Each pass reads a little past its own end, and keeps only what it
    // began.
    //
    // A cut is placed where the *language* changes, and a sentence does
    // not always stop there: on the reported footage the English voiceover
    // was still finishing "positioning themselves for the boom" while the
    // Chinese interview had started underneath it. Ending the English pass
    // at the cut left it mid-phrase, and "for the boom" fell between the
    // two passes -- transcribed by neither, because the Chinese pass had
    // it but was reading it as Chinese.
    //
    // So a pass reads a few seconds beyond the cut, and keeps a segment
    // only if that segment *started* before the cut. Finishing a sentence
    // already under way is exactly what the overrun is for; transcribing
    // the next speaker in the wrong language is what it must not become.
    //
    // Copied rather than viewed -- see the note in `languageRuns`. A view
    // here meant every stretch transcribed the start of the recording
    // again instead of its own audio.
    const readTo = Math.min(run.to + LEAD_OUT_S * TARGET_SAMPLE_RATE, audio.length);
    const result = await transcriber(audio.slice(run.from, readTo), {
      streamer,
      // Sentence-level timestamps, not `"word"`.
      //
      // Word timestamps need a model exported with `output_attentions=True`
      // so the decoder's cross-attentions can be read; the small quantised
      // ONNX Whisper builds are not, and asking for them throws outright
      // ("Model outputs must contain cross attentions to extract
      // timestamps"). Per-word timings are synthesised below instead --
      // which is exactly what the desktop does, because ffmpeg's
      // `af_whisper` has the same limitation.
      return_timestamps: true,
      // Whisper's context is 30 seconds; longer audio is windowed, with
      // overlap so a word spanning a boundary is not lost.
      chunk_length_s: CHUNK_LENGTH_S,
      stride_length_s: STRIDE_LENGTH_S,
      // Whisper of this size gets stuck in loops: one window of the test
      // footage produced "专业的专业专业的专业" for twenty seconds, and
      // the same failure exists in English. Blocking a repeated n-gram is
      // the cheap half of the standard mitigation (the other half,
      // retrying the window at a higher temperature, needs control this
      // pipeline does not expose). Six is long enough that ordinary
      // repetition in speech survives it.
      no_repeat_ngram_size: 6,
      ...(englishOnly ? {} : { language: run.language, task: "transcribe" }),
    });

    // Timestamps come back relative to the slice, so they are put back on
    // the clip's own timeline before anything downstream sees them.
    const offset = run.from / TARGET_SAMPLE_RATE;
    const cut = run.to / TARGET_SAMPLE_RATE;
    for (const chunk of result.chunks ?? []) {
      const text = readable(chunk.text);
      if (!text) continue;
      const [chunkStart, chunkEnd] = chunk.timestamp;
      if (typeof chunkStart !== "number") continue;
      const start = offset + chunkStart;
      // Began after this pass's own audio ended: that is the next
      // speaker, and the next pass will read them in their own language.
      if (start >= cut) continue;
      const finish =
        offset +
        (typeof chunkEnd === "number" && chunkEnd > chunkStart
          ? chunkEnd
          : chunkStart + Math.max(0.3, text.length * 0.06));
      // Already said in full by the pass before, which ran on past the cut
      // to finish its sentence. Only *fully* covered: the two languages
      // genuinely overlap here -- an English voiceover still finishing
      // over the first seconds of a Chinese interview -- and dropping
      // everything that merely starts inside the overrun threw away a
      // whole Chinese sentence to keep three English words.
      if (finish <= spokenUpTo) continue;
      segments.push({
        start,
        // A final chunk can come back with a null end; give it a plausible
        // length rather than a zero-length segment the segmenter rejects.
        end:
          offset +
          (typeof chunkEnd === "number" && chunkEnd > chunkStart
            ? chunkEnd
            : chunkStart + Math.max(0.3, text.length * 0.06)),
        text,
      });
      spokenUpTo = Math.max(spokenUpTo, segments[segments.length - 1].end);
    }
  }

  if (segments.length === 0) {
    throw new Error(
      "No speech was recognised in that clip. If it is not silent, try a larger model.",
    );
  }

  const kept = splitLong(dropOverlong(segments));
  segments.length = 0;
  segments.push(...kept);
  await fillGaps(segments, runs, audio, transcriber, englishOnly, signal);
  // After the gap filling, never before it. Removing a hallucinated line
  // leaves a gap where it was, and a filler running afterwards would read
  // that same silence again and write the same line straight back in.
  const clean = cleanUp(segments, {
    level: (from, to) => loudness(audio, from, to),
    languageAt: (at) => languageAt(runs, at),
  });
  // Everything discarded is a sign the recogniser was writing over audio
  // it could not transcribe, and on a quiet file that could in principle
  // be every segment. An empty subtitle file is not an improvement on a
  // wrong one, so the pass declines to be the reason there is nothing --
  // unless the caller says this is one window of many. See `allowEmpty`.
  if (clean.kept.length > 0 || allowEmpty) {
    segments.length = 0;
    segments.push(...clean.kept);
  }
  // Then the timing, on what is left. Joining runs of unreadably short
  // cues comes after the removal deliberately: it must never join a
  // hallucination onto the real line beside it, and it must not run
  // before gap-filling, which is still adding segments.
  const merged = mergeBriefs(segments);
  segments.length = 0;
  segments.push(...merged);
  repairTimings(segments);
  partAtChanges(segments, runs);
  const spoken = [...new Set(runs.map((r) => r.language))];

  // Word timings come from the engine, shared with the desktop. See the
  // note in `transcribeRemotely` for why the load is asked for here.
  await load();
  return {
    transcript: transcriptFrom(segments, spoken.length === 1 ? spoken[0] : "mixed"),
    audio,
    // Whisper reports times from the start of the audio it was given, and
    // that audio began at the trim point.
    audioOffset: 0,
    languages: spoken,
  };
}

/**
 * Cut back a segment that claims far more time than its words can fill.
 *
 * Whisper does not always drop a window it cannot transcribe -- sometimes
 * it returns one segment covering the whole of it with a fragment of text
 * inside. Measured on the reported footage: a single segment from 59.5 to
 * 86.5 seconds, twenty-seven seconds long, carrying thirty characters.
 * Twenty seconds of an interview vanished inside it, and nothing
 * downstream could see that anything was missing: there was no gap to
 * notice, because the bad segment covered it.
 *
 * Both tests have to fail before anything is touched. Long alone is not
 * suspicious -- someone can speak slowly. Sparse alone is not either -- a
 * short interjection is sparse. Thirty characters in twenty-seven seconds
 * is barely one a second, against three or four for even unhurried
 * speech, and that combination is not a person talking.
 *
 * The text goes with it. Keeping it and merely shortening the timestamp
 * was the first attempt, and it put a garbled line at the seam whose
 * words then turned up again, correctly, twenty seconds later when the
 * span was re-read -- because thirty characters drawn from twenty-seven
 * seconds are not a transcript of the first seven of them. They are a
 * smear of the whole window, and there is nowhere honest to put them.
 *
 * What is left behind is an ordinary gap, which [`fillGaps`] then reads
 * again on its own.
 */
function dropOverlong(segments: Segment[]): Segment[] {
  return segments.filter((segment) => {
    const span = segment.end - segment.start;
    return span <= MAX_SEGMENT_S || segment.text.length / span >= MIN_CHARS_PER_SECOND;
  });
}

/**
 * Divide a segment that is longer than a cue may be across its own span.
 *
 * Whisper marks a segment where it hears a sentence end, and in
 * continuous Chinese it often does not hear one for fifteen or twenty
 * seconds. The engine caps a cue at seven, so a fifteen-second segment
 * arrived as a seven-second cue holding every word of it -- unreadably
 * dense, gone while the speaker is still talking, and the eight seconds
 * after it blank. Measured on a synthesised forty-second Chinese clip:
 * two cues, fourteen seconds of subtitle for forty seconds of speech.
 *
 * The text is cut at punctuation nearest each proportional boundary, and
 * each piece is given time in proportion to its length -- which is the
 * same rule the engine uses to synthesise word timings, so a split cue
 * sits where its words are spoken.
 *
 * This is not the engine's job: the engine can lay out cues it is given
 * and cannot invent a boundary inside a segment it was handed as one
 * unit. It is a property of this recogniser's output, so it is corrected
 * where that output arrives.
 */
function splitLong(segments: Segment[]): Segment[] {
  const out: Segment[] = [];
  for (const segment of segments) {
    const span = segment.end - segment.start;
    const pieces = Math.round(span / SPLIT_TARGET_S);
    if (span <= MAX_CUE_S || pieces < 2 || segment.text.length < 12) {
      out.push(segment);
      continue;
    }

    // Where a reader would allow a break, in preference order: a sentence
    // ending, then a clause, then a space. CJK punctuation included --
    // the text this exists for has no spaces in it at all.
    const breaks: number[] = [];
    for (let i = 0; i < segment.text.length - 1; i += 1) {
      if (/[。！？!?…]/.test(segment.text[i])) breaks.push(i + 1);
    }
    if (breaks.length < pieces - 1) {
      for (let i = 0; i < segment.text.length - 1; i += 1) {
        if (/[，、,;；:：]/.test(segment.text[i])) breaks.push(i + 1);
      }
    }
    if (breaks.length < pieces - 1) {
      for (let i = 0; i < segment.text.length - 1; i += 1) {
        if (segment.text[i] === " ") breaks.push(i + 1);
      }
    }
    breaks.sort((a, b) => a - b);
    if (breaks.length === 0) {
      out.push(segment);
      continue;
    }

    const cuts: number[] = [];
    for (let n = 1; n < pieces; n += 1) {
      const want = (segment.text.length * n) / pieces;
      let best = breaks[0];
      for (const at of breaks) {
        if (Math.abs(at - want) < Math.abs(best - want)) best = at;
      }
      if (best > (cuts[cuts.length - 1] ?? 0)) cuts.push(best);
    }

    const bounds = [0, ...cuts, segment.text.length];
    let at = segment.start;
    for (let i = 0; i < bounds.length - 1; i += 1) {
      const text = segment.text.slice(bounds[i], bounds[i + 1]).trim();
      if (!text) continue;
      // Time in proportion to length, which is how word times are
      // synthesised everywhere else here.
      const share = (bounds[i + 1] - bounds[i]) / segment.text.length;
      const end = i === bounds.length - 2 ? segment.end : Math.min(segment.end, at + span * share);
      out.push({ start: at, end: Math.max(end, at + MIN_SEGMENT_S), text });
      at = end;
    }
  }
  return out;
}

/** The longest a single cue may be, matching the engine's own ceiling. */
const MAX_CUE_S = 7;
/** And what a split aims for, so a divided segment reads at a normal pace. */
const SPLIT_TARGET_S = 5;

/**
 * How far past its own end a pass reads, so it can finish a sentence.
 *
 * Long enough for a phrase, short enough that it cannot get through the
 * next speaker's opening line in a language it is not reading.
 */
const LEAD_OUT_S = 3;

/** No spoken segment worth one subtitle runs longer than this. */
const MAX_SEGMENT_S = 12;
/** Slower than this is not speech, whatever the timestamps claim. */
const MIN_CHARS_PER_SECOND = 2;

/** A stretch of speech with no subtitle over it is worth looking at again. */
const GAP_S = 4;
/** Past this, the gap is not a recogniser slip and re-reading it is not cheap. */
const MAX_GAP_S = 60;
/**
 * At most this many second readings, however many gaps there turn out to be.
 *
 * Twelve was not enough once boundaries were placed properly: a file with
 * several language changes has several seams, each seam can leave a gap,
 * and each gap can take more than one round to clear. The budget ran out
 * mid-file and left nineteen seconds unread. Each reading is bounded by
 * `MAX_GAP_S`, so the worst case here is minutes of extra work on a file
 * that is already taking minutes -- against silently dropping speech.
 */
const MAX_REFILLS = 30;
/**
 * ...but no more than one re-read per this many seconds of audio.
 *
 * Thirty is right for a four-minute file with two language changes and
 * far too many for one with eight: every seam can leave a gap, every gap
 * costs a full pass, and a fixed budget that is generous for a short file
 * is a way to spend twenty minutes on one that is not much longer.
 */
const REFILL_SECONDS_EACH = 20;
/** And at most this many rounds of them, so a stubborn gap cannot loop. */
const MAX_REFILL_ROUNDS = 4;
/**
 * How loud a gap must be, against the whole clip, to be worth re-reading.
 *
 * Most gaps are real: silence, music, a held shot. Only the ones with
 * someone talking in them are a failure.
 */
const GAP_SPEECH_RATIO = 0.15;

/**
 * Transcribe again over any stretch of speech that produced nothing.
 *
 * Whisper's pipeline reconciles overlapping windows by matching their
 * tokens, and when that match goes wrong it does not error -- it drops
 * the span. Measured on the reported footage: twenty seconds of a Chinese
 * interview, between 1:06 and 1:26, simply absent from the subtitles.
 *
 * It is also *chaotic*. Moving where a pass begins by half a second
 * reshuffles every 30-second window inside it, and the same audio then
 * loses a different span, or none. Three runs over the same file: 210
 * seconds covered, then 184, then 201. So this cannot be tuned away by
 * choosing better boundaries; the boundaries are not the fault, and a
 * boundary that happens to avoid it on one file is luck, not a fix.
 *
 * What can be done is to notice. Silence needs no subtitle, so a gap is
 * only suspicious when there is sound in it, and then the span is read
 * again on its own -- where it is the whole input rather than one window
 * among many, and there is nothing to reconcile it with.
 */
async function fillGaps(
  segments: Segment[],
  runs: LanguageRun[],
  audio: Float32Array,
  transcriber: (audio: Float32Array, options: Record<string, unknown>) => Promise<{
    text: string;
    chunks?: WhisperChunk[];
  }>,
  englishOnly: boolean,
  signal?: AbortSignal,
): Promise<void> {
  let energy = 0;
  for (let i = 0; i < audio.length; i += 16) energy += audio[i] * audio[i];
  const overall = Math.sqrt(energy / Math.max(1, audio.length / 16));
  if (!(overall > 0)) return;

  // Re-reading is bounded work. A handful of gaps is a recogniser having a
  // bad moment, which is worth fixing; dozens of them means something else
  // is wrong, and grinding through all of them would turn a transcription
  // that finished badly into one that does not finish.
  let budget = Math.min(
    MAX_REFILLS,
    Math.ceil(audio.length / TARGET_SAMPLE_RATE / REFILL_SECONDS_EACH),
  );

  // Rounds, because one re-read often does not finish the job.
  //
  // Measured on the reported footage: asked for 59.5 to 86.5 seconds --
  // twenty-seven seconds of interview -- Whisper returned a single chunk
  // covering the first three, and nonsense at that. Asked for 66.6 to
  // 86.5, it transcribed the lot correctly. Something in the first
  // seconds after the speaker changes poisons the window, and stepping
  // past it is all that is needed. So whatever a re-read leaves uncovered
  // becomes a gap again, and is read again, until nothing new comes back.
  for (let round = 0; round < MAX_REFILL_ROUNDS && budget > 0; round += 1) {
    const found = await fillRound(segments, runs, audio, transcriber, englishOnly, signal, () => budget, (n) => { budget = n; }, overall);
    if (found.length === 0) break;
    segments.push(...found);
    segments.sort((a, b) => a.start - b.start);
  }
}

async function fillRound(
  segments: Segment[],
  runs: LanguageRun[],
  audio: Float32Array,
  transcriber: (audio: Float32Array, options: Record<string, unknown>) => Promise<{
    text: string;
    chunks?: WhisperChunk[];
  }>,
  englishOnly: boolean,
  signal: AbortSignal | undefined,
  getBudget: () => number,
  setBudget: (n: number) => void,
  overall: number,
): Promise<Segment[]> {
  segments.sort((a, b) => a.start - b.start);
  const found: Segment[] = [];
  let budget = getBudget();

  for (const run of runs) {
    const from = run.from / TARGET_SAMPLE_RATE;
    const to = run.to / TARGET_SAMPLE_RATE;
    let cursor = from;
    const inside = segments.filter((seg) => seg.start >= from - 0.5 && seg.start < to);
    for (const seg of [...inside, { start: to, end: to, text: "" }]) {
      const gap = seg.start - cursor;
      if (
        budget > 0 &&
        gap >= GAP_S &&
        gap <= MAX_GAP_S &&
        loudness(audio, cursor, seg.start) > overall * GAP_SPEECH_RATIO
      ) {
        budget -= 1;
        if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
        const slice = audio.slice(
          Math.round(cursor * TARGET_SAMPLE_RATE),
          Math.round(seg.start * TARGET_SAMPLE_RATE),
        );
        const again = await transcriber(slice, {
          return_timestamps: true,
          chunk_length_s: CHUNK_LENGTH_S,
          stride_length_s: STRIDE_LENGTH_S,
          no_repeat_ngram_size: 6,
          ...(englishOnly ? {} : { language: run.language, task: "transcribe" }),
        });
        for (const chunk of again.chunks ?? []) {
          const text = readable(chunk.text);
          const [begin, end] = chunk.timestamp;
          if (!text || typeof begin !== "number") continue;
          // A re-read can smear exactly as the first read did, and one
          // that does must not be kept -- keeping it fills the gap with
          // nonsense and stops the next round retrying the span. Same
          // test as `dropOverlong`, applied to what comes back.
          const covers = (typeof end === "number" && end > begin ? end : begin) - begin;
          if (covers > MAX_SEGMENT_S && text.length / covers < MIN_CHARS_PER_SECOND) continue;
          const start = cursor + begin;
          // Never past the gap it was asked to fill: a refilled span that
          // ran long would overlap the subtitle that follows it.
          if (start >= seg.start) continue;
          found.push({
            start,
            end: Math.min(
              seg.start,
              cursor + (typeof end === "number" && end > begin ? end : begin + 1),
            ),
            text,
          });
        }
      }
      cursor = Math.max(cursor, seg.end);
    }
  }

  setBudget(budget);
  return found;
}

/** RMS between two times, in seconds. */
function loudness(audio: Float32Array, from: number, to: number): number {
  const a = Math.max(0, Math.round(from * TARGET_SAMPLE_RATE));
  const b = Math.min(audio.length, Math.round(to * TARGET_SAMPLE_RATE));
  if (b <= a) return 0;
  let sum = 0;
  let n = 0;
  for (let i = a; i < b; i += 16) {
    sum += audio[i] * audio[i];
    n += 1;
  }
  return n > 0 ? Math.sqrt(sum / n) : 0;
}

/**
 * Give back a plausible duration to any segment that came out with none.
 *
 * Whisper's timestamps are tokens it predicts, not measurements, and near
 * the seam between two of its windows it sometimes emits several in a
 * row: seven words arrived across four segments spanning 133 milliseconds
 * between them. Downstream everything believes those times -- the
 * segmenter spaces cues by them, the preview shows a caption for one
 * frame, and the burned video flickers.
 *
 * Only the impossible ones are touched, and never past the start of the
 * next segment, so a segment that merely runs fast keeps exactly the
 * timing the recogniser gave it. Text is never dropped: a word with a bad
 * timestamp is still a word that was said.
 */
function repairTimings(segments: Segment[]): void {
  segments.sort((a, b) => a.start - b.start);
  // Two cues on screen at once is not a subtitle track. Where the passes
  // overlap -- one language still being spoken as the next begins -- the
  // later line waits rather than being dropped: a line a second late is
  // read; a line that is not there is not.
  for (let i = 1; i < segments.length; i += 1) {
    if (segments[i].start < segments[i - 1].end) {
      segments[i].start = segments[i - 1].end;
      segments[i].end = Math.max(segments[i].end, segments[i].start);
    }
  }
  for (const [i, segment] of segments.entries()) {
    const spoken = Math.max(MIN_SEGMENT_S, segment.text.length * SECONDS_PER_CHAR);
    if (segment.end - segment.start >= MIN_SEGMENT_S) continue;
    const next = segments[i + 1];
    const ceiling = next ? next.start : segment.start + spoken;
    segment.end = Math.max(segment.start, Math.min(segment.start + spoken, ceiling));
  }
}

/**
 * Leave a real pause where the language changes, so no cue holds both.
 *
 * The engine builds a cue from consecutive segments and splits on a
 * silence of at least `pause_split` -- it knows nothing about languages,
 * and it should not have to. Handed two segments a tenth of a second
 * apart it makes one cue of them, which is how a line came out reading
 * "YouTube access and see those rockets. 去年开始慢慢感觉政府": the tail of
 * the English and the head of the Chinese, together, as though someone
 * had said both.
 *
 * A change of language is a change of speaker, so there is a pause there
 * in the audio anyway; this only makes sure the timings show one. The
 * earlier segment gives up the time, because it has already been spoken
 * by the time the next begins.
 */
function partAtChanges(segments: Segment[], runs: LanguageRun[]): void {
  for (let i = 1; i < runs.length; i += 1) {
    const at = runs[i].from / TARGET_SAMPLE_RATE;
    let before: Segment | null = null;
    let after: Segment | null = null;
    for (const segment of segments) {
      if (segment.start < at) before = segment;
      else if (!after) after = segment;
    }
    if (!before || !after) continue;
    const gap = after.start - before.end;
    if (gap >= PAUSE_SPLIT_S) continue;
    const trimmed = after.start - PAUSE_SPLIT_S;
    if (trimmed - before.start >= MIN_SEGMENT_S) before.end = trimmed;
    else after.start = Math.min(after.end - MIN_SEGMENT_S, before.end + PAUSE_SPLIT_S);
  }
}

/**
 * The silence the engine treats as the end of a cue, matching
 * `SegmentConfig::pause_split`. A little over it, so rounding either side
 * cannot close the gap again.
 */
const PAUSE_SPLIT_S = 0.75;

/** Below this, a cue is on screen for less time than it takes to notice. */
const MIN_SEGMENT_S = 0.35;
/** A reading pace, used only to give a broken timestamp a plausible length. */
const SECONDS_PER_CHAR = 0.06;

/**
 * Cue text with the decoder's own debris taken out.
 *
 * A multi-byte character split across the end of a token sequence decodes
 * to U+FFFD REPLACEMENT CHARACTER, which reaches the subtitles as `\uFFFD`
 * and then reaches the font check, which correctly reports that no bundled
 * font can draw it and tells the user to remove an emoji they never typed.
 * It is not content and never was, so it does not survive to the cue.
 */
function readable(text: string): string {
  return text.replace(/\uFFFD/g, "").replace(/\s+/g, " ").trim();
}

/**
 * Turn one of the app's language codes into one Whisper knows.
 *
 * The app speaks BCP-47-ish (`zh-Hans`, `pt-BR`) because that is what
 * translation providers want; Whisper wants the bare ISO-639-1 subtag. It
 * has no notion of script or region -- there is one `zh`, and which script
 * comes out is decided by the audio, not by the tag.
 */
function whisperCode(code: string): string {
  return code.split("-")[0].toLowerCase();
}
