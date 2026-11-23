/**
 * How `<openapps-account>` writes numbers, dates and identifiers. Shared by
 * the element and by the part of it that is loaded on demand.
 */
import { formatNumber, intlLocale, t } from "./catalogue.js";
/** Proper nouns: the same in every language. */
export const LABELS = {
    apple: "Apple",
    google: "Google",
    github: "GitHub",
    openwallet: "OnWallet",
    nostr: "Nostr",
};
/** What a kind of sign-in is called. */
export function label(namespace) {
    return namespace === "eip155" ? t("Wallet") : (LABELS[namespace] ?? namespace);
}
export function num(value) {
    return formatNumber(value);
}
/** Parts per million as a percentage: 750000 → "75%". */
export function percent(ppm) {
    return formatNumber(ppm / 1_000_000, {
        style: "percent",
        maximumFractionDigits: 1,
    });
}
/** A unix time as a date in the reader's own locale. */
export function day(seconds) {
    return new Date(seconds * 1000).toLocaleDateString(intlLocale(), {
        year: "numeric",
        month: "long",
        day: "numeric",
    });
}
/**
 * A unix time as a date and time where the reader is. A month's credits
 * lapse at 00:00 UTC, which is the evening before in Honolulu and nine in
 * the morning in Seoul, so the date alone would be wrong for half the world.
 */
export function moment(seconds) {
    return new Date(seconds * 1000).toLocaleString(intlLocale(), {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });
}
/** The same instant in UTC, for the tooltip. */
export function utc(seconds) {
    return `${new Date(seconds * 1000).toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
/** Middle-truncate a long identifier for display. */
export function middle(value, head = 18, tail = 8) {
    return value.length <= head + tail + 1 ? value : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
//# sourceMappingURL=account-format.js.map