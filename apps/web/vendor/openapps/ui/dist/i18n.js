/**
 * The sign-in box's words, in the suite's languages: the eight, and Russian.
 *
 * The English text is the key (gettext's convention): a missing entry falls
 * back to English rather than to an identifier on a button. The language
 * comes from the page — the nearest `lang` attribute, then `<html lang>`,
 * then the browser — because every product already sets `<html lang>` for
 * its own interface, and a sign-in box in a different language from the
 * page around it reads as someone else's form.
 */
export const LOCALES = ["en", "zh-Hans", "zh-Hant", "ja", "ko", "de", "es", "pt", "ru"];
/** exact tag → Chinese script → base language → English. */
export function pickLocale(tag) {
    if (!tag)
        return null;
    const lower = tag.trim().toLowerCase().replace(/_/g, "-");
    if (!lower)
        return null;
    const exact = LOCALES.find((l) => l.toLowerCase() === lower);
    if (exact)
        return exact;
    const parts = lower.split("-");
    if (parts[0] === "zh") {
        return parts.slice(1).some((p) => ["hant", "tw", "hk", "mo"].includes(p)) ? "zh-Hant" : "zh-Hans";
    }
    return LOCALES.find((l) => l === parts[0]) ?? null;
}
/** The language a sign-in box inside `host` should speak. */
export function localeFor(host) {
    const fromPage = pickLocale(host.closest("[lang]")?.getAttribute("lang")) ??
        pickLocale(document.documentElement.getAttribute("lang"));
    if (fromPage)
        return fromPage;
    for (const tag of navigator.languages ?? [navigator.language]) {
        const picked = pickLocale(tag);
        if (picked)
            return picked;
    }
    return "en";
}
/**
 * Each language is its own chunk, fetched only by a page in that language:
 * every catalogue inline would cost every English page ~8 KB gzipped for
 * strings it never shows. Until a catalogue arrives the box reads in
 * English, which is the same fallback a missing entry gets.
 */
const LOADERS = {
    "zh-Hans": () => import("./locales/zh-Hans.js"),
    "zh-Hant": () => import("./locales/zh-Hant.js"),
    ja: () => import("./locales/ja.js"),
    ko: () => import("./locales/ko.js"),
    de: () => import("./locales/de.js"),
    es: () => import("./locales/es.js"),
    pt: () => import("./locales/pt.js"),
    ru: () => import("./locales/ru.js"),
};
const loaded = new Map();
const loading = new Map();
/** Fetch a language's strings. Resolves at once for English or a cached one. */
export function loadLocale(locale) {
    if (locale === "en" || loaded.has(locale))
        return Promise.resolve();
    let pending = loading.get(locale);
    if (!pending) {
        pending = LOADERS[locale]()
            .then((module) => {
            loaded.set(locale, module.default);
        })
            // Offline or blocked: stay in English rather than throw into a render.
            .catch(() => undefined)
            .finally(() => loading.delete(locale));
        loading.set(locale, pending);
    }
    return pending;
}
/** Translate `key` (English) into `locale`, filling `{name}` placeholders. */
export function t(locale, key, vars = {}) {
    const template = locale === "en" ? key : (loaded.get(locale)?.[key] ?? key);
    return template.replace(/\{(\w+)\}/g, (whole, name) => name in vars ? String(vars[name]) : whole);
}
//# sourceMappingURL=i18n.js.map