// The "having trouble? ask us on Telegram" box, set up for OpenSubs.
//
// WHERE IT APPEARS
//
//   - under a burn that failed, and under a translation that failed;
//   - where a sign-in came back without a session, or a session ended under
//     the page;
//   - beside the credits while a purchase is still pending;
//   - and as the Telegram and X pair in the app's footer.
//
// THE TELEGRAM AND X BUTTONS
//
// <openapps-community> (openapps-community.js, vendored verbatim) draws the
// same two links as outlined buttons: in the site header (variant="header"),
// and once under a finished result -- subtitles just made, a burned video
// ready to save (variant="success"). Configured here, from the same links.
//
// WHERE IT SENDS PEOPLE
//
// To the OpenSubs topic in the public Telegram group, in a new tab. Opened
// from a failure, the panel shows the error code (or the pending top-up id)
// with a Copy button and asks for it to be included in the message. The box
// no longer holds a form and posts nothing; its one request is the pending
// top-up lookup, made only when signed in. What people post on Telegram is
// public and governed by Telegram; the website's privacy page says so.
//
// The old form's keys (appVersion, contactEmail, signIn) are still passed
// below; the box accepts and ignores them.
//
// WEBSITE ONLY
//
// The phone shells and the extension reuse this source. main.ts loads this
// module only in a browser tab, so elsewhere both elements stay undefined and
// render nothing.
import { configureSupport, openSupport, refreshSupport } from "./openapps-support.js";
import { configureCommunity } from "./openapps-community.js";
import { AUTH_URL, onAccountChange, supportToken } from "./account";
import pkg from "../../package.json";

export { openSupport };

const LINKS = {
  product: "OpenSubs",
  telegramUrl: "https://t.me/openappsnetwork/57",
  xUrl: "https://x.com/OpenSubsApp",
  xHandle: "@OpenSubsApp",
};

configureCommunity(LINKS);

configureSupport({
  ...LINKS,
  baseUrl: AUTH_URL,
  appVersion: pkg.version,
  getAccessToken: supportToken,
  contactEmail: "hello@opensubs.app",
  // The header's "Sign in", which opens the panel holding <openapps-login>.
  signIn: () => {
    window.scrollTo({ top: 0 });
    document.querySelector<HTMLButtonElement>(".nav-account .nav-signin")?.click();
  },
});

// Every box re-checks after a sign-in or sign-out.
onAccountChange(() => refreshSupport());
