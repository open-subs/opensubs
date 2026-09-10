/**
 * Carrying a referral code from the page that received it to the page that
 * signs someone up.
 *
 * `?ref=CODE` lands on whatever URL the referrer shared — a landing page, a
 * marketing site, the app's own root. Sign-in very often happens somewhere
 * else: OpenPdfEdit opens a popup at `/login`, because `<openapps-login>`'s
 * Google button navigates the whole window out to accounts.google.com and a
 * window holding an open document cannot afford that. The popup's own URL
 * carries no query string, so reading `location.search` there finds nothing
 * and the signup is attributed to no one.
 *
 * That was the actual bug: links were generated correctly, the referee
 * signed up, and the referrer's account never heard about it.
 *
 * So the code is captured the moment any page carrying it boots the SDK,
 * and read back at sign-in time. Both halves are the same origin, which is
 * what makes `localStorage` the right place — a popup, a later tab, and a
 * visit tomorrow all see it.
 *
 * What this deliberately does not solve: a code that has to cross an
 * *origin*. An extension signing in on `auth.opencapture.app` cannot read
 * what `opencapture.app` stored, and nothing here changes that. That
 * journey needs the code in the sign-in URL (the server's `/signin` page
 * reads `?ref=` itself) or a sign-in that happens on the landing origin.
 */
const KEY = "openapps.referral";
/**
 * How long a captured code stays usable.
 *
 * Someone who clicks a link, reads the page, and comes back to sign up next
 * week should still be attributed; someone whose browser has held a code
 * since last year should not, or a shared machine keeps crediting a
 * referrer for strangers. Thirty days is the ordinary affiliate window.
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * Every access is wrapped: `localStorage` is not merely empty in a private
 * window or a hardened browser profile, it *throws* on access. A referral
 * code is a nice-to-have, so failing to store one must never be able to
 * break a sign-in.
 */
function read() {
    try {
        const raw = localStorage.getItem(KEY);
        if (!raw)
            return null;
        const parsed = JSON.parse(raw);
        if (typeof parsed?.code !== "string" || typeof parsed?.at !== "number")
            return null;
        return { code: parsed.code, at: parsed.at };
    }
    catch {
        return null;
    }
}
/** The code in this page's URL, if any. */
export function referralInUrl() {
    if (typeof location === "undefined")
        return undefined;
    try {
        return new URLSearchParams(location.search).get("ref") ?? undefined;
    }
    catch {
        return undefined;
    }
}
/**
 * Remember a `?ref=` seen in this page's URL.
 *
 * Called from `configure()`, which every app runs once per page — including
 * the landing page, which usually mounts no OpenApps element at all and so
 * would otherwise see the code and drop it.
 *
 * Last touch wins: arriving through a fresh link overwrites an older stored
 * code, because the link someone just clicked is the one that brought them.
 */
export function captureReferral() {
    const code = referralInUrl();
    if (!code)
        return;
    try {
        localStorage.setItem(KEY, JSON.stringify({ code, at: Date.now() }));
    }
    catch {
        // Storage refused. The in-URL path still works for a sign-in that
        // happens on this same page, which is the common case on the web.
    }
}
/** A previously captured code, if one is stored and still inside the window. */
export function storedReferral() {
    const stored = read();
    if (!stored)
        return undefined;
    if (Date.now() - stored.at > TTL_MS) {
        clearReferral();
        return undefined;
    }
    return stored.code;
}
/**
 * Forget the stored code.
 *
 * Called once a login succeeds. The server already refuses a second
 * referral for the same user, but leaving the code behind would attach it
 * to the *next* account created in this browser — a different person on a
 * shared machine, credited to a referrer who never reached them.
 */
export function clearReferral() {
    try {
        localStorage.removeItem(KEY);
    }
    catch {
        // Nothing stored it in the first place.
    }
}
//# sourceMappingURL=referral-code.js.map