// Which font libass needs for a given piece of subtitle text.
//
// In a browser, libass has no system fonts: whatever it is handed is all it
// has. JASSUB bundles Liberation Sans, which covers Latin, Greek, Cyrillic
// and Hebrew — so Russian and Ukrainian are fine out of the box, and
// Chinese, Japanese, Korean, Arabic, Hindi and Thai render as rows of tofu
// boxes. Silently: libass logs a fontselect miss, draws the boxes, and
// nothing throws. The `.srt` export looks perfect the whole time, because
// that is plain text and never goes near a font.
//
// So each non-Latin script we offer as a translation target gets a font,
// and it is fetched **only when the text actually needs it**. A user
// subtitling in English never downloads the 1.1 MB of Chinese.

import cjkUrl from "../assets/fonts/opensubs-cjk.woff2?url";
import hangulUrl from "../assets/fonts/opensubs-hangul.woff2?url";
import arabicUrl from "../assets/fonts/opensubs-arabic.woff2?url";
import devanagariUrl from "../assets/fonts/opensubs-devanagari.woff2?url";
import thaiUrl from "../assets/fonts/opensubs-thai.woff2?url";
import { DEFAULT_PACKED, SCRIPT_PACKED } from "./fontcoverage";

export interface ScriptFont {
  /** The family name libass will match, lowercased. Set by scripts/make-fonts.py. */
  family: string;
  url: string;
  /** Key into the generated coverage tables. */
  key: string;
  /** For the UI, when a script has no font. */
  label: string;
}

/**
 * Unpack the generated tables into a flat list of inclusive [start, end]
 * pairs. Each entry is `<gap>.<length>` in hex, relative to the end of the
 * previous run -- the CJK font has about four thousand runs, and plain
 * integers cost every visitor 18 kB gzipped whether or not they ever
 * subtitle in Chinese.
 */
function unpack(packed: string): number[] {
  const out: number[] = [];
  let previousEnd = -1;
  for (const entry of packed.split(",")) {
    const dot = entry.indexOf(".");
    const start = previousEnd + 1 + parseInt(entry.slice(0, dot), 16);
    const end = start + parseInt(entry.slice(dot + 1), 16);
    out.push(start, end);
    previousEnd = end;
  }
  return out;
}

const DEFAULT_RANGES = unpack(DEFAULT_PACKED);
const SCRIPT_RANGES: Record<string, number[]> = Object.fromEntries(
  Object.entries(SCRIPT_PACKED).map(([key, packed]) => [key, unpack(packed)]),
);

/**
 * Whether a codepoint falls inside a flat list of inclusive [start, end]
 * pairs. Binary search, because the CJK table has thousands of runs and
 * this is called once per character of every cue on every keystroke.
 */
function inRanges(ranges: readonly number[], cp: number): boolean {
  let lo = 0;
  let hi = ranges.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid * 2]) hi = mid - 1;
    else if (cp > ranges[mid * 2 + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** Codepoints JASSUB's bundled Liberation Sans can draw. */
function inDefaultFont(cp: number): boolean {
  return inRanges(DEFAULT_RANGES, cp);
}

/** Codepoints this script font can draw that the default one cannot. */
function needsScriptFont(font: ScriptFont, cp: number): boolean {
  const ranges = SCRIPT_RANGES[font.key];
  return ranges !== undefined && inRanges(ranges, cp) && !inDefaultFont(cp);
}

/**
 * Ordered most-likely-first. The families are the ones
 * `scripts/make-fonts.py` writes into each font's name table — they must
 * match exactly, because libass looks fonts up by the family recorded in
 * the file, not by whatever key we register it under.
 */
export const SCRIPT_FONTS: ScriptFont[] = [
  {
    family: "opensubs cjk",
    url: cjkUrl,
    key: "cjk",
    label: "Chinese and Japanese",
  },
  {
    family: "opensubs hangul",
    url: hangulUrl,
    key: "hangul",
    label: "Korean",
  },
  {
    family: "opensubs arabic",
    url: arabicUrl,
    key: "arabic",
    label: "Arabic",
  },
  {
    family: "opensubs devanagari",
    url: devanagariUrl,
    key: "devanagari",
    label: "Devanagari",
  },
  {
    family: "opensubs thai",
    url: thaiUrl,
    key: "thai",
    label: "Thai",
  },
];

/**
 * Characters in `text` that no shipped font can draw.
 *
 * Every range here is read out of the fonts themselves at build time, so
 * this answers "will libass draw a tofu box" rather than "did someone
 * remember to widen a regex". The previous hand-written version claimed it
 * would never produce false alarms for ordinary text and then flagged
 * `。` and `、` -- the full stop and comma of every Chinese subtitle ever
 * written -- because the CJK range started at U+3040.
 */
export function unsupportedCharacters(text: string): string[] {
  const missing = new Set<string>();
  for (const char of text) {
    if (char.trim() === "") continue;
    const cp = char.codePointAt(0)!;
    if (inDefaultFont(cp)) continue;
    if (SCRIPT_FONTS.some((f) => needsScriptFont(f, cp))) continue;
    missing.add(char);
  }
  return [...missing];
}

/** The font this text needs beyond Liberation Sans, if any. */
export function fontFor(text: string): ScriptFont | null {
  for (const char of text) {
    const cp = char.codePointAt(0)!;
    if (inDefaultFont(cp)) continue;
    const font = SCRIPT_FONTS.find((f) => needsScriptFont(f, cp));
    if (font) return font;
  }
  return null;
}

/**
 * A stable key for "which fonts does this text need".
 *
 * The caller uses it to decide whether an existing renderer can simply be
 * handed new subtitles or has to be rebuilt: `fallbackFont` is fixed when
 * a JASSUB instance is constructed, so translating a Latin track into
 * Chinese needs a new renderer, not a new track.
 */
export function fontKey(text: string): string {
  return fontFor(text)?.family ?? "latin";
}

export interface FontSetup {
  /**
   * Values are URLs or raw font bytes. JASSUB's published types say
   * `Record<string, string>`, but its own documentation and worker accept
   * a `Uint8Array` — which is the whole point here, since bytes are
   * available synchronously and a URL is not. Call sites cast.
   */
  availableFonts: Record<string, string | Uint8Array>;
  fallbackFont: string;
}

/** Fetched font bytes, keyed by URL. A font is downloaded once per session. */
const fontBytes = new Map<string, Promise<Uint8Array | null>>();

function loadFont(url: string): Promise<Uint8Array | null> {
  let pending = fontBytes.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => (response.ok ? response.arrayBuffer() : null))
      .then((buffer) => (buffer ? new Uint8Array(buffer) : null))
      .catch(() => null);
    fontBytes.set(url, pending);
  }
  return pending;
}

/**
 * The `availableFonts`/`fallbackFont` pair to construct JASSUB with.
 *
 * The script font is passed as **bytes, not a URL**, and this is why the
 * function is async. Handed a URL, JASSUB fetches it in the background and
 * libass renders whatever frames arrive in the meantime without it — so
 * the first thumbnail came out blank and the opening frames of a burn
 * could miss their font entirely, silently. Resolving the bytes first
 * means the renderer is never constructed without the font it needs.
 *
 * Liberation Sans stays a URL: it is JASSUB's own bundled default and is
 * already resolved by the time anything asks for a glyph it covers.
 */
export async function fontSetupFor(text: string, liberationUrl: string): Promise<FontSetup> {
  // Liberation Sans is resolved to bytes too, not just the script font.
  // It is the fallback for every Latin glyph, and handing it over as a URL
  // leaves the same race: a burn renders frames as fast as it can decode
  // them, and any frame drawn before that fetch lands comes out as tofu --
  // silently, in the exported file, with the preview looking perfect
  // because by then the font had arrived.
  const [latin, script] = await Promise.all([
    loadFont(liberationUrl),
    (async () => {
      const found = fontFor(text);
      return found ? { found, bytes: await loadFont(found.url) } : null;
    })(),
  ]);

  const available: Record<string, string | Uint8Array> = {
    // Falling back to the URL only if the fetch failed outright: a late
    // font still beats no font.
    "liberation sans": latin ?? liberationUrl,
  };

  if (!script?.bytes) {
    return { availableFonts: available, fallbackFont: "liberation sans" };
  }
  available[script.found.family] = script.bytes;
  return { availableFonts: available, fallbackFont: script.found.family };
}
