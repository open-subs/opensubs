/**
 * What the bring-your-own-key transcription route knows about the
 * services on the other end.
 *
 * Separate from asr.ts so it can be imported on its own: asr.ts pulls in
 * the Rust engine and the demuxer, and none of the rules below need
 * either. That is what lets e2e/remote.mjs check them against the exact
 * error bodies the reports quoted (APP-70, APP-71).
 */

/**
 * The sample rate every upload is resampled to.
 *
 * Here rather than in asr.ts because UPLOAD_BYTES_PER_SECOND is derived
 * from it, and a rate that drifted from the figure used to predict an
 * upload's size would silently move the length limit below.
 */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Models the bring-your-own-key route is known to work with.
 *
 * Offered as suggestions, never as a closed list: the route's own copy
 * promises "OpenAI, Groq, or any server of your own", so the field stays
 * free text and this only fills the dropdown beside it.
 *
 * Membership is not about quality. Subtitles need per-segment timings, so
 * the only models usable here at all are the ones that answer
 * `verbose_json`. See NO_TIMESTAMP_MODELS.
 */
export const REMOTE_MODELS: { id: string; note: string }[] = [
  { id: "whisper-1", note: "OpenAI. The default, and its only model with timings." },
  { id: "whisper-large-v3", note: "Groq. Large model, timings, very fast." },
  { id: "whisper-large-v3-turbo", note: "Groq. Faster still, slightly less accurate." },
  { id: "distil-whisper-large-v3-en", note: "Groq. English only, fastest." },
  { id: "gemini-2.5-flash", note: "Google. Best on Japanese in our tests; sent in 30 s pieces." },
];

/**
 * Gemini (APP-74).
 *
 * Google's OpenAI-compatible layer has no `/audio/transcriptions` -- it
 * answers 404 -- so a Gemini key typed into this route only ever failed.
 * Gemini transcribes through its own `generateContent`, which takes the
 * audio inline and returns whatever the prompt asks for; asked for JSON
 * segments with times, it produces the same shape Whisper's
 * `verbose_json` does. Worth having: on the same three clips it scored
 * 3.2% / 9.6% / 31.9% (en WER / ja CER / zh CER) against whisper-1's
 * 2.3% / 15.5% / 24.6% -- the best Japanese of any route.
 *
 * Audio goes up in pieces of `GEMINI_CHUNK_SECONDS`, each cut at the
 * quietest moment near the boundary so a word is not split, and each
 * piece's times are offset back into the clip. Inline audio is capped at
 * 20 MB per request; thirty seconds of 16 kHz PCM is under a megabyte.
 */
export const GEMINI_DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
export const GEMINI_CHUNK_SECONDS = 30;

/** Whether `model` is a Gemini model, which needs the native route. */
export function isGemini(model: string): boolean {
  return /^gemini[-\d]/i.test(model.trim());
}

/**
 * The native API base for a Gemini call. Accepts the OpenAI-compatible
 * URL people copy from Google's docs (`.../v1beta/openai`) and strips the
 * suffix that has no transcription endpoint behind it; anything not on
 * Google's host is ignored in favour of the default, because the model
 * name is what chose this route.
 */
export function geminiBase(baseUrl: string | undefined): string {
  const trimmed = (baseUrl ?? "").trim().replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (!u.hostname.endsWith("googleapis.com")) return GEMINI_DEFAULT_BASE;
  } catch {
    return GEMINI_DEFAULT_BASE;
  }
  return trimmed.replace(/\/openai$/, "") || GEMINI_DEFAULT_BASE;
}

/**
 * Where to cut `totalSeconds` of audio into pieces of at most
 * `chunk` seconds. `quietest` names the quietest instant within
 * `slack` of a nominal boundary, so speech is cut in a breath rather than
 * mid-word; a caller with no energy information passes `undefined` and
 * gets exact boundaries.
 */
export function geminiChunkPlan(
  totalSeconds: number,
  chunk = GEMINI_CHUNK_SECONDS,
  quietest?: (around: number, slack: number) => number,
): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = [];
  let start = 0;
  while (totalSeconds - start > chunk + 1e-6) {
    const nominal = start + chunk;
    const cut = quietest ? quietest(nominal, 2) : nominal;
    const end = Math.min(totalSeconds, Math.max(start + chunk / 2, Math.min(cut, nominal)));
    out.push({ start, end });
    start = end;
  }
  out.push({ start, end: totalSeconds });
  return out;
}

/** The request body for one piece of audio. */
export function geminiRequest(
  base: string,
  model: string,
  apiKey: string,
  wavBase64: string,
  language: string | undefined,
): { url: string; init: RequestInit } {
  const lang = language && language !== "auto" ? ` The speech is in ${language}.` : "";
  const prompt =
    "Transcribe this audio verbatim, in the language spoken, with normal punctuation." +
    lang +
    " Return only JSON of the form {\"segments\":[{\"start\":0.0,\"end\":2.4,\"text\":\"...\"}]}," +
    " one segment per sentence or natural phrase, each at most about eight seconds," +
    " with start and end in seconds from the beginning of this audio." +
    " If there is no speech, return {\"segments\":[]}.";
  const body = {
    contents: [
      {
        parts: [
          { inline_data: { mime_type: "audio/wav", data: wavBase64 } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: {
      temperature: 0,
      responseMimeType: "application/json",
      responseSchema: {
        type: "OBJECT",
        properties: {
          segments: {
            type: "ARRAY",
            items: {
              type: "OBJECT",
              properties: {
                start: { type: "NUMBER" },
                end: { type: "NUMBER" },
                text: { type: "STRING" },
              },
              required: ["start", "end", "text"],
            },
          },
        },
        required: ["segments"],
      },
    },
  };
  return {
    url: `${base}/models/${encodeURIComponent(model)}:generateContent`,
    init: {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify(body),
    },
  };
}

/**
 * The segments in one Gemini response, shifted by `offset` seconds.
 *
 * Tolerant on purpose: the schema asks for numbers, but a model that
 * writes "00:12.5" or fences the JSON in backticks has still done the
 * job, and a piece that fails to parse costs the user thirty seconds of
 * subtitles. Times are clamped to the piece and ordered.
 */
export function parseGeminiSegments(
  raw: string,
  offset: number,
  pieceSeconds: number,
): { start: number; end: number; text: string }[] {
  let text = "";
  try {
    const body = JSON.parse(raw) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    text = (body.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  } catch {
    text = raw;
  }
  text = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const list = Array.isArray(parsed)
    ? parsed
    : ((parsed as { segments?: unknown }).segments ?? []);
  if (!Array.isArray(list)) return [];
  const seconds = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string") {
      const m = v.trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
      if (m) return (m[1] ? Number(m[1]) * 60 : 0) + Number(m[2]);
    }
    return null;
  };
  const out: { start: number; end: number; text: string }[] = [];
  for (const item of list) {
    if (!item || typeof item !== "object") continue;
    const seg = item as { start?: unknown; end?: unknown; text?: unknown };
    const s = seconds(seg.start);
    const e = seconds(seg.end);
    const t = typeof seg.text === "string" ? seg.text.trim() : "";
    if (s == null || e == null || !t) continue;
    const start = Math.min(Math.max(0, s), pieceSeconds);
    const end = Math.min(Math.max(start, e), pieceSeconds);
    out.push({ start: offset + start, end: offset + end, text: t });
  }
  out.sort((a, b) => a.start - b.start);
  return out;
}

/**
 * Models that transcribe but cannot time what they transcribe (APP-71).
 *
 * OpenAI's newer recognisers -- gpt-4o-transcribe and its relatives --
 * return `json` or `text` and nothing else. Subtitles are timings as much
 * as words, so `verbose_json` is not a parameter that could be relaxed:
 * without it there is nowhere for a cue to start or end. Asking for it
 * gets a 400 whose body says "Use 'json' or 'text' instead", which reads
 * like a setting somebody forgot rather than a model that cannot do the
 * job at all.
 *
 * Matched loosely because the service appends its own suffixes: the
 * reported 400 names `gpt-4o-transcribe-api-ev3` for a field that was
 * typed as `gpt-4o-transcribe`.
 */
const NO_TIMESTAMP_MODELS = /^gpt-(4o-(mini-)?)?transcribe/i;

/** Whether `model` is known to return text with no timings. */
export function lacksTimestamps(model: string): boolean {
  return NO_TIMESTAMP_MODELS.test(model.trim());
}

/**
 * What one second of the uploaded clip costs, in bytes.
 *
 * The upload is the WAV this module builds: mono, 16 kHz, 16-bit. So the
 * length a service will accept follows directly from its size cap, and
 * can be worked out before anything has been decoded.
 */
const UPLOAD_BYTES_PER_SECOND = TARGET_SAMPLE_RATE * 2;

/**
 * The upload cap on api.openai.com, and the only one we can know.
 *
 * 25 MiB, which at the rate above is a little under fourteen minutes.
 * Applied only to hosts known to enforce it: this route also points at
 * Groq and at servers people run themselves, and refusing to send a
 * twenty-minute clip to a server with no limit would be a fault of ours
 * rather than a protection.
 */
export const REMOTE_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;

/** The longest clip a capped service will take, in seconds. */
export function remoteUploadSeconds(): number {
  return Math.floor((REMOTE_UPLOAD_LIMIT_BYTES - 44) / UPLOAD_BYTES_PER_SECOND);
}

/** Whether `baseUrl` is a service whose upload cap we actually know. */
export function hasKnownUploadLimit(baseUrl: string): boolean {
  try {
    return new URL(baseUrl).hostname.endsWith("api.openai.com");
  } catch {
    return false;
  }
}

/**
 * Turn a failed transcription response into something a person can act on.
 *
 * What this replaces was the status code and the first 200 characters of
 * the body, which on a real failure is a truncated JSON object ending
 * mid-key (APP-70). It is accurate and unreadable, and worse than
 * unreadable when the answer is simple: the two failures people actually
 * hit are a model that cannot produce timings and a clip over the size
 * cap, and both have a plain sentence attached.
 *
 * The service's own sentence is the fallback rather than the whole body.
 * When a service says something we have no mapping for it is usually
 * worth reading -- it is the braces and quoting around it that are not.
 */
export function remoteError(status: number, raw: string, model: string): Error {
  let detail = "";
  try {
    const body = JSON.parse(raw) as { error?: { message?: string } };
    detail = body.error?.message ?? "";
  } catch {
    // Not JSON. An HTML error page from a proxy, most likely, and none of
    // it is worth showing.
  }

  if (status === 401 || status === 403 || /api key not valid|API_KEY_INVALID/i.test(detail)) {
    return new Error("That transcription service rejected the key.");
  }
  if (status === 413 || /maximum content size|too large|file is too big/i.test(detail)) {
    return new Error(
      `That clip is too long for this service, which accepts about ` +
        `${Math.floor(remoteUploadSeconds() / 60)} minutes at a time. Trim it under ` +
        "Clip & size, or use \u201cOn this device\u201d, which has no limit.",
    );
  }
  if (status === 400 && /verbose_json|response_format|timestamp/i.test(detail)) {
    return new Error(
      `\u201c${model}\u201d transcribes speech but does not time it, so it cannot ` +
        "produce subtitles. Use whisper-1, or one of the Whisper models on Groq.",
    );
  }
  if (status === 404 || /model.*(not found|does not exist)/i.test(detail)) {
    return new Error(
      `That service has no model called \u201c${model}\u201d. Check the name, or ` +
        "leave the field empty to use whisper-1.",
    );
  }
  if (status === 429) {
    return new Error("That transcription service is rate-limiting the key. Try again shortly.");
  }
  if (status >= 500) {
    return new Error(`That transcription service failed (${status}). Try again shortly.`);
  }
  return new Error(
    detail
      ? `That transcription service refused the clip: ${detail}`
      : `That transcription service returned ${status}.`,
  );
}
