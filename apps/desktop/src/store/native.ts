// The Mac App Store build's native half, seen from the page.
//
// Only the store build compiles this file in (vite.config.ts, OPENSUBS_STORE=1).
// The direct-download build never imports it: it sells credits through the
// card checkout and signs in through the web, which a Mac App Store app may
// not (guidelines 3.1.1 and 4.8).
//
// The shapes are the iOS shell's (apps/web/src/lib/native.ts, which restates
// apps/mobile/ios/App/App/OpenSubsStore.swift), so the order a purchase goes
// through -- pay, redeem on the server, then finish -- is the one tested in
// apps/web/src/lib/iap.ts and apps/web/e2e/iap.mjs, imported rather than
// written again. The Swift half is src-tauri/appstore/StoreBridge.swift,
// reached through one Tauri command, `store_call`.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Restated from apps/web/src/lib/native.ts rather than imported: that file
// imports Capacitor, which the desktop app does not carry.
export interface NativeProduct {
  id: string;
  name: string;
  description: string;
  /** StoreKit's own, in the customer's currency. Never reformat it. */
  price: string;
}

export interface NativePurchase {
  status: "purchased";
  transactionId: string;
  productId: string;
  /** The signed transaction (JWS), exactly as the server verifies it. */
  receipt: string;
  verifiedLocally: boolean;
}

export type NativePurchaseResult = NativePurchase | { status: "cancelled" } | { status: "pending" };

export interface NativeStore {
  products(): Promise<{ products: NativeProduct[] }>;
  purchase(options: { productId: string }): Promise<NativePurchaseResult>;
  outstanding(): Promise<{ receipts: NativePurchase[] }>;
  finish(options: { transactionId: string }): Promise<{ finished: boolean }>;
  addListener(
    event: "transaction",
    fn: (purchase: NativePurchase) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

function call<T>(op: string, arg: Record<string, unknown> = {}): Promise<T> {
  return invoke<T>("store_call", { op, arg });
}

/** StoreKit 2, as the iOS shell offers it. */
export const macStore: NativeStore = {
  products: () => call<{ products: NativeProduct[] }>("products"),
  purchase: ({ productId }) => call<NativePurchaseResult>("purchase", { productId }),
  outstanding: () => call<{ receipts: NativePurchase[] }>("outstanding"),
  finish: ({ transactionId }) => call<{ finished: boolean }>("finish", { transactionId }),
  // A purchase that arrives with nobody waiting for it: an interrupted one
  // completing, Ask to Buy approved later. The Swift half starts listening
  // at launch and the Rust half re-emits each one as this event.
  async addListener(_event, fn) {
    const unlisten = await listen<NativePurchase>("store-transaction", (e) => fn(e.payload));
    return { remove: async () => unlisten() };
  },
};

export type AppleSignInResult =
  | { status: "signed-in"; identityToken: string; authorizationCode?: string }
  | { status: "cancelled" };

/** Apple's own sign-in sheet. `nonce` is the SHA-256 of the server's challenge. */
export function signInWithApple(nonce: string): Promise<AppleSignInResult> {
  return call<AppleSignInResult>("signInWithApple", { nonce });
}
