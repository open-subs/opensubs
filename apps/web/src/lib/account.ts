// Sign-in, balance, and the paid routes — all on opensubs.app hostnames.
//
// # Why the hostnames matter
//
// The accounts server and the paid-feature gateway are shared across every
// OpenApps product, but a user of this app should never see that. Every
// request leaves for an `opensubs.app` host:
//
//   auth.opensubs.app     →  the accounts server (sign-in, balance, top-ups)
//   gateway.opensubs.app  →  the gateway (paid translation)
//
// Nothing in this bundle, in a network panel, in a CSP header or in a
// redirect URL names the backend domain — which is the whole point, and the
// reason these two constants exist rather than being written at each call
// site.
//
// One limit worth knowing, because it is not this file's to fix: these
// names currently CNAME to the backend, and **a CNAME is public in DNS**.
// `dig auth.opensubs.app` shows the target. Pointing both at the host's own
// A record instead closes that, and costs nothing — the TLS certificate has
// to name `auth.opensubs.app` either way, so the CNAME buys nothing.
//
// If you add a call, add it here. A hardcoded URL somewhere else is exactly
// how the masking springs a leak that nobody notices until someone opens
// devtools.

import type { OpenApps } from "@openapps/sdk";
// Importing the elements registers <openapps-login>, <openapps-buy> and
// <openapps-signout> as custom elements. The import is a side effect, which
// is why it has no bindings.
import "@openapps/ui";
import { configure, getClient, notify, onChange } from "@openapps/ui";
import { Say } from "./say";
import { paidTranslation, rememberPaid } from "./paidjobs";

/** The accounts server, behind our own hostname. */
export const AUTH_URL = "https://auth.opensubs.app";

/** The paid-feature gateway, behind our own hostname. */
export const API_URL = "https://gateway.opensubs.app";

/**
 * The app id the ledger records this product's revenue under. Matches the
 * key issued as `OPENAPPS_KEY_OPENSUBS` and the gateway's `opensubs::APP_ID`.
 */
export const APP_ID = "opensubs";

/**
 * The one client on the page.
 *
 * Deliberately the *element* library's shared instance rather than a second
 * one of our own: the session lives inside the client, so two of them would
 * mean signing in through `<openapps-login>` and then reading the balance
 * from a client that had never heard of it. `configure()` is idempotent
 * enough for this — it is called once at mount — and `getClient()` covers
 * the case where an element upgraded first.
 */
export function account(): OpenApps {
  return getClient() ?? configure(CLIENT_OPTIONS);
}

/**
 * The client's options, in one place so both calls to `configure` agree.
 *
 * `onAuthChange` is the part that matters. The SDK drops a session it finds
 * dead -- a refresh token that was revoked or ran out -- and until this was
 * wired, it did so silently: the page went on showing a balance and "Sign
 * out" for an account it was no longer signed in to, and found out only
 * when a paid translation came back 401. Telling every listener means the
 * panel changes the moment the SDK knows.
 */
const CLIENT_OPTIONS = { baseUrl: AUTH_URL, onAuthChange: () => notify() };

// Configured here, at module load, rather than in a component's onMount.
//
// Custom elements upgrade as soon as the browser parses them, which is
// before any framework lifecycle hook runs. An `<openapps-login>` in the
// page header therefore came up before `onMount` could configure anything
// and threw "no OpenApps client: call configure({ baseUrl })". Configuring
// on import is ordered by the module graph instead of by rendering, so the
// client exists before any element can ask for it.
configure(CLIENT_OPTIONS);

/**
 * Kept for callers that want to be explicit. Returns the client configured
 * above rather than making another: `configure()` builds a new client every
 * time it is called, and a second one is not harmless. Back from a Google
 * sign-in, `<openapps-login>` starts exchanging the `#code=` on the first
 * client; replacing it mid-exchange made the elements reload on the second,
 * which read the same code from the address bar and spent it again. The
 * server answered the second exchange with a 401 on every redirect sign-in.
 */
export function configureAccount(): OpenApps {
  return account();
}

/**
 * Subscribe to "the session or the balance may have changed".
 *
 * Payload-free by design: a sign-in through one element has to refresh a
 * balance rendered by something else, and neither should have to know the
 * other exists.
 */
export const onAccountChange = onChange;

export function signedIn(): boolean {
  return account().isLoggedIn;
}

/** The bearer token for a gateway call, or null when signed out. */
function bearer(): string | null {
  return account().session?.accessToken ?? null;
}

/** The claims of an access token. Read, not verified: the server verifies. */
function claims(token: string | null): { sub?: string; exp?: number } | null {
  if (!token) return null;
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

/** The signed-in account's id, or null. */
export function userId(): string | null {
  return claims(bearer())?.sub ?? null;
}

/**
 * An access token the gateway will accept, refreshed first if it is about
 * to run out.
 *
 * Access tokens last fifteen minutes and the session behind them a month.
 * The SDK renews one when the accounts server turns it away, but a gateway
 * call does not go through the SDK, so a page left open for a quarter of an
 * hour sent a stale token, was refused, and told a signed-in user to sign
 * in. Asking for the balance is the cheapest call that makes the SDK
 * renew; if the session itself is dead it is dropped, and the page hears
 * about it through `onAuthChange`.
 */
async function freshBearer(force: boolean, signal?: AbortSignal): Promise<string | null> {
  const token = bearer();
  if (!token) return null;
  const exp = claims(token)?.exp ?? 0;
  if (!force && exp * 1000 - Date.now() > 60_000) return token;
  try {
    await account().credits.balance(signal);
  } catch {
    // Dropped, or the network: either way the token below is the answer.
  }
  return bearer();
}

export async function balance(signal?: AbortSignal): Promise<number> {
  if (!signedIn()) return 0;
  return account().credits.balance(signal);
}

export class NotSignedIn extends Say {
  constructor() {
    super("Sign in to translate on our backend.");
    this.name = "NotSignedIn";
  }
}

/** Was signed in, and the session behind it has ended. */
export class SignInExpired extends Say {
  constructor() {
    super("Your sign-in has expired. Sign in again to use your credits.");
    this.name = "SignInExpired";
  }
}

/**
 * The gateway has this job down as paid and no longer holds its answer --
 * it keeps one for fifteen minutes -- and the answer is not held here
 * either. Running it again is a new job.
 */
export class AlreadyPaid extends Say {
  constructor() {
    super(
      "This was translated and paid for earlier, but the result is no longer held. Translating it again is charged as a new job, at the price shown.",
    );
    this.name = "AlreadyPaid";
  }
}

export class InsufficientCredits extends Say {
  constructor(
    readonly need: number,
    readonly have: number,
  ) {
    super("This needs {need} credits and you have {have}. Add credits below.", { need, have });
    this.name = "InsufficientCredits";
  }
}

export interface TranslateResult {
  translations: string[];
  charged: number;
  newBalance: number;
}

/**
 * Translate on our backend, paid in credits.
 *
 * The price is **not** sent. It is computed here for display, and the
 * gateway computes its own from the same shared crate — so the two agree by
 * construction rather than by trust, and a tab with an edited bundle cannot
 * talk itself into a discount.
 *
 * `idempotencyKey` identifies the job, not the attempt: retrying after a
 * dropped response must replay the same charge rather than bill twice.
 */
export async function translateOnBackend(
  lines: string[],
  target: string,
  source: string | undefined,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<TranslateResult> {
  const user = userId();
  // Already paid for by this account and still held here: the same text,
  // with no request, no charge and no wait.
  const held = paidTranslation(user, idempotencyKey);
  if (held && held.length === lines.length) {
    return { translations: held, charged: 0, newBalance: -1 };
  }

  const token = await freshBearer(false, signal);
  if (!token) throw new NotSignedIn();

  const send = (bearerToken: string) =>
    fetch(`${API_URL}/${APP_ID}/translate`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearerToken}`,
      },
      body: JSON.stringify({
        lines,
        target,
        source: source ?? "auto",
        idempotency_key: idempotencyKey,
      }),
      signal,
    });

  let response = await send(token);
  if (response.status === 401) {
    // Refused although the clock said the token was good: renew it once
    // and ask again. A session that cannot be renewed has ended, and the
    // user is told that rather than to sign in as if they never had.
    const renewed = await freshBearer(true, signal);
    if (!renewed) throw new SignInExpired();
    response = await send(renewed);
    if (response.status === 401) {
      if (!signedIn()) throw new SignInExpired();
      // The accounts server still accepts this session and the gateway
      // does not: not something signing in again would fix.
      throw new Say("The translation service could not confirm your sign-in. You were not charged — try again.");
    }
  }

  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A proxy error page is HTML, not JSON. Fall through to the status.
  }

  if (!response.ok) throw translationError(response.status, body);

  const translations = (body.translations as string[]) ?? [];
  rememberPaid(user, idempotencyKey, translations);
  return {
    translations,
    charged: Number(body.charged ?? 0),
    newBalance: Number(body.new_balance ?? 0),
  };
}

/**
 * Turn a gateway failure into something a user can act on.
 *
 * Each of these has a different remedy — sign in, buy credits, try again,
 * tell us — so collapsing them into "something went wrong" would leave a
 * user with no next step.
 */
function translationError(status: number, body: Record<string, unknown>): Error {
  if (status === 401) return new NotSignedIn();
  if (status === 402) {
    return new InsufficientCredits(Number(body.need ?? 0), Number(body.have ?? 0));
  }
  if (status === 409 && body.error === "already_charged") return new AlreadyPaid();
  if (status === 409 && body.error === "in_progress") {
    return new Say("This translation is still running from an earlier attempt. Try again in a minute.");
  }
  if (status === 503 && body.error === "not_configured") {
    return new Say(
      "OpenSubs translation is not available right now. Use “On this device”, which is free, or bring your own API key.",
    );
  }
  if (body.error === "vendor_miscount") {
    return new Say(
      "The translation came back with the wrong number of lines, so it was rejected rather than risk desynchronising your subtitles. You were not charged — try again.",
    );
  }
  if (status === 502) {
    return new Say("The translation service could not be reached. You were not charged.");
  }
  return new Say("The translation service returned {status}.", { status });
}

/**
 * A stable id for one translation job.
 *
 * Derived from what is being translated rather than from a random value, so
 * that a retry after a dropped response produces the *same* key and replays
 * the charge instead of billing twice. A random UUID per attempt would
 * defeat the idempotency it looks like it provides.
 */
export function jobKey(lines: string[], target: string, source = "auto"): string {
  // The source language is part of the job: the gateway fingerprints it
  // with the lines and refuses a key reused for a different request.
  let hash = 0x811c9dc5;
  const material = `${source}\u0000${target}\u0000${lines.join("\u0000")}`;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${APP_ID}-translate-${hash.toString(16)}-${lines.length}`;
}

/**
 * The account, as `src/lib/iap.ts` needs it.
 *
 * That module deliberately imports nothing at runtime -- it is the one
 * place where the order "redeem, then finish" is enforced, and being
 * importable on its own is what lets a test drive it against a fake
 * StoreKit and a fake server. This adapter is the seam.
 */
export function iapSession(): import("./iap").Session {
  return {
    authUrl: AUTH_URL,
    token: () => account().session?.accessToken ?? undefined,
    signedIn,
    refresh: async () => {
      if (!signedIn()) return false;
      try {
        await account().credits.balance();
        return true;
      } catch {
        return false;
      }
    },
  };
}
