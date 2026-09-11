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
];

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

  if (status === 401 || status === 403) {
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
