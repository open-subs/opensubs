/**
 * `<openapps-account>` — one account, every way of reaching it.
 *
 * Shows the signed-in account and the identities attached to it, and lets
 * the user attach more. The interesting case is when the identity they
 * connect is already on a *different* account, because they signed in with
 * Google on their laptop and a wallet on their phone. That is not an error
 * to report; it is two halves of one person that need combining. The
 * server refuses the link with a `409` carrying the other account's
 * balance, this element asks, and on confirmation retries with `merge`.
 */
import { type TemplateResult } from "lit";
import { OpenAppsElement } from "./base.js";
export declare class OpenAppsAccount extends OpenAppsElement {
    private me;
    private enabled;
    private pending;
    private notice;
    /** Set when the two accounts share a sign-in method and cannot combine. */
    private blocked;
    /** Wallets to choose between, once more than one has announced itself.
     * Null while there is nothing to choose — one wallet connects straight
     * away rather than making the user confirm which of one. */
    private wallets;
    connectedCallback(): void;
    protected onSessionChange(): void;
    private load;
    private linked;
    /**
     * Namespaces the server supports that are not already connected.
     *
     * Not filtered by what this browser has detected: extensions inject at
     * unpredictable times, so a signer that was absent at first render may be
     * there by the time the user clicks. Missing signers are reported then.
     */
    private get connectable();
    /** Google links by redirect rather than by signing in the page. */
    private get canConnectGoogle();
    private connectGoogle;
    /** Read the outcome of a Google link redirect, if we just came back. */
    private handleLinkRedirect;
    /**
     * Start connecting a wallet.
     *
     * With two wallets installed, `window.ethereum` holds whichever
     * injected last — so connecting blind prompts a wallet the user may
     * not have meant, and dismissing that prompt looks like a failure of
     * this app. Asking EIP-6963 who is present turns that into a choice:
     * one wallet connects immediately, several are offered by name.
     */
    private beginEthereumConnect;
    private connect;
    private confirmMerge;
    private afterLink;
    private unlink;
    render(): TemplateResult;
    private renderMergePrompt;
    static styles: import("lit").CSSResult[];
}
declare global {
    interface HTMLElementTagNameMap {
        "openapps-account": OpenAppsAccount;
    }
}
//# sourceMappingURL=openapps-account.d.ts.map