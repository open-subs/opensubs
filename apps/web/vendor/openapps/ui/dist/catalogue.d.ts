/** `{ "English sentence": "translated sentence" }`. */
export type Catalogue = Record<string, string>;
/** Register (or extend) the catalogue for a locale tag such as `zh-Hans`. */
export declare function addCatalogue(tag: string, entries: Catalogue): void;
/** Switch language. Elements on the page re-render. */
export declare function setLocale(tag: string): void;
/** The active locale tag, for `Intl.DateTimeFormat` and `Intl.NumberFormat`. */
export declare function locale(): string;
/**
 * The tag to hand `Intl`, or `undefined` to let the browser choose.
 *
 * While no host has set a language the elements are English text with the
 * reader's own date and number conventions, as they always were.
 */
export declare function intlLocale(): string | undefined;
/**
 * A number written the way the interface's language writes it: `0.50` in
 * English, `0,50` in Russian and German, grouping as each language groups.
 * Every price, unit price, amount and count the elements show goes through
 * this (or {@link fill}, which uses it), never `toFixed` — that writes an
 * English decimal point whatever the page's language.
 *
 * The locale is {@link intlLocale}, so until a host sets a language the
 * reader's own conventions apply, as they always did.
 */
export declare function formatNumber(value: number, options?: Intl.NumberFormatOptions): string;
/**
 * Translate `key`, filling `{name}` placeholders from `vars`.
 *
 * Falls back to the English key when the active catalogue has no entry, and
 * remembers the gap for {@link missing}.
 */
export declare function t(key: string, vars?: Record<string, string | number>): string;
/** Keys asked for in the active locale that its catalogue lacks. For tests. */
export declare function missing(): string[];
/** Tests only: back to English with no catalogues. */
export declare function resetI18n(): void;
//# sourceMappingURL=catalogue.d.ts.map