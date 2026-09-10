/**
 * `<openapps-login>` — the whole sign-in flow in one tag.
 *
 * Offers every method the *server* has configured, and works out whether
 * this browser can complete it when the user clicks. Detecting up front is
 * tempting but wrong: extensions inject their providers at unpredictable
 * moments, and multi-chain wallets register their less-used chains last, so
 * a snapshot taken at first render hides buttons the user could have used.
 */
import { type TemplateResult } from "lit";
import { OpenAppsElement } from "./base.js";
export declare class OpenAppsLogin extends OpenAppsElement {
    private me;
    /** Methods the server has configured. Null until asked. */
    private enabled;
    /**
     * How long to wait for a browser signer to register before offering the
     * key fallback. Extensions inject at wildly different moments, so a
     * single check is not enough; two seconds covers the slow ones without
     * making a genuinely-absent signer feel broken.
     */
    signerTimeout: number;
    /**
     * `inline` (default) renders the provider buttons alone, which is what a
     * header or a toolbar wants. `panel` renders the full sign-in surface —
     * the SDK card with a mark, title and description — which is what a
     * dedicated sign-in route or a modal wants.
     *
     * One element rather than two, because the two differ only in framing:
     * the buttons, the fallbacks and every error path are identical, and
     * duplicating them is how the two drift apart.
     */
    variant: "inline" | "panel";
    /**
     * The panel's heading and supporting line.
     *
     * They default to naming OpenApps, which is right on OpenApps' own
     * pages and wrong everywhere else: this element is embedded inside
     * host products, each with its own name in its own window, and a
     * heading that announces the platform reads as a third party asking
     * for a password. A host that has its own framing sets these; one that
     * doesn't gets the defaults unchanged.
     *
     * `mark` is the glyph in the circle, for the same reason.
     */
    heading: string;
    description: string;
    mark: string;
    /** Wallets to choose between, once more than one has announced. */
    private wallets;
    /** Which Nostr fallback the user has opened, if any. */
    private nostrFallback;
    private nostrHint;
    /** A bunker asking the user to approve in a browser. */
    private authUrl;
    connectedCallback(): void;
    protected onSessionChange(): void;
    private load;
    /** See `<openapps-account>`'s own version: one wallet connects, several
     * are offered by name, because `window.ethereum` holds only whichever
     * injected last and cannot express a choice. */
    private beginWalletLogin;
    private loginWithWallet;
    private loginWithNostr;
    /** Sign through a remote signer (NIP-46). The key never comes here. */
    private loginWithBunker;
    /** Sign with a pasted `nsec1…`. The key stays in this browser. */
    private loginWithNsec;
    private loginWithGoogle;
    private logout;
    render(): TemplateResult;
    /**
     * Wrap the provider buttons in the SDK card, or hand them back bare.
     *
     * The panel deliberately carries no navigation of its own — no back link,
     * no footer. The host owns where the user goes next, which is what lets
     * the same surface sit in a modal, a settings pane and a route.
     */
    private frame;
    /**
     * The two ways to sign Nostr without a browser extension.
     *
     * A remote signer is offered first and by name, because it is strictly
     * better: the key stays in the signing app and only requests travel. The
     * raw key is behind a second click, where it belongs.
     */
    private renderNostrFallback;
    private renderBunkerForm;
    private renderNsecForm;
    private renderSignedIn;
    static styles: import("lit").CSSResult[];
}
/** Middle-truncate long identifiers (addresses, npubs) for display. */
export declare function shorten(value: string, head?: number, tail?: number): string;
/** Pick up `?ref=CODE` so a shared link attributes the signup. */
/**
 * The referral code to attribute this signup to.
 *
 * The name is historical: it used to read only this page's query string,
 * which silently lost every signup that finished somewhere other than the
 * page the link pointed at — a `/login` popup, most commonly. It now falls
 * back to a code captured earlier on this origin (see `referral-code.ts`).
 *
 * URL first, so arriving through a fresh link beats a stale stored one.
 */
export declare function referralFromUrl(): string | undefined;
declare global {
    interface HTMLElementTagNameMap {
        "openapps-login": OpenAppsLogin;
    }
}
//# sourceMappingURL=openapps-login.d.ts.map