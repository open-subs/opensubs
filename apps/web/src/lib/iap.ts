// Turning an App Store purchase into credits.
//
// Shared by the buy button and the recovery sweep at startup, because both
// do the same three things in the same order, and the order is the part
// that costs money to get wrong:
//
//   1. StoreKit takes the payment and hands back a signed transaction.
//   2. The server verifies it and grants the credits.
//   3. Only then is the transaction *finished*.
//
// StoreKit re-delivers an unfinished transaction on every launch, which is
// what lets a purchase survive a crash, a dead network or a force-quit
// between steps 1 and 2. Finishing early throws that away and leaves
// somebody charged for credits nobody granted, with no record left to
// retry from. Nothing here finishes a transaction the server has not
// honoured.
//
// Why this lives in the web app rather than in the shell: the shell has no
// account. Sign-in, the access token and the balance are all the page's,
// and a Swift half that had to reach into them would be a second
// implementation of the session.
//
// The session arrives as an argument rather than through an import of
// ./account, which would pull the whole account SDK in behind it. That
// keeps this module importable on its own -- which is what lets
// e2e/iap.mjs test the order below against a fake StoreKit and a fake
// server, neither of which a real sandbox purchase would exercise,
// because a real one succeeds.

import type { NativePurchase, NativeStore } from "./native";

/** What redemption needs from the signed-in account. */
export interface Session {
  /** The bearer token, or undefined when signed out. */
  token(): string | undefined;
  /** Ask the SDK for something so its refresh-on-401 runs. True if the
   *  session works afterwards. */
  refresh(): Promise<boolean>;
  signedIn(): boolean;
  /** Where the accounts server lives. */
  authUrl: string;
}

export type RedeemResult =
  | { ok: true; credits: number; alreadyCredited: boolean }
  | { ok: false; kind: "unauthorized" | "rejected" | "offline"; message?: string };

/**
 * Hand a signed transaction to the server, which verifies Apple's
 * signature and credits the ledger.
 *
 * Safe to call twice with the same receipt: the server keys the settlement
 * on Apple's transaction id and answers `already_processed` rather than
 * crediting again. That is what makes a dropped response a retry instead
 * of a lost purchase.
 */
export async function redeemAppleReceipt(
  authUrl: string,
  accessToken: string | undefined,
  signedTransaction: string,
): Promise<RedeemResult> {
  if (!accessToken) return { ok: false, kind: "unauthorized" };
  let res: Response;
  try {
    res = await fetch(`${authUrl}/v1/payments/apple/redeem`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ signed_transaction: signedTransaction }),
    });
  } catch {
    // No network. The transaction is still unfinished, so StoreKit will
    // offer it again -- this is a delay, not a loss, and must not be
    // reported as a failed purchase.
    return { ok: false, kind: "offline" };
  }
  const body = (await res.json().catch(() => ({}))) as {
    credits?: number;
    status?: string;
    error?: string;
  };
  if (res.ok && typeof body.credits === "number") {
    return { ok: true, credits: body.credits, alreadyCredited: body.status === "already_processed" };
  }
  if (res.status === 401 || res.status === 403) return { ok: false, kind: "unauthorized" };
  return { ok: false, kind: "rejected", message: body.error };
}

/**
 * Redeem one receipt, and finish the transaction only if the server
 * granted its credits.
 */
export async function collect(
  receipt: NativePurchase,
  store: NativeStore,
  session: Session,
): Promise<RedeemResult> {
  let result = await redeemAppleReceipt(session.authUrl, session.token(), receipt.receipt);

  // An access token that aged out. `redeemAppleReceipt` is a plain fetch,
  // so the SDK's refresh-on-401 does not cover it, and a stale token would
  // tell somebody who had just paid to sign in again. Refresh through the
  // SDK and ask once more before believing it.
  if (!result.ok && result.kind === "unauthorized" && (await session.refresh())) {
    result = await redeemAppleReceipt(session.authUrl, session.token(), receipt.receipt);
  }

  if (result.ok) await store.finish({ transactionId: receipt.transactionId });
  return result;
}

/**
 * Everything StoreKit still considers owing, redeemed.
 *
 * Runs unprompted at startup rather than behind a "Restore purchases"
 * button: somebody whose payment went through should not have to know that
 * word, and the case this exists for -- a redemption that never reached
 * the server -- is one they have no way to describe.
 *
 * Returns how many credits were newly granted, for the caller to report or
 * ignore.
 */
export async function collectOutstanding(store: NativeStore, session: Session): Promise<number> {
  if (!session.signedIn()) return 0;
  let credited = 0;
  try {
    const { receipts } = await store.outstanding();
    for (const receipt of receipts) {
      const result = await collect(receipt, store, session);
      if (result.ok && !result.alreadyCredited) credited += result.credits;
    }
  } catch {
    // Best-effort and unasked-for. StoreKit offers the same transactions
    // again next launch, so a failure costs a delay -- and an error about
    // something nobody requested is worse than silence.
  }
  return credited;
}
