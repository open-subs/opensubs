// Translating subtitles, through whichever service the user prefers.
//
// Every provider here does one job: take N strings, return N strings, in
// order. Everything after that -- the count check, the line rewrapping
// against the target script's budget, the guarantee that no timestamp
// moves -- happens once, in Rust, shared with the desktop. A provider
// cannot change how a line breaks, only what it says.
//
// # "Is there a free local option that doesn't need AI?"
//
// Free and local: yes, and it is the default when the browser has it.
// Without AI: no, and it is worth saying plainly. Machine translation has
// been neural since roughly 2016; the rule-based systems that preceded it
// (Apertium and friends) exist but produce output no subtitle viewer would
// thank you for outside a handful of closely-related language pairs.
//
// So the axis that matters is the same one as for speech recognition:
// **local versus cloud**. `device` below runs Chrome's built-in translation
// models on your machine -- no key, no cost, nothing uploaded. The cloud
// providers are there because they are better, not because they are
// necessary.

import { applyTranslations, batchSize, translateRequestBody, parseTranslateResponse } from "./engine";
import type { Cue } from "./engine";
import { translateOnBackend, jobKey } from "./account";
import { contextGroups, joinGroup, spread } from "./context";
import { translateChunk } from "./shortfall";

export type ProviderId = "device" | "opensubs" | "claude" | "openai" | "deepl";

export interface Availability {
  ok: boolean;
  reason?: string;
  /** The provider works but must download a model first. */
  needsDownload?: boolean;
}

export interface TranslationProvider {
  id: ProviderId;
  label: string;
  note: string;
  /** Runs on this machine: free, private, no key. */
  local: boolean;
  needsKey: boolean;
  keyPlaceholder?: string;
  /** Lets the user point at any OpenAI-compatible server, including a local one. */
  needsBaseUrl?: boolean;
  defaultBaseUrl?: string;
  defaultModel?: string;
}

export const PROVIDERS: TranslationProvider[] = [
  {
    id: "device",
    label: "On this device",
    note: "Chrome's built-in translation. Free, private, no key — nothing is uploaded.",
    local: true,
    needsKey: false,
  },
  {
    id: "opensubs",
    label: "OpenSubs",
    note: "Translated on our own backend. Paid in credits, priced before you run it \u2014 no key and no account with anyone else.",
    local: false,
    needsKey: false,
  },
  {
    id: "claude",
    label: "Claude",
    note: "Best quality on long, context-dependent dialogue. Your own key, your own cost.",
    local: false,
    needsKey: true,
    keyPlaceholder: "sk-ant-...",
  },
  {
    id: "openai",
    label: "OpenAI-compatible",
    note:
      "Any server speaking the OpenAI chat API — OpenAI, Groq, OpenRouter, DeepSeek, or Ollama and LM Studio running on this machine.",
    local: false,
    needsKey: true,
    keyPlaceholder: "sk-... (any value for a local server)",
    needsBaseUrl: true,
    defaultBaseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
  },
  {
    id: "deepl",
    label: "DeepL",
    note: "A dedicated translator rather than a general model. Has a free tier.",
    local: false,
    needsKey: true,
    keyPlaceholder: "...:fx for a free key",
  },
];

export function provider(id: ProviderId): TranslationProvider {
  const found = PROVIDERS.find((p) => p.id === id);
  if (!found) throw new Error(`unknown translation provider '${id}'`);
  return found;
}

/**
 * Where a hosted OpenSubs translation endpoint lives, if one is configured
 * at build time.
 *
 * Deliberately unset by default. Shipping a hard-coded URL that 404s would
 * present a working-looking option that fails only after a user has waited
 * for it; with nothing configured, `availability` says so up front.
 */


// --- the browser's own translator --------------------------------------

interface DeviceTranslator {
  translate(text: string): Promise<string>;
  destroy?(): void;
}

interface TranslatorApi {
  availability(options: { sourceLanguage: string; targetLanguage: string }): Promise<string>;
  create(options: {
    sourceLanguage: string;
    targetLanguage: string;
    monitor?: (m: EventTarget) => void;
  }): Promise<DeviceTranslator>;
}

interface DetectorApi {
  availability(): Promise<string>;
  create(): Promise<{ detect(text: string): Promise<{ detectedLanguage: string }[]> }>;
}

function translatorApi(): TranslatorApi | null {
  return (self as unknown as { Translator?: TranslatorApi }).Translator ?? null;
}

function detectorApi(): DetectorApi | null {
  return (self as unknown as { LanguageDetector?: DetectorApi }).LanguageDetector ?? null;
}

/**
 * Chrome's translation models are per language *pair*, so availability
 * depends on both ends. `"downloadable"` means it will work but must fetch
 * a model first, which is worth telling the user before they wait.
 */
export async function deviceAvailability(
  source: string,
  target: string,
): Promise<Availability> {
  const api = translatorApi();
  if (!api) {
    return {
      ok: false,
      reason:
        "This browser has no built-in translator. Chrome 138+ does; " +
        "otherwise pick a provider below.",
    };
  }
  try {
    const state = await api.availability({
      sourceLanguage: source,
      targetLanguage: target,
    });
    if (state === "unavailable") {
      return { ok: false, reason: `Your browser cannot translate ${source} to ${target}.` };
    }
    return { ok: true, needsDownload: state === "downloadable" };
  } catch (e) {
    return { ok: false, reason: String(e instanceof Error ? e.message : e) };
  }
}

/**
 * Whether this browser can detect a language at all.
 *
 * Chrome ships `LanguageDetector` as an interface long before the model is
 * present, so feature-detection alone lies: the object exists, and every
 * call reports "unavailable". The UI asks this so it can offer "detect
 * automatically" only when that is a real option, rather than offering it
 * and failing at translate time.
 */
export async function detectionAvailable(): Promise<boolean> {
  const api = detectorApi();
  if (!api) return false;
  try {
    return (await api.availability()) !== "unavailable";
  } catch {
    return false;
  }
}

/** Detect the spoken language from the cue text, for the device translator. */
export async function detectLanguage(text: string): Promise<string | null> {
  const api = detectorApi();
  if (!api) return null;
  try {
    if ((await api.availability()) === "unavailable") return null;
    const detector = await api.create();
    const results = await detector.detect(text.slice(0, 2000));
    return results[0]?.detectedLanguage ?? null;
  } catch {
    return null;
  }
}

// --- the shared request shape ------------------------------------------

export interface TranslateOptions {
  cues: Cue[];
  target: string;
  /** Source language code, or "auto". */
  source?: string;
  providerId: ProviderId;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  onProgress?: (done: number, total: number, note: string) => void;
  /**
   * Some lines came back untranslated after a retry and a split, and are in
   * their original language (APP-141). Everything else was translated.
   */
  onShortfall?: (missed: number, total: number) => void;
  signal?: AbortSignal;
}

/** One batch of strings in, the same number out, in the same order. */
type Batch = (texts: string[]) => Promise<string[]>;

function assertNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
}

/**
 * Translate every cue, keeping every timing.
 *
 * The count check and the rewrapping are the engine's, so a provider that
 * returns the wrong number of lines is refused here rather than silently
 * desynchronising the clip.
 */
export async function translateCues(options: TranslateOptions): Promise<Cue[]> {
  const { cues, providerId, onProgress, signal } = options;
  if (cues.length === 0) return [];

  const texts = cues.map((c) => c.lines.join(" "));

  // An LLM is handed the whole batch and reads across it, so a sentence
  // broken over three cues is still a sentence to it. The two providers
  // that take a string and return a string cannot do that -- Chrome's
  // built-in translator is called once per string, and DeepL translates
  // each entry of its array independently -- so for those the sentence is
  // put back together first and divided again afterwards.
  const contextFree = providerId === "device" || providerId === "deepl";
  const groups = contextFree
    ? contextGroups(cues, texts)
    : texts.map((_, i) => ({ from: i, to: i + 1 }));
  const units = groups.map((group) => joinGroup(texts.slice(group.from, group.to)));

  const batch = await batcherFor(options, units);
  const size = providerId === "device" ? units.length : batchSize();
  const translated: string[] = [];

  let missed = 0;
  for (let i = 0; i < units.length; i += size) {
    assertNotAborted(signal);
    const chunk = units.slice(i, i + size);
    const back = await translateChunk(batch, chunk, signal);
    missed += back.missed;
    translated.push(...back.lines);
    onProgress?.(Math.min(i + size, units.length), units.length, "Translating");
  }
  if (missed > 0) options.onShortfall?.(missed, units.length);

  // Back to one line per cue, which is what the count check downstream
  // and every timing in the file depend on.
  const out: string[] = [];
  for (const [i, group] of groups.entries()) {
    out.push(...spread(translated[i], texts.slice(group.from, group.to)));
  }

  return JSON.parse(applyTranslations(JSON.stringify(cues), JSON.stringify(out)));
}

async function batcherFor(options: TranslateOptions, allTexts: string[]): Promise<Batch> {
  switch (options.providerId) {
    case "device":
      return deviceBatcher(options, allTexts);
    case "claude":
      return claudeBatcher(options);
    case "openai":
      return openAiBatcher(options);
    case "deepl":
      return deeplBatcher(options);
    case "opensubs":
      return opensubsBatcher(options);
  }
}

// --- device -------------------------------------------------------------

async function deviceBatcher(
  options: TranslateOptions,
  allTexts: string[],
): Promise<Batch> {
  const api = translatorApi();
  if (!api) throw new Error("This browser has no built-in translator.");

  // The device translator needs an explicit source language: unlike an
  // LLM it cannot infer one. Detection is tried first, but it is genuinely
  // optional -- Chrome ships `LanguageDetector` whose model reports
  // "unavailable" on plenty of machines, this one included -- so a failure
  // to detect must fall back to what the user chose rather than refuse to
  // translate.
  let source = options.source && options.source !== "auto" ? options.source : null;
  source ??= await detectLanguage(allTexts.join(" "));
  if (!source) {
    throw new Error(
      "This browser could not detect the spoken language. Choose it explicitly " +
        "under “Spoken language”.",
    );
  }

  // Chrome wants a base language tag for the source ("en", not "en-US").
  const sourceLanguage = source.split("-")[0];

  const translator = await api.create({
    sourceLanguage,
    targetLanguage: options.target,
    monitor: (m) => {
      m.addEventListener("downloadprogress", (event) => {
        const loaded = (event as Event & { loaded?: number }).loaded ?? 0;
        options.onProgress?.(0, 1, `Downloading the language model (${Math.round(loaded * 100)}%)`);
      });
    },
  });

  return async (texts) => {
    const out: string[] = [];
    for (let i = 0; i < texts.length; i += 1) {
      assertNotAborted(options.signal);
      out.push(await translator.translate(texts[i]));
      options.onProgress?.(i + 1, texts.length, "Translating on this device");
    }
    translator.destroy?.();
    return out;
  };
}

// --- Claude -------------------------------------------------------------

const CLAUDE_URL = "https://api.anthropic.com/v1/messages";

function claudeBatcher(options: TranslateOptions): Batch {
  const key = requireKey(options, "Claude");
  return async (texts) => {
    // The prompt, the schema and the response parsing are the engine's, so
    // the browser asks for exactly what the desktop asks for.
    const body = translateRequestBody(
      JSON.stringify(texts),
      options.target,
      options.source ?? "auto",
    );
    const response = await fetch(CLAUDE_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        // Anthropic requires this to acknowledge that a browser-side call
        // exposes the key to anything else on the page. Acceptable for a
        // bring-your-own-key tool; the alternative is a server of ours in
        // the middle of the user's transcript.
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body,
      signal: options.signal,
    });
    const text = await response.text();
    try {
      return JSON.parse(parseTranslateResponse(text, texts.length));
    } catch (e) {
      throw authAwareError(response.status, e, "Claude");
    }
  };
}

// --- OpenAI-compatible --------------------------------------------------

const OPENAI_SYSTEM =
  "You translate video subtitles. You are given the subtitle lines of one clip, in order, " +
  "as a JSON array of strings. Return ONLY a JSON object of the form " +
  '{"translations": [...]} with exactly one translation per input string, in the same ' +
  "order. Never merge, split, reorder, drop or add entries: entry N is displayed at the " +
  "timestamp of entry N, so a count mismatch desynchronises the whole clip. Keep each " +
  "translation roughly as long as the original — a subtitle too long to read in its slot " +
  "is a worse translation than a plainer one that fits. Use natural spoken register, " +
  "preserve proper nouns and numbers, and add no notes or explanations.";

function openAiBatcher(options: TranslateOptions): Batch {
  const key = requireKey(options, "this provider");
  const base = (options.baseUrl || "https://api.openai.com/v1").replace(/\/+$/, "");
  const model = options.model || "gpt-4o-mini";

  return async (texts) => {
    const response = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model,
        // Ask for JSON structurally where the server supports it; servers
        // that do not simply ignore it, and the prompt asks anyway.
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: OPENAI_SYSTEM },
          {
            role: "user",
            content: `Translate these subtitle lines into ${options.target}.\n\n${JSON.stringify({ lines: texts })}`,
          },
        ],
      }),
      signal: options.signal,
    });

    const raw = await response.text();
    if (!response.ok) throw authAwareError(response.status, new Error(raw.slice(0, 200)), "the server");

    let content: string;
    try {
      content = JSON.parse(raw).choices?.[0]?.message?.content ?? "";
    } catch {
      throw new Error("The server did not return a chat completion.");
    }
    return readTranslationsArray(content);
  };
}

/**
 * Pull a `translations` array out of a model's reply.
 *
 * Tolerant on purpose: models that do not support a JSON response format
 * often wrap the object in a ``` fence or a sentence of preamble, and
 * failing the whole export over that would be needlessly brittle.
 */
function readTranslationsArray(content: string): string[] {
  const trimmed = content.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  const candidate = start >= 0 && end > start ? trimmed.slice(start, end + 1) : trimmed;

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error("The model's reply was not valid JSON.");
  }
  const list = (parsed as { translations?: unknown }).translations;
  if (!Array.isArray(list)) throw new Error('The model returned no "translations" array.');
  // The count is the caller's business: a short reply is retried and then
  // split, rather than throwing the batch away (APP-141).
  return list.map((v) => String(v ?? ""));
}

// --- DeepL --------------------------------------------------------------

function deeplBatcher(options: TranslateOptions): Batch {
  const key = requireKey(options, "DeepL");
  // Free keys end in ":fx" and live on a different host.
  const host = key.endsWith(":fx") ? "https://api-free.deepl.com" : "https://api.deepl.com";

  return async (texts) => {
    const response = await fetch(`${host}/v2/translate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `DeepL-Auth-Key ${key}`,
      },
      body: JSON.stringify({
        text: texts,
        target_lang: deeplTarget(options.target),
        ...(options.source && options.source !== "auto"
          ? { source_lang: options.source.split("-")[0].toUpperCase() }
          : {}),
      }),
      signal: options.signal,
    });
    const raw = await response.text();
    if (!response.ok) throw authAwareError(response.status, new Error(raw.slice(0, 200)), "DeepL");
    const list = JSON.parse(raw).translations;
    if (!Array.isArray(list)) throw new Error("DeepL returned no translations.");
    return list.map((t: { text?: string }) => t.text ?? "");
  };
}

/** DeepL uses its own target codes, and is picky about the Chinese ones. */
function deeplTarget(code: string): string {
  const map: Record<string, string> = {
    "zh-Hans": "ZH-HANS",
    "zh-Hant": "ZH-HANT",
    pt: "PT-PT",
    en: "EN-GB",
  };
  return map[code] ?? code.split("-")[0].toUpperCase();
}

// --- OpenSubs-hosted ----------------------------------------------------

function opensubsBatcher(options: TranslateOptions): Batch {
  return async (texts) => {
    // The job key is derived from the text, not from the attempt, so a
    // retry after a dropped response replays the same charge rather than
    // billing twice. See `account.jobKey`.
    const result = await translateOnBackend(
      texts,
      options.target,
      options.source,
      jobKey(texts, options.target),
      options.signal,
    );
    return result.translations;
  };
}

/**
 * Whether the hosted option can be offered at all.
 *
 * Always, now: it goes to our own gateway rather than to a URL a build has
 * to be told about. What it *needs* is a signed-in user, and that is a
 * runtime question the UI answers with a sign-in button rather than by
 * hiding the option.
 */
export function opensubsConfigured(): boolean {
  return true;
}

// --- shared helpers -----------------------------------------------------

function requireKey(options: TranslateOptions, who: string): string {
  const key = options.apiKey?.trim();
  if (!key) throw new Error(`${who} needs an API key.`);
  return key;
}

function authAwareError(status: number, cause: unknown, who: string): Error {
  if (status === 401 || status === 403) return new Error(`${who} rejected that key.`);
  if (status === 429) return new Error(`${who} is rate-limiting; try again shortly.`);
  return cause instanceof Error ? cause : new Error(String(cause));
}
