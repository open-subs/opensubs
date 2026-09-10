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
/** The code in this page's URL, if any. */
export declare function referralInUrl(): string | undefined;
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
export declare function captureReferral(): void;
/** A previously captured code, if one is stored and still inside the window. */
export declare function storedReferral(): string | undefined;
/**
 * Forget the stored code.
 *
 * Called once a login succeeds. The server already refuses a second
 * referral for the same user, but leaving the code behind would attach it
 * to the *next* account created in this browser — a different person on a
 * shared machine, credited to a referrer who never reached them.
 */
export declare function clearReferral(): void;
//# sourceMappingURL=referral-code.d.ts.map