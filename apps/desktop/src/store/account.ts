// The account, in the Mac App Store build.
//
// Stands in for src/lib/account.ts wherever the app imports it, but only in
// the store build: vite.config.ts swaps the module when OPENSUBS_STORE=1.
// Everything is the real module's except three things the App Store asks of
// an app that sells credits and offers Google sign-in:
//
//   - the price quoted is the App Store's, not the card checkout's;
//   - "Continue with Apple" is Apple's own sheet (guideline 4.8), not a
//     redirect;
//   - redemption of an App Store purchase uses the same session.

import "@openapps/ui/bundle";
import { notify } from "@openapps/ui/bundle";
import * as real from "../lib/account";
import { signInWithApple } from "./native";
import type { Session } from "../../../web/src/lib/iap";

export * from "../lib/account";

/**
 * The smaller pack as the App Store sells it in the United States: $4.99
 * for 1,000 credits (apps/mobile/scripts/asc.py, CONSUMABLES). The packs
 * themselves are shown with StoreKit's own price in the customer's
 * currency; this is only for the "about $0.05" beside a cloud price.
 */
export const PACK = { credits: 1000, usd: 4.99 };

/** What `credits` cost in dollars, at the App Store's pack price. */
export function dollars(credits: number): string {
  const usd = (credits * PACK.usd) / PACK.credits;
  return usd < 0.01 ? "less than $0.01" : `$${usd.toFixed(2)}`;
}

/** What redeeming an App Store purchase needs from the signed-in account. */
export function iapSession(): Session {
  return {
    authUrl: real.AUTH_URL,
    token: () => real.account().session?.accessToken ?? undefined,
    signedIn: real.signedIn,
    refresh: async () => {
      if (!real.signedIn()) return false;
      try {
        await real.account().credits.balance();
        return true;
      } catch {
        return false;
      }
    },
  };
}

/** Lower-case hex SHA-256, the form Apple's own samples put in the request. */
async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** The parts of `<openapps-login>` this module touches. */
interface LoginElement extends HTMLElement {
  enabled: Record<string, boolean> | null;
  sdk: {
    auth: {
      challenge(namespace: string): Promise<{ challenge_id: string; message: string }>;
      verify(id: string, proof: unknown): Promise<unknown>;
    };
  };
  run<T>(fn: () => Promise<T>): Promise<T | undefined>;
  emit(name: string, detail: unknown): void;
  load(): Promise<void>;
  loginWithRedirect(provider: string): void;
}

/**
 * Teach `<openapps-login>` that Apple means Apple's sheet: the server's
 * `apple_native` challenge, its SHA-256 as the nonce, the identity token
 * back to `/v1/auth/verify`. The same flow as the iOS app
 * (apps/web/src/lib/appleSignIn.ts), against the same bundle id, so the
 * server has nothing new to accept.
 */
function installAppleSheet(): void {
  const Login = customElements.get("openapps-login") as
    | (CustomElementConstructor & { prototype: LoginElement & { __macApple?: true } })
    | undefined;
  if (!Login || Login.prototype.__macApple) return;
  const proto = Login.prototype;
  proto.__macApple = true;

  const load = proto.load;
  proto.load = async function (this: LoginElement) {
    await load.call(this);
    // Apple is offered whenever the server can verify the sheet's token,
    // whether or not it also offers the web redirect on this host.
    if (this.enabled?.apple_native && !this.enabled.apple) {
      this.enabled = { ...this.enabled, apple: true };
    }
  };

  const redirect = proto.loginWithRedirect;
  proto.loginWithRedirect = function (this: LoginElement, provider: string) {
    if (provider !== "apple") return redirect.call(this, provider);
    void this.run(async () => {
      const challenge = await this.sdk.auth.challenge("apple_native");
      const answer = await signInWithApple(await sha256Hex(challenge.message));
      if (answer.status !== "signed-in") return; // closing the sheet is not an error
      const result = await this.sdk.auth.verify(challenge.challenge_id, {
        type: "apple_id_token",
        identity_token: answer.identityToken,
        authorization_code: answer.authorizationCode,
      });
      this.emit("openapps-login", result);
      notify();
    });
  };
}

// Before any <openapps-login> connects and asks the server what it offers.
installAppleSheet();
