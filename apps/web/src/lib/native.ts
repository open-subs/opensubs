// The iOS shell, seen from the web app.
//
// OpenSubs on a phone is this same web app inside a Capacitor shell, and
// the shell carries one thing the page cannot do for itself: sell credits
// through the App Store. Everything native goes through the object below
// and nowhere else, so the web, desktop and extension builds compile with
// no iOS types anywhere in them.
//
// The types restate the plugin's contract (apps/mobile/ios/App/App/
// OpenSubsStore.swift). They are a promise this file makes on the shell's
// behalf, so the two have to change together; the Swift file's own
// comments are the reference.

/** A credit pack, priced by StoreKit in the customer's own currency. */
export interface NativeProduct {
  id: string;
  name: string;
  description: string;
  /** Already formatted for the customer's region. Never reformat it: a
   *  price rendered by us shows ¥500 as $500. */
  price: string;
}

/** A completed purchase. Not credits yet -- the receipt has to be redeemed. */
export interface NativePurchase {
  status: "purchased";
  transactionId: string;
  productId: string;
  /** The signed transaction (JWS), exactly as the server verifies it. */
  receipt: string;
  /** Whether StoreKit's own check passed on the device. Reported, never
   *  acted on: the server verifies Apple's signature itself, and a device
   *  with a wrong clock fails here and verifies perfectly there. */
  verifiedLocally: boolean;
}

export type NativePurchaseResult =
  | NativePurchase
  // Not an error. Someone who taps Cancel has not had a problem, and
  // showing them a failure is the commonest way apps get this wrong.
  | { status: "cancelled" }
  // Ask to Buy, or a payment method that settles later. The credits
  // arrive through the unprompted-transaction listener, possibly days on.
  | { status: "pending" };

export interface NativeStore {
  products(): Promise<{ products: NativeProduct[] }>;
  purchase(options: { productId: string }): Promise<NativePurchaseResult>;
  /** Purchases StoreKit still considers owing, including from previous
   *  launches -- the recovery path for one interrupted by a crash or a
   *  dead network. */
  outstanding(): Promise<{ receipts: NativePurchase[] }>;
  /** Marks a transaction done, *after* the server granted its credits. */
  finish(options: { transactionId: string }): Promise<{ finished: boolean }>;
  addListener(
    event: "transaction",
    fn: (purchase: NativePurchase) => void,
  ): Promise<{ remove: () => Promise<void> }>;
}

import { Capacitor, registerPlugin } from "@capacitor/core";

/**
 * Whether the app is running inside a native shell of any kind.
 *
 * Used for copy as well as for capability: several lines in the interface
 * say "browser", which is true of the page and reads as a wrapped website
 * to somebody holding a phone -- and reads worse still in a store
 * screenshot. Decided at runtime rather than rewritten into the bundle at
 * build time, which is what the staging script used to do back when that
 * copy lived in a page it could edit.
 */
export function inNativeShell(): boolean {
  return Capacitor.isNativePlatform();
}

/** Whether this is the iOS/iPadOS shell rather than a browser. */
export function onApple(): boolean {
  return inNativeShell() && Capacitor.getPlatform() === "ios";
}

// Registered once, at module load. `registerPlugin` only builds a proxy --
// it neither calls the shell nor fails in a browser, where the proxy
// throws Unimplemented on use and `appleStore()` never hands it out.
const plugin = registerPlugin<NativeStore>("OpenSubsStore");

/**
 * The StoreKit plugin, or `null` everywhere that is not the iOS shell.
 *
 * Asked of Capacitor by name rather than assumed from the platform: a
 * build installed from TestFlight before the plugin existed is still iOS,
 * and a page that offered a StoreKit panel there would offer a button that
 * throws. `isPluginAvailable` answers from the bridge's own list of what
 * the shell actually carries.
 */
export function appleStore(): NativeStore | null {
  if (!onApple() || !Capacitor.isPluginAvailable("OpenSubsStore")) return null;
  return plugin;
}

/**
 * Whether credits must be bought through the App Store here.
 *
 * Not a preference. App Store Review Guideline 3.1.1 requires in-app
 * purchase for digital content used in the app, so the web app's own
 * <openapps-buy> -- a card checkout -- is not merely redundant inside the
 * shell, it is the thing that must not be there. An app that shows one is
 * rejected, and one that slips through is removed.
 *
 * True whenever this is the iOS shell, including when the plugin is
 * missing: the card checkout must be hidden either way. What the plugin's
 * absence changes is only whether a StoreKit panel can be offered in its
 * place.
 */
export function mustUseInAppPurchase(): boolean {
  return onApple();
}
