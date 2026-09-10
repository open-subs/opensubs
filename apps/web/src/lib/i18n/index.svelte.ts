/**
 * Translation, with no runtime dependency.
 *
 * ## Why the English text is the key
 *
 * `t("Generate from the audio")` rather than `t("asr.generate")`. That is
 * gettext's convention and Apple's, and it earns its place three times:
 *
 * - **A missing translation degrades to English**, not to `asr.generate`
 *   on a button. Across eight catalogues there will always be a gap
 *   somewhere, and the failure has to be survivable.
 * - **The replacement is mechanical.** Wrapping a literal cannot change
 *   what the interface says, so it can be applied across a large
 *   component without re-reading each site for intent.
 * - **The catalogue reads as prose**, so whoever revises a translation
 *   sees the sentence rather than an identifier to go and look up.
 *
 * The cost is that editing English copy orphans its translations. That is
 * the right trade while English is the source: a changed sentence
 * *should* be re-translated, and `missing()` makes the gap loud instead
 * of silent.
 *
 * ## Why no library
 *
 * svelte-i18n and i18next each bring a store layer, an ICU parser and
 * async loading. This app is local-first — the point of it is that it
 * works with nothing but the page — so the catalogues are imported
 * statically: no async, no loading state, and no flash of untranslated
 * text on a cold start.
 *
 * ## Why this file ends in .svelte.ts
 *
 * Svelte 5 runes only work in that extension. `$state` in a plain `.ts`
 * fails at build with an error that does not mention the filename.
 */
import { DEFAULT_LOCALE, resolveLocale } from "./locales";
import de from "./de";
import es from "./es";
import ja from "./ja";
import ko from "./ko";
import pt from "./pt";
import zhHans from "./zh-Hans";
import zhHant from "./zh-Hant";

export { LOCALES, DEFAULT_LOCALE } from "./locales";
export type { LocaleDef } from "./locales";

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

const STORAGE_KEY = "opensubs.locale";

/**
 * The active locale. `$state` so every `t()` call site re-renders when it
 * changes — a language picker that needs a reload is not a language
 * picker.
 */
let locale = $state(DEFAULT_LOCALE);

/**
 * The stored choice, else what the browser asks for.
 *
 * Called once from the app's own startup rather than at module scope: the
 * catalogues are also imported by the extension's engine host, which has
 * no `window`.
 */
export function initLocale(): void {
  if (typeof window === "undefined") return;
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(STORAGE_KEY);
  } catch {
    // Private browsing, or storage disabled. The browser's own
    // preference is a good enough answer.
  }
  const preferred = stored ? [stored] : [...(navigator.languages ?? [navigator.language])];
  setLocale(resolveLocale(preferred), { persist: false });
}

export function getLocale(): string {
  return locale;
}

export function setLocale(next: string, options: { persist?: boolean } = {}): void {
  if (!(next in CATALOGUES)) return;
  locale = next;
  if (typeof document !== "undefined") {
    // Not cosmetic. `lang` is what picks the right glyphs for Han
    // characters — the same codepoint is drawn differently in Chinese and
    // Japanese — and what a screen reader switches voice on. This app
    // puts Chinese and Japanese subtitles on screen, so getting it wrong
    // is visible in the product itself, not only in the chrome.
    document.documentElement.lang = next;
  }
  if (options.persist !== false) {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // The choice still applies for this session.
    }
  }
}

/**
 * Translate `text`, falling back to the English it was written in.
 *
 * `vars` interpolates `{name}` placeholders. Deliberately small — no
 * plural rules, no date formats — because nothing in this interface needs
 * them yet, and `Intl.PluralRules` is there for the day it does.
 */
export function t(text: string, vars?: Record<string, string | number>): string {
  const table = CATALOGUES[locale];
  let out = (table && table[text]) || text;
  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      out = out.replaceAll(`{${key}}`, String(value));
    }
  }
  return out;
}

/**
 * Which keys a locale has no translation for.
 *
 * Used by the i18n test, so a new English string cannot quietly ship
 * untranslated in seven languages.
 */
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
