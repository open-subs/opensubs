// Sign in with Apple in the iOS app, through Apple's own sheet.
//
// The App Store asks an app that offers Google sign-in to offer Sign in
// with Apple beside it (Review Guideline 4.8). On the web that is a
// redirect to Apple and back, which needs the callback registered with
// Apple for every host it runs on. In the app it needs none of that:
// `ASAuthorizationAppleIDProvider` shows the system sheet, named after this
// app, and hands back an identity token addressed to its bundle id.
//
// `<openapps-login>` knows only the redirect flow. Rather than fork it, this
// module teaches the one element class two things, and only inside the iOS
// shell when the shell carries the sheet:
//
//   - the server's `apple_native` method counts as Apple, so the
//     "Continue with Apple" button appears first, where Apple's guidelines
//     want it, in every place the element is used;
//   - that button runs the sheet instead of navigating away. The nonce
//     comes from the server's challenge and goes to the sheet as its SHA-256,
//     the token comes back to `/v1/auth/verify`, and the session lands in
//     the SDK exactly as a wallet sign-in's does.
//
// Everywhere else, including the opensubs.app website, nothing changes.

import { notify } from "@openapps/ui";
import { nativeAppleSignIn, type NativeAuth } from "./native";

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

/** Lower-case hex SHA-256, the form Apple's own samples put in the request. */
export async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * One native sign-in, start to finish. Resolves to the verify result, or to
 * `null` when the person closed the sheet -- which is not an error and
 * shows none.
 */
export async function signInWithAppleSheet(
  element: Pick<LoginElement, "sdk">,
  sheet: NativeAuth,
): Promise<unknown | null> {
  const challenge = await element.sdk.auth.challenge("apple_native");
  const answer = await sheet.signInWithApple({ nonce: await sha256Hex(challenge.message) });
  if (answer.status !== "signed-in") return null;
  return element.sdk.auth.verify(challenge.challenge_id, {
    type: "apple_id_token",
    identity_token: answer.identityToken,
    authorization_code: answer.authorizationCode,
  });
}

/**
 * Install the native path on the element class. Idempotent, and a no-op
 * wherever the shell has no sheet.
 */
export function installNativeAppleSignIn(): void {
  const sheet = nativeAppleSignIn();
  if (!sheet) return;
  const Login = customElements.get("openapps-login") as
    | (CustomElementConstructor & { prototype: LoginElement & { __nativeApple?: true } })
    | undefined;
  if (!Login || Login.prototype.__nativeApple) return;
  const proto = Login.prototype;
  proto.__nativeApple = true;

  const load = proto.load;
  proto.load = async function (this: LoginElement) {
    await load.call(this);
    // The web flow is never offered on this host (its callback is not
    // registered with Apple), so `apple` is false here; the sheet is what
    // Apple sign-in means in the app.
    if (this.enabled?.apple_native && !this.enabled.apple) {
      this.enabled = { ...this.enabled, apple: true };
    }
  };

  const redirect = proto.loginWithRedirect;
  proto.loginWithRedirect = function (this: LoginElement, provider: string) {
    if (provider !== "apple") return redirect.call(this, provider);
    void this.run(async () => {
      const result = await signInWithAppleSheet(this, sheet);
      if (result === null) return;
      this.emit("openapps-login", result);
      notify();
    });
  };
}
