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

/**
 * What Apple's own sign-in sheet hands back (apps/mobile/ios/App/App/
 * OpenSubsAuth.swift, `signInWithApple`).
 *
 * The identity token is a JWT Apple signed, addressed to this app's bundle
 * id and carrying the nonce it was asked for; the server checks all three.
 * The authorization code is spent by the server on Apple's refresh token,
 * which exists so that deleting the account can revoke the grant.
 */
export type NativeAppleResult =
  | { status: "signed-in"; identityToken: string; authorizationCode?: string }
  // Not an error, for the same reason a cancelled purchase is not.
  | { status: "cancelled" };

export interface NativeAuth {
  signInWithApple(options: { nonce: string }): Promise<NativeAppleResult>;
}

const authPlugin = registerPlugin<NativeAuth>("OpenSubsAuth");

/**
 * The shell's Sign in with Apple, or `null` where there is none: every
 * browser, and an iOS build from before the method existed. The plugin has
 * been in the shell since the Google sign-in fix, so its presence alone
 * says nothing; the method is asked for by name.
 */
export function nativeAppleSignIn(): NativeAuth | null {
  if (!onApple() || !Capacitor.isPluginAvailable("OpenSubsAuth")) return null;
  const methods = (
    (globalThis as { Capacitor?: { PluginHeaders?: { name: string; methods: { name: string }[] }[] } })
      .Capacitor?.PluginHeaders ?? []
  ).find((p) => p.name === "OpenSubsAuth")?.methods;
  if (methods && !methods.some((m) => m.name === "signInWithApple")) return null;
  return authPlugin;
}

/**
 * The shell's share sheet (apps/mobile/ios/App/App/OpenSubsShare.swift).
 *
 * Exists because a WKWebView drops `<a download>`: the export buttons
 * save by clicking a blob link, which in a browser is a download and in
 * the shell is nothing at all. `write` puts bytes into a temporary file,
 * in base64 chunks, and `share` opens the system sheet on it -- "Save to
 * Files" for anything, "Save Video" for a burned video.
 */
export interface NativeShare {
  write(options: { name: string; data: string; append: boolean }): Promise<void>;
  share(options: { name: string }): Promise<{ completed: boolean; activity: string }>;
}

const sharePlugin = registerPlugin<NativeShare>("OpenSubsShare");

/**
 * The share sheet, or `null` in every browser -- and in an iOS build from
 * before the plugin, where the export buttons stay what they were.
 */
export function nativeShare(): NativeShare | null {
  if (!onApple() || !Capacitor.isPluginAvailable("OpenSubsShare")) return null;
  return sharePlugin;
}

/** Bytes per bridge call: 1.5 MiB, a multiple of 3, so every chunk
 *  encodes to base64 with no padding and the chunks concatenate into the
 *  file. Small enough that the web view never holds much of a long video
 *  as a string at once. */
const SHARE_CHUNK = 3 * 512 * 1024;

function chunkToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const url = String(reader.result);
      resolve(url.slice(url.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

let sharing = false;

/**
 * Hands an export to the share sheet. Returns `false` where there is no
 * sheet to hand it to, so the caller does what a browser does instead.
 *
 * A second tap while a large video is still crossing the bridge is
 * ignored rather than starting a second copy over the first.
 */
export async function shareFile(blob: Blob, name: string): Promise<boolean> {
  const shell = nativeShare();
  if (!shell) return false;
  if (sharing) return true;
  sharing = true;
  try {
    let at = 0;
    do {
      const data = await chunkToBase64(blob.slice(at, at + SHARE_CHUNK));
      await shell.write({ name, data, append: at > 0 });
      at += SHARE_CHUNK;
    } while (at < blob.size);
    await shell.share({ name });
  } finally {
    sharing = false;
  }
  return true;
}
