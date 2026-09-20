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
import { configure, getClient, onChange } from "@openapps/ui";

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
  return getClient() ?? configure({ baseUrl: AUTH_URL });
}

// Configured here, at module load, rather than in a component's onMount.
//
// Custom elements upgrade as soon as the browser parses them, which is
// before any framework lifecycle hook runs. An `<openapps-login>` in the
// page header therefore came up before `onMount` could configure anything
// and threw "no OpenApps client: call configure({ baseUrl })". Configuring
// on import is ordered by the module graph instead of by rendering, so the
// client exists before any element can ask for it.
configure({ baseUrl: AUTH_URL });

/** Kept for callers that want to be explicit; configuring twice is harmless. */
export function configureAccount(): OpenApps {
  return configure({ baseUrl: AUTH_URL });
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

export async function balance(signal?: AbortSignal): Promise<number> {
  if (!signedIn()) return 0;
  return account().credits.balance(signal);
}

export class NotSignedIn extends Error {
  constructor() {
    super("Sign in to use OpenSubs translation.");
    this.name = "NotSignedIn";
  }
}

export class InsufficientCredits extends Error {
  constructor(
    readonly need: number,
    readonly have: number,
  ) {
    super(`This needs ${need} credits and you have ${have}.`);
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
  const token = bearer();
  if (!token) throw new NotSignedIn();

  const response = await fetch(`${API_URL}/${APP_ID}/translate`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      lines,
      target,
      source: source ?? "auto",
      idempotency_key: idempotencyKey,
    }),
    signal,
  });

  const raw = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    // A proxy error page is HTML, not JSON. Fall through to the status.
  }

  if (!response.ok) throw translationError(response.status, body);

  return {
    translations: (body.translations as string[]) ?? [],
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
  if (status === 503 && body.error === "not_configured") {
    return new Error(
      "OpenSubs translation is not available right now. Use “On this device”, " +
        "which is free, or bring your own API key.",
    );
  }
  if (body.error === "vendor_miscount") {
    return new Error(
      "The translation came back with the wrong number of lines, so it was " +
        "rejected rather than risk desynchronising your subtitles. " +
        "You were not charged — try again.",
    );
  }
  if (status === 502) {
    return new Error("The translation service could not be reached. You were not charged.");
  }
  return new Error(`The translation service returned ${status}.`);
}

/**
 * A stable id for one translation job.
 *
 * Derived from what is being translated rather than from a random value, so
 * that a retry after a dropped response produces the *same* key and replays
 * the charge instead of billing twice. A random UUID per attempt would
 * defeat the idempotency it looks like it provides.
 */
export function jobKey(lines: string[], target: string): string {
  let hash = 0x811c9dc5;
  const material = `${target}\u0000${lines.join("\u0000")}`;
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
