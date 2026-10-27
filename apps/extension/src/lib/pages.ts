/**
 * Pages no extension may put a script into.
 *
 * Start on one of them used to end in the browser's own refusal, passed
 * through word for word: "This page cannot be subtitled: The extensions
 * gallery cannot be scripted." True, and no help to someone who has just
 * installed the extension from that very store page and pressed Start to see
 * what it does -- it reads as the extension being broken. What they need to
 * hear is where it does work.
 *
 * So the popup checks the tab's address before asking for anything, and the
 * background turns a failed injection into the same sentence, for the pages
 * nobody listed here. The list is only the first line of defence; the mapped
 * failure is the one that cannot be missed.
 */

/** What to tell someone who pressed Start on such a page. English; the key. */
export const NOT_A_WEB_PAGE =
  "Subtitles can't run on this page. Open an ordinary web page with a video playing, then press Start again.";

/** Schemes that are the browser's own, or another extension's. */
const BROWSER_SCHEMES = new Set([
  "about:", "chrome:", "chrome-extension:", "chrome-search:", "chrome-untrusted:", "devtools:",
  "edge:", "extension:", "moz-extension:", "resource:", "view-source:", "brave:", "opera:",
  "vivaldi:",
]);

/**
 * Hosts the browsers refuse to script although they are ordinary https.
 * Chromium's are its two stores; Firefox's are the defaults of its
 * `extensions.webextensions.restrictedDomains` preference.
 */
const PROTECTED_HOSTS = new Set([
  "chromewebstore.google.com",
  "microsoftedge.microsoft.com",
  "addons.mozilla.org",
  "accounts-static.cdn.mozilla.net",
  "accounts.firefox.com",
  "addons.cdn.mozilla.net",
  "api.accounts.firefox.com",
  "content.cdn.mozilla.net",
  "discovery.addons.mozilla.org",
  "install.mozilla.org",
  "oauth.accounts.firefox.com",
  "profile.accounts.firefox.com",
  "support.mozilla.org",
  "sync.services.mozilla.com",
]);

/**
 * Whether this address is one the browser will not let an extension script.
 *
 * `undefined` is "do not know", not "yes": the popup may be refused the
 * address, and the injection's own failure is the answer then.
 */
export function cannotScript(url: string | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (BROWSER_SCHEMES.has(u.protocol)) return true;
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (PROTECTED_HOSTS.has(host)) {
    // Edge's store is a path on a host that also serves other things.
    return host !== "microsoftedge.microsoft.com" || u.pathname.startsWith("/addons");
  }
  // The old Web Store address still redirects into the new one.
  if (host === "chrome.google.com" && u.pathname.startsWith("/webstore")) return true;
  // Edge's new-tab page is a web page with a browser-only role.
  if (host === "ntp.msn.com" && u.pathname.startsWith("/edge/ntp")) return true;
  // A PDF opens in the browser's own viewer, which takes no scripts. Judged by
  // the address, so a PDF whose address does not end in .pdf is missed here
  // and caught by the injection's failure instead.
  if (/\.pdf$/i.test(u.pathname)) return true;
  return false;
}
