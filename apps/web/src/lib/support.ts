// The "having trouble? leave us a message" box, set up for OpenSubs.
//
// WHERE IT APPEARS
//
//   - under a burn that failed, and under a translation that failed;
//   - where a sign-in came back without a session, or a session ended under
//     the page;
//   - beside the credits while a purchase is still pending;
//   - and as one quiet line in the app's footer.
//
// WHO MAY WRITE
//
// Loading a page sends nothing. A signed-out visitor who opens the box makes
// it ask the account server, once, whether signed-out visitors may write
// (`support.require_signin` on /v1/auth/methods); if not, the box offers the
// header's sign-in instead of the form, and at a failed or expired sign-in
// the contact address as well.
//
// WHAT IT SENDS, AND WHEN
//
// Nothing until the person presses Send. Then: what they typed, an email if
// they give one, which of the places above they were in, the page address
// without its query or fragment, this build's version, the interface
// language, a short error code, and — signed in — the session, so the
// account is attached. Never the video, the subtitles or a file name. The
// full list is in openapps-support.js; the website's privacy page states it.
//
// WEBSITE ONLY
//
// The phone shells and the extension reuse this source. main.ts loads this
// module only in a browser tab, so elsewhere the element stays undefined and
// renders nothing.
import { configureSupport, openSupport, refreshSupport } from "./openapps-support.js";
import { AUTH_URL, onAccountChange, supportToken } from "./account";
import pkg from "../../package.json";

export { openSupport };

configureSupport({
  baseUrl: AUTH_URL,
  product: "OpenSubs",
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
