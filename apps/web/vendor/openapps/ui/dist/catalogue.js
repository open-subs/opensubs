/**
 * Translation seam for the elements.
 *
 * **The English text is the key** — `t("Disconnect")`, never
 * `t("account.disconnect")` — so a string with no translation renders as
 * English rather than as an identifier, and a catalogue reads as prose.
 *
 * The elements that use this seam (the account panel and its parts) ship
 * **no catalogues**: they have been English-only since they were written,
 * and that set stays complete. The sign-in box is different: it carries its
 * own eight languages and follows the page's `lang` (`i18n.ts`). What is
 * here is the seam, so that a host which translates its own interface can
 * hand the account panel the same sentences in its language:
 *
 * ```ts
 * import { addCatalogue, setLocale } from "@openapps/ui";
 * addCatalogue("ja", { "Disconnect": "接続を解除" });
 * setLocale("ja");
 * ```
 *
 * No library, no loading state, no async: a catalogue is a plain object the
 * host imports statically. `{name}` placeholders are filled from `vars`.
 * Numbers and dates are not formatted here — use `Intl` with {@link locale}.
 */
import { notify } from "./context.js";
const catalogues = new Map();
let active = "en";
const unseen = new Set();
/** Register (or extend) the catalogue for a locale tag such as `zh-Hans`. */
export function addCatalogue(tag, entries) {
    catalogues.set(tag, { ...(catalogues.get(tag) ?? {}), ...entries });
    if (tag === active)
        notify();
}
/** Switch language. Elements on the page re-render. */
export function setLocale(tag) {
    if (tag === active)
        return;
    active = tag;
    unseen.clear();
    notify();
}
/** The active locale tag, for `Intl.DateTimeFormat` and `Intl.NumberFormat`. */
export function locale() {
    return active;
}
/**
 * The tag to hand `Intl`, or `undefined` to let the browser choose.
 *
 * While no host has set a language the elements are English text with the
 * reader's own date and number conventions, as they always were.
 */
export function intlLocale() {
    return active === "en" && !catalogues.has("en") ? undefined : active;
}
const numberFormats = new Map();
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
export function formatNumber(value, options) {
    const tag = intlLocale();
    const key = `${tag ?? ""}|${JSON.stringify(options ?? {})}`;
    let format = numberFormats.get(key);
    if (!format) {
        try {
            format = new Intl.NumberFormat(tag, options);
        }
        catch {
            // A tag Intl does not know: the reader's own conventions instead.
            format = new Intl.NumberFormat(undefined, options);
        }
        numberFormats.set(key, format);
    }
    return format.format(value);
}
/**
 * Translate `key`, filling `{name}` placeholders from `vars`.
 *
 * Falls back to the English key when the active catalogue has no entry, and
 * remembers the gap for {@link missing}.
 */
export function t(key, vars) {
    let text = key;
    let plural = false;
    if (active !== "en" || catalogues.has("en")) {
        const hit = catalogues.get(active)?.[key];
        if (hit !== undefined) {
            text = hit;
            plural = hit.includes("|");
        }
        else if (active !== "en")
            unseen.add(key);
    }
    if (plural)
        text = pluralForm(text, vars);
    if (!vars)
        return text;
    return text.replace(/\{(\w+)\}/g, (whole, name) => name in vars ? fill(vars[name]) : whole);
}
/** A number is written the reader's way; a string is used as it comes. */
function fill(value) {
    return typeof value === "number" ? formatNumber(value) : String(value);
}
/**
 * A translation may carry its plural forms as `one|few|many|other` (as many
 * as the language has, in that order), chosen by `vars.n` or else the first
 * number among `vars`. English keys stay one sentence; only a catalogue
 * whose language needs more forms writes them.
 */
const PLURAL_ORDER = ["one", "two", "few", "many", "other"];
/**
 * The first number among `vars` — a number, or a whole number already
 * written out with group separators ("1 250", "1,250"), which is how the
 * account panel hands its balances over.
 */
function firstCount(vars) {
    for (const value of Object.values(vars ?? {})) {
        if (typeof value === "number")
            return value;
        if (typeof value === "string" && /^\d[\d\s\u00a0\u202f.,']*$/.test(value))
            return Number(value.replace(/\D/g, ""));
    }
    return undefined;
}
function pluralForm(text, vars) {
    const forms = text.split("|");
    const count = typeof vars?.n === "number" ? vars.n : firstCount(vars);
    if (typeof count !== "number")
        return forms[forms.length - 1];
    let category = "other";
    let order = ["other"];
    try {
        const rules = new Intl.PluralRules(active);
        category = rules.select(count);
        const have = rules.resolvedOptions().pluralCategories;
        order = PLURAL_ORDER.filter((c) => have.includes(c));
    }
    catch {
        // An unknown tag: the last form is the general one.
    }
    const index = order.indexOf(category);
    return forms[Math.min(index < 0 ? forms.length - 1 : index, forms.length - 1)];
}
/** Keys asked for in the active locale that its catalogue lacks. For tests. */
export function missing() {
    return [...unseen].sort();
}
/** Tests only: back to English with no catalogues. */
export function resetI18n() {
    catalogues.clear();
    unseen.clear();
    active = "en";
}
//# sourceMappingURL=catalogue.js.map