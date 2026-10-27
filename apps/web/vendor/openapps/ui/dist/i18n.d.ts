/**
 * The sign-in box's words, in the suite's eight languages.
 *
 * The English text is the key (gettext's convention): a missing entry falls
 * back to English rather than to an identifier on a button. The language
 * comes from the page — the nearest `lang` attribute, then `<html lang>`,
 * then the browser — because every product already sets `<html lang>` for
 * its own interface, and a sign-in box in a different language from the
 * page around it reads as someone else's form.
 */
export declare const LOCALES: readonly ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "es", "pt"];
export type Locale = (typeof LOCALES)[number];
/** exact tag → Chinese script → base language → English. */
export declare function pickLocale(tag: string | null | undefined): Locale | null;
/** The language a sign-in box inside `host` should speak. */
export declare function localeFor(host: Element): Locale;
/** Fetch a language's strings. Resolves at once for English or a cached one. */
export declare function loadLocale(locale: Locale): Promise<void>;
/** Translate `key` (English) into `locale`, filling `{name}` placeholders. */
export declare function t(locale: Locale, key: string, vars?: Record<string, string | number>): string;
//# sourceMappingURL=i18n.d.ts.map