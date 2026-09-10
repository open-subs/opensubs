/**
 * `@openapps/ui` — drop-in web components for a OpenApps server.
 *
 * ```html
 * <script type="module">
 *   import { configure } from "@openapps/ui";
 *   configure({ baseUrl: "https://accounts.example.com" });
 * </script>
 *
 * <openapps-login></openapps-login>
 * <openapps-credits poll-seconds="30"></openapps-credits>
 * <openapps-history></openapps-history>
 * <openapps-buy></openapps-buy>
 * <openapps-referral></openapps-referral>
 * ```
 *
 * Importing this module registers every custom element. They share one
 * client, so signing in with `<openapps-login>` updates the balance shown by
 * `<openapps-credits>` and unlocks `<openapps-buy>` with no glue code.
 *
 * Styling comes from the OpenApps design tokens. Link them once and every
 * element picks them up — custom properties cross the shadow boundary, which
 * is the whole seam:
 *
 * ```html
 * <link rel="stylesheet" href="node_modules/@openapps/tokens/tokens.css" />
 * ```
 *
 * Without that link the elements still render correctly against inlined
 * fallbacks, so dropping one into a bare page is never broken — just
 * unbranded.
 *
 * Override any semantic token on an ancestor to re-skin: `--brand`,
 * `--surface-card`, `--border-hairline`, `--text-strong`, `--radius-lg`,
 * `--font-sans`. Do not reach for a ramp entry like `--green-500`; naming a
 * hue inside a product surface is what stops the system being re-skinnable.
 *
 * Dark mode is the host's call — put `oa-auto` on `<html>` to follow the OS,
 * or `oa-dark` on any container to force it. The elements deliberately do
 * not run their own media query, or a host that forced dark would find them
 * stuck in light.
 */
export { configure, getClient, onChange, notify } from "./context.js";
export { captureReferral, clearReferral, referralInUrl, storedReferral, } from "./referral-code.js";
export { OpenAppsElement } from "./base.js";
export { OpenAppsLogin } from "./openapps-login.js";
export { OpenAppsAccount } from "./openapps-account.js";
export { OpenAppsCredits } from "./openapps-credits.js";
export { OpenAppsHistory } from "./openapps-history.js";
export { OpenAppsReferral } from "./openapps-referral.js";
export { OpenAppsSignout } from "./openapps-signout.js";
export { OpenAppsBuy } from "./openapps-buy.js";
export { availableNamespaces, connectEthereum, findNostrProvider, signNostr, signNostrWithBunker, signNostrWithSecretKey, signSiwe, waitForNostrProvider, WalletError, } from "./wallet.js";
//# sourceMappingURL=index.d.ts.map