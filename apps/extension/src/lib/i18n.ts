/**
 * The extension's words, in the browser's own language.
 *
 * The same scheme as the web app's (../../../web/src/lib/i18n): the English
 * text is the key, the catalogues are imported statically, and a gap falls
 * back to the English it was written in -- never to an identifier on a button.
 * The same eight languages, chosen by the same widening match
 * (`resolveLocale`), so zh-HK gets Traditional rather than Simplified.
 *
 * What differs is where the language comes from. By default an extension
 * speaks the language the browser is set to, which is what
 * `i18n.getUILanguage()` reports on Chromium and on Firefox alike, and what
 * the store listing in `_locales/` already follows. `navigator.languages` is
 * the fallback for the one context that has no `i18n` API -- Chromium's
 * offscreen document, where the engine runs -- and there it reports the same
 * UI language. The panel's "Interface language" overrides it (`useLocale`),
 * for someone whose browser is in a language they read less well.
 *
 * Not `_locales/messages.json` and `getMessage()`, although the manifest uses
 * those. Their keys must be identifiers, so English text cannot be the key;
 * their fallback runs zh_HK -> zh -> en, which hands a Hong Kong reader the
 * wrong script or English; and the Firefox build overwrites each locale's
 * messages.json with a shorter store name (scripts/copy-static.mjs), which
 * would take the panel's words with it.
 *
 * Every context translates what it produces: the popup its controls, the
 * background and the page their status lines, the engine its progress. A
 * status note therefore arrives already in the reader's language, wherever it
 * is shown -- the popup, or the note under the line on the video.
 */
import { resolveLocale } from "../../../web/src/lib/i18n/locales.ts";
import de from "./i18n/de.ts";
import es from "./i18n/es.ts";
import ja from "./i18n/ja.ts";
import ko from "./i18n/ko.ts";
import pt from "./i18n/pt.ts";
import zhHans from "./i18n/zh-Hans.ts";
import zhHant from "./i18n/zh-Hant.ts";

import { LOCALES as WEB_LOCALES } from "../../../web/src/lib/i18n/locales.ts";

export type Catalogue = Record<string, string>;

const CATALOGUES: Record<string, Catalogue> = {
  en: {}, // English is the key set; there is nothing to look up.
  de,
  es,
  ja,
  ko,
  pt,
  "zh-Hans": zhHans,
  "zh-Hant": zhHant,
};

/**
 * The web app's languages that this panel has words for. The web app ships
 * Russian; the panel does not yet, so a Russian browser falls to
 * its next language, and the picker does not offer one it cannot show.
 */
export const LOCALES = WEB_LOCALES.filter((l) => l.code in CATALOGUES);
const SHIPPED = LOCALES.map((l) => l.code);

/** The language the browser's interface is in, as the browser says it. */
export function browserLanguages(): string[] {
  const g = globalThis as unknown as {
    browser?: typeof chrome;
    chrome?: typeof chrome;
    navigator?: { language?: string; languages?: readonly string[] };
  };
  const out: string[] = [];
  try {
    const ui = (g.browser ?? g.chrome)?.i18n?.getUILanguage?.();
    if (ui) out.push(ui);
  } catch {
    // An ordinary page (e2e/pipeline.mjs runs the engine in one) has no
    // extension API at all.
  }
  const nav = g.navigator;
  if (nav?.languages?.length) out.push(...nav.languages);
  else if (nav?.language) out.push(nav.language);
  return out;
}

let locale: string | null = null;

/** The active locale, decided once per context. */
export function getLocale(): string {
  locale ??= resolveLocale(browserLanguages(), SHIPPED);
  return locale;
}

/** Exactly this locale. For tests; product code goes through `useLocale`. */
export function setLocale(code: string): void {
  if (code in CATALOGUES) locale = code;
}

/**
 * The person's choice of interface language, or "auto" for the browser's.
 *
 * Each context hears the choice where it already hears the settings -- the
 * popup reads storage, the background stores it, the page and the engine get
 * it with every Start and every change -- so no context needs a storage API
 * of its own (Chromium's offscreen document has none).
 */
export function useLocale(choice: string | undefined): void {
  locale = choice && choice !== "auto" && choice in CATALOGUES ? choice : resolveLocale(browserLanguages(), SHIPPED);
}

/**
 * Which way a locale's text runs. Every shipped locale is left-to-right; the
 * question is asked anyway so a right-to-left one cannot ship without its
 * `dir` being set.
 */
export function direction(code: string = getLocale()): "ltr" | "rtl" {
  return /^(ar|he|fa|ur)(-|$)/.test(code) ? "rtl" : "ltr";
}

/**
 * Translate `text`, falling back to the English it was written in.
 * `vars` fills `{name}` placeholders.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const table = CATALOGUES[getLocale()];
  let out = (table && table[text]) || text;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) out = out.replaceAll(`{${key}}`, String(value));
  }
  return out;
}

/**
 * The English singular or plural, by count, then translated.
 *
 * Two keys rather than a plural engine: every language shipped here either has
 * no grammatical number (Chinese, Japanese, Korean -- both keys carry the same
 * text) or splits at one, as English does.
 */
export function tn(one: string, other: string, n: number): string {
  return t(n === 1 ? one : other, { n });
}

/**
 * Translate a message that may be one of ours, or may be the browser's.
 *
 * An error that reaches the user from a lower layer is either a sentence this
 * extension wrote -- in the catalogue, and so translated -- or something the
 * browser or a library said. The second is never shown alone: it goes after a
 * sentence the reader can act on, as the detail.
 */
export function tError(message: string): string {
  if (Object.values(CATALOGUES).some((c) => message in c)) return t(message);
  return t("Something went wrong, so subtitling stopped. Press Start to try again. ({detail})", {
    detail: message,
  });
}

/** Which keys a locale has no translation for. Used by the unit test. */
export function missing(code: string, keys: readonly string[]): string[] {
  if (code === "en") return [];
  const table = CATALOGUES[code];
  if (!table) return [...keys];
  return keys.filter((k) => !(k in table));
}

/** Every catalogue, for the coverage test. Not for use at a call site. */
export function catalogues(): Record<string, Catalogue> {
  return CATALOGUES;
}
