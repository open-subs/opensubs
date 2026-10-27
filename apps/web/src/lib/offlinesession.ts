// Who may export a video with no connection: someone whose session the
// account server vouched for recently.
//
// A session in storage proves only that somebody signed in once. Offline
// the server cannot be asked whether it is still good, so a burn offline
// goes ahead without the sign-in sheet only when the server last confirmed
// the session within OFFLINE_SAVE_MAX_AGE. The time is written whenever the
// SDK hands the page a fresh session (a sign-in, a token refresh), and when
// confirmSession() hears back. Online, each page load with the switch on asks
// once; a session the server refuses is dropped by the SDK itself, and the
// page then treats the visitor as signed out.
//
// Making subtitles, editing them and the text exports never look at this.

import { account, signedIn } from "./account";

const CONFIRMED_KEY = "opensubs.session.confirmedAt";

/** How long an export offline trusts the server's last word on the session. */
export const OFFLINE_SAVE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export function confirmedAt(): number | null {
  try {
    const at = Number(localStorage.getItem(CONFIRMED_KEY));
    return Number.isFinite(at) && at > 0 ? at : null;
  } catch {
    return null;
  }
}

function markConfirmed(): void {
  try {
    localStorage.setItem(CONFIRMED_KEY, String(Date.now()));
  } catch {
    // Without storage an export offline asks for a connection; nothing else changes.
  }
}

function clearConfirmed(): void {
  try {
    localStorage.removeItem(CONFIRMED_KEY);
  } catch {
    // Nothing to clear.
  }
}

/** Signed in here, and confirmed by the server within OFFLINE_SAVE_MAX_AGE. */
export function looksSignedIn(now = Date.now()): boolean {
  if (!signedIn()) return false;
  const at = confirmedAt();
  return at != null && now - at <= OFFLINE_SAVE_MAX_AGE && at <= now + 60_000;
}

/** Signed in here, but last confirmed too long ago to export offline on. */
export function confirmationStale(now = Date.now()): boolean {
  return signedIn() && !looksSignedIn(now);
}

/**
 * The SDK changed the session (account.ts passes every change on). A new
 * session is the server's own answer, so it counts as a confirmation.
 */
export function sessionChanged(session: unknown): void {
  if (session && typeof session === "object" && "accessToken" in session) markConfirmed();
  else clearConfirmed();
}

let confirming: Promise<"ok" | "refused" | "unknown" | "none"> | null = null;

/** Ask the account server, once per page load, whether the session here is still good. */
export function confirmSession(): Promise<"ok" | "refused" | "unknown" | "none"> {
  confirming ??= (async () => {
    if (!signedIn()) return "none";
    try {
      await account().auth.me();
      markConfirmed();
      return "ok";
    } catch {
      // The SDK drops a session the server refused (after trying a
      // refresh); one still here means the question never reached it.
      return signedIn() ? "unknown" : "refused";
    }
  })();
  return confirming;
}
