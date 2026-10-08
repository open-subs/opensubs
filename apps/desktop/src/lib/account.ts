// The account: sign-in, credits and OpenSubs' cloud translation.
//
// Everything else in the desktop app runs on this computer and is free, so
// nothing here is needed to use it. The account exists for one thing: cloud
// translation, which runs on our servers and is paid in credits.
//
// Both hosts are this product's own names for the shared account service
// and gateway, so nothing a person sees, and no permission prompt, names
// any other domain. The same two the web app uses.

import type { OpenApps } from "@openapps/sdk";
import { configure, getClient, onChange } from "@openapps/ui/bundle";

/** The accounts server: sign-in, balance, buying credits. */
export const AUTH_URL = "https://auth.opensubs.app";

/** The gateway that runs and charges for cloud translation. */
export const API_URL = "https://gateway.opensubs.app";

/** The ledger's name for this product. Matches the gateway's `opensubs::APP_ID`. */
export const APP_ID = "opensubs";

/** The credit pack the accounts server sells, for wording only. */
export const PACK = { credits: 1000, usd: 5 };

/** Where Stripe sends the browser after a purchase. A desktop app has no page
 * a browser can return to, so it returns to the product's own site. */
export const CHECKOUT_RETURN = "https://opensubs.app/";

// Configured on import, before any account element can ask for a client:
// custom elements upgrade as soon as they are parsed, ahead of any
// component lifecycle.
configure({ baseUrl: AUTH_URL });

export function account(): OpenApps {
  return getClient() ?? configure({ baseUrl: AUTH_URL });
}

/** "The session or the balance may have changed." */
export const onAccountChange = onChange;

export function signedIn(): boolean {
  return account().isLoggedIn;
}

export async function balance(signal?: AbortSignal): Promise<number> {
  if (!signedIn()) return 0;
  return account().credits.balance(signal);
}

export class NotSignedIn extends Error {
  constructor() {
    super("Sign in to use cloud translation. Nothing was charged.");
    this.name = "NotSignedIn";
  }
}

export class InsufficientCredits extends Error {
  constructor(
    readonly need: number,
    readonly have: number,
  ) {
    super(
      need > 0
        ? `This translation needs ${need} credits and you have ${have}. Nothing was charged.`
        : "You do not have enough credits for this translation. Nothing was charged.",
    );
    this.name = "InsufficientCredits";
  }
}

export function priceLabel(credits: number): string {
  return `${credits} ${credits === 1 ? "credit" : "credits"}`;
}

/** What `credits` cost in dollars, at the pack price. */
export function dollars(credits: number): string {
  const usd = (credits * PACK.usd) / PACK.credits;
  return usd < 0.01 ? "less than $0.01" : `$${usd.toFixed(2)}`;
}

/**
 * A stable key for one translation job, derived from what is translated.
 * A retry after a dropped response sends the same key and so replays the
 * same charge instead of paying twice. The web app derives it the same way.
 */
export function jobKey(lines: string[], target: string): string {
  let hash = 0x811c9dc5;
  const material = `${target}\u0000${lines.join("\u0000")}`;
  for (let i = 0; i < material.length; i += 1) {
    hash ^= material.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `${APP_ID}-desktop-translate-${hash.toString(16)}-${lines.length}`;
}

/** The most lines one gateway request may carry. */
const MAX_LINES = 500;

export interface TranslateResult {
  translations: string[];
  charged: number;
  newBalance: number;
}

/**
 * Translate on our servers, paid in credits. The price is not sent: the
 * gateway computes it from the lines, the same way `transcribe_for_cloud`
 * did, and charges only after the translation succeeded.
 */
export async function translateOnBackend(
  lines: string[],
  target: string,
  source: string,
  fetcher: typeof fetch = fetch,
): Promise<TranslateResult> {
  const client = account();
  const result: TranslateResult = { translations: [], charged: 0, newBalance: 0 };
  for (let i = 0; i < lines.length; i += MAX_LINES) {
    const chunk = lines.slice(i, i + MAX_LINES);
    const token = client.session?.accessToken;
    if (!token) throw new NotSignedIn();
    let response = await post(fetcher, token, chunk, target, source);
    if (response.status === 401) {
      // An access token lasts a quarter of an hour. Ask the account
      // client to refresh it (any authenticated call does) and try once.
      try {
        await client.credits.balance();
      } catch {
        throw new NotSignedIn();
      }
      const fresh = client.session?.accessToken;
      if (!fresh) throw new NotSignedIn();
      response = await post(fetcher, fresh, chunk, target, source);
    }
    const body = await readJson(response);
    if (!response.ok) throw gatewayError(response.status, body);
    const out = (body.translations as string[] | undefined) ?? [];
    if (out.length !== chunk.length) {
      throw new Error(
        "The translation came back with the wrong number of lines, so it was not used.",
      );
    }
    result.translations.push(...out);
    result.charged += Number(body.charged ?? 0);
    result.newBalance = Number(body.new_balance ?? result.newBalance);
  }
  return result;
}

function post(
  fetcher: typeof fetch,
  token: string,
  lines: string[],
  target: string,
  source: string,
): Promise<Response> {
  return fetcher(`${API_URL}/${APP_ID}/translate`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ lines, target, source, idempotency_key: jobKey(lines, target) }),
  });
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await response.text()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/** Each failure has its own remedy, so each gets its own message. */
export function gatewayError(status: number, body: Record<string, unknown>): Error {
  if (status === 401) return new NotSignedIn();
  if (status === 402) return new InsufficientCredits(Number(body.need ?? 0), Number(body.have ?? 0));
  if (status === 503 && body.error === "not_configured") {
    return new Error(
      "Cloud translation is not available right now. Translating on this computer is free. Nothing was charged.",
    );
  }
  if (body.error === "vendor_miscount") {
    return new Error(
      "The translation came back with the wrong number of lines, so it was not used. Nothing was charged; try again.",
    );
  }
  if (status === 502) {
    return new Error("The translation service could not be reached. Nothing was charged; try again.");
  }
  return new Error(`Cloud translation failed (${status}). Nothing was charged.`);
}
