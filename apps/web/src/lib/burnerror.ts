// What a failed burn is counted and reported as: the stage it reached, a
// category, and the error's type name. Never the message, which can carry a
// file name. Kept apart from funnel.ts so it runs, and is tested, in Node.

// First match wins, so the specific comes before the general: a file that
// can no longer be read used to surface as a bad format or a TypeError and
// was counted as "other".
const ERRORS: [string, RegExp][] = [
  ["cancelled", /AbortError|cancelled/i],
  // The picked file has gone: moved, changed, deleted, or a cloud
  // placeholder. Chromium's broken read stream is a TypeError "network error".
  ["file-read", /NotReadableError|NotFoundError|could not be read|^TypeError network error$/i],
  ["unsupported-format", /UnsupportedInputFormatError|unrecognizable format/i],
  ["no-video-track", /no video track/i],
  ["empty-clip", /has no length/i],
  ["quota", /QuotaExceeded/i],
  ["memory", /out of memory|allocation|RangeError|array buffer/i],
  // A part of the page that loads on demand (the subtitle renderer's
  // worker, its wasm, a font) could not be fetched.
  ["network", /Failed to fetch|NetworkError|Load failed|net::|importScripts|failed to load/i],
  ["codec-unsupported", /cannot be decoded|not decodable|decoder.*not supported|codec.*not supported/i],
  ["unsupported", /not supported|NotSupportedError|no 2D canvas|cannot encode video at/i],
  ["renderer", /OffscreenCanvas|jassub|libass/i],
  ["decode", /decod/i],
  ["encode", /encod|muxer/i],
];

/** A category for a failed burn. Reads the error's name and message; sends neither. */
export function errorType(error: unknown): string {
  const e = error as { name?: string; message?: string; category?: unknown } | null;
  // Failures the burn already understood carry their own category.
  if (typeof e?.category === "string" && /^[a-z-]{1,24}$/.test(e.category)) return e.category;
  const text = `${e?.name ?? ""} ${e?.message ?? String(error ?? "")}`.trim();
  return (ERRORS.find(([, re]) => re.test(text)) ?? ["other"])[0];
}

/**
 * The error's type name, letters only: NotReadableError, TypeError,
 * UnsupportedInputFormatError. Never the message.
 */
export function errorName(error: unknown): string {
  const e = error as { name?: unknown; ename?: unknown } | null;
  const name = typeof e?.ename === "string" ? e.ename : typeof e?.name === "string" ? e.name : "";
  return name.replace(/[^A-Za-z]/g, "").slice(0, 32) || "Error";
}

/** The code the support box carries: burn:<stage>:<category>:<name>. */
export function failureCode(note: string | null | undefined, error: unknown): string {
  return `burn:${burnStage(note)}:${errorType(error)}:${errorName(error)}`.replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 80);
}

/** Where a burn had got to, from the progress note `burnInBrowser` reports. */
export function burnStage(note: string | null | undefined): string {
  if (!note) return "prepare";
  if (/^Reading/.test(note)) return "read";
  if (/^Copying audio/.test(note)) return "audio";
  if (/^Burning/.test(note)) return "render";
  if (/^Finishing/.test(note)) return "finish";
  return "prepare";
}
