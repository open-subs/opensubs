// Reading a subtitle file that is not UTF-8.
//
// `File.text()` always decodes as UTF-8. That is right for most of the
// world and wrong for exactly the files this product is most likely to be
// handed: Chinese `.srt` files are routinely GB18030 (or its subset GBK)
// and older Traditional ones are Big5, because that is what the tools that
// made them wrote. Decoded as UTF-8 they arrive as `這就是` -> `�o�N�O`,
// and the app cheerfully shows the mojibake as subtitles.
//
// # Why guessing is kept deliberately small
//
// Encoding detection is a guessing game, and a confident wrong guess is
// worse than an honest one: GB18030 will decode almost any byte sequence
// into *something*, so "it decoded without error" proves nothing about
// whether the characters are the ones the author typed. Big5 text read as
// GB18030 produces valid, plausible-looking, entirely wrong Chinese.
//
// So this only claims what it can actually prove:
//
//   - A BOM is a fact. UTF-8, UTF-16LE and UTF-16BE BOMs are read directly.
//   - Valid UTF-8 is very nearly a fact. Long multi-byte sequences do not
//     occur by accident in legacy encodings, so a strict decode that
//     succeeds is trusted.
//   - Everything else is a *guess*, and it guesses GB18030 because that is
//     the overwhelmingly common case for the files that get here.
//
// The guess is then shown to the user with a control to change it, which
// is the part that matters. Auto-detection that cannot be corrected turns
// a five-second fix into an unexplainable bug.

/** Encodings offered when the guess is wrong. All are in the WHATWG set. */
export const SUBTITLE_ENCODINGS = [
  { id: "utf-8", label: "Unicode (UTF-8)" },
  { id: "gb18030", label: "Chinese Simplified (GB18030 / GBK)" },
  { id: "big5", label: "Chinese Traditional (Big5)" },
  { id: "shift_jis", label: "Japanese (Shift_JIS)" },
  { id: "euc-kr", label: "Korean (EUC-KR)" },
  { id: "windows-1251", label: "Cyrillic (Windows-1251)" },
  { id: "windows-1252", label: "Western European (Windows-1252)" },
] as const;

export type SubtitleEncoding = (typeof SUBTITLE_ENCODINGS)[number]["id"];

function hasBom(bytes: Uint8Array, ...prefix: number[]): boolean {
  return prefix.every((b, i) => bytes[i] === b);
}

export interface Decoded {
  text: string;
  encoding: SubtitleEncoding | "utf-16le" | "utf-16be";
  /** True when the encoding was proved (a BOM, or valid UTF-8), not guessed. */
  certain: boolean;
}

/**
 * Decode subtitle bytes, saying how sure it is.
 *
 * `certain` is what the interface keys off: a proved encoding needs no
 * comment, a guess needs to be visible and changeable.
 */
export function decodeSubtitles(buffer: ArrayBuffer): Decoded {
  const bytes = new Uint8Array(buffer);

  // A BOM settles it.
  if (hasBom(bytes, 0xef, 0xbb, 0xbf)) {
    return { text: strip(decode(bytes, "utf-8")), encoding: "utf-8", certain: true };
  }
  if (hasBom(bytes, 0xff, 0xfe)) {
    return { text: strip(decode(bytes, "utf-16le")), encoding: "utf-16le", certain: true };
  }
  if (hasBom(bytes, 0xfe, 0xff)) {
    return { text: strip(decode(bytes, "utf-16be")), encoding: "utf-16be", certain: true };
  }

  // Valid UTF-8 is not something legacy Chinese text turns into by
  // accident -- the multi-byte sequences are too structured -- so a strict
  // decode that survives is taken as proof rather than preference.
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { text: strip(text), encoding: "utf-8", certain: true };
  } catch {
    // Not UTF-8. Fall through to the guess.
  }

  return { text: strip(decode(bytes, "gb18030")), encoding: "gb18030", certain: false };
}

/** Re-read the same bytes as the user says they should be read. */
export function decodeAs(buffer: ArrayBuffer, encoding: string): string {
  return strip(decode(new Uint8Array(buffer), encoding));
}

function decode(bytes: Uint8Array, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    // An encoding this browser will not build a decoder for. Better to
    // show mojibake the user can fix than to throw away their file.
    return new TextDecoder("utf-8").decode(bytes);
  }
}

/**
 * Drop a leading U+FEFF.
 *
 * A UTF-8 BOM decodes to a zero-width no-break space rather than
 * disappearing, and it lands at the very front of the file -- where the
 * SRT parser is looking for a cue number. One invisible character makes
 * the first cue vanish.
 */
function strip(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
