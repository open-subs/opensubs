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
 *
 * It is also where someone who signed in with something else is shown how
 * to connect their OnWallet ID, and where a Genesis member sees that the
 * account knows it. These facts shape that part:
 *
 * - **Not finding the extension is not proof it is missing.** OnWallet
 *   puts `window.openwallet` only on sites the person has connected (or on
 *   every site, if they turned that on). So "Connect" is offered either way,
 *   and "Get OnWallet" sits beside it rather than replacing it.
 * - **The install link is the server's.** It comes from
 *   `auth.serverInfo()`; with none configured there is no link, and this
 *   file never contains one.
 * - **The npub an OnWallet ID shares is not the account's Nostr key.**
 *   When the two differ, both are shown and the one in use is named. An
 *   account with no Nostr key can take the OnWallet one, but only by
 *   signing with it — the shared npub alone links nothing.
 * - **The key that signs is shown before any Nostr link.** With two Nostr
 *   extensions installed the one that answers is not always the one meant,
 *   and a Nostr key is never replaced afterwards.
 * - **Nothing new is drawn for a server that has not turned it on.** Member
 *   credits appear only when the balance answer says what it is made of;
 *   membership only when `/v1/me` carries one; OnWallet only when the
 *   server offers it.
 *
 * Every sentence goes through `t()` (see `catalogue.ts`): English is the key,
 * and this package ships no other catalogue.
 */
import { type TemplateResult } from "lit";
import { OpenAppsElement } from "./base.js";
export declare class OpenAppsAccount extends OpenAppsElement {
    #private;
    private me;
    private enabled;
    private pending;
    private notice;
    /**
     * Where to sign in instead, when the server refused to connect OnWallet
     * from this sign-in (`sign_in_on_account_page`): its own Account page.
     */
    private signInAt;
    /** Set when a link was refused and no consent would change that. */
    private blocked;
    /** The same refusal in parts, when the server sent them. */
    private refusal;
    /** Where OnWallet is installed from, if the server says. */
    private installUrl;
    /** The OnWallet prompt was dismissed, now or on an earlier visit. */
    private owDismissed;
    /** What the balance is made of, when the server says. */
    private credits;
    /**
     * What agents may spend: kept and drawn by `account-extras.ts`, which
     * asks for the re-render when it changes it.
     */
    deleg: unknown;
    /** The account could not be read; there is nothing to show but that. */
    private loadFailed;
    /** The Nostr key about to be linked, awaiting a yes. */
    private nostrPreview;
    /** The OnWallet identity a member is about to disconnect. */
    private confirmingUnlink;
    /** Wallets to choose between, once more than one has announced itself.
     * Null while there is nothing to choose — one wallet connects straight
     * away rather than making the user confirm which of one. */
    private wallets;
    /** The on-demand part, once it has arrived. */
    private extras;
    /**
     * Fetch the on-demand part (once) and adopt its styles.
     *
     * Asked for when the account being shown could need it — it holds an
     * OnWallet ID — and at the click or the refusal that does. Everyone
     * else never downloads it.
     */
    private needExtras;
    connectedCallback(): void;
    protected onSessionChange(): void;
    private load;
    private loadAccount;
    /**
     * What the balance is made of — asked only for an account that could
     * hold member credits, so a page for anyone else makes the requests it
     * always made. A failure here costs the breakdown, never the panel.
     */
    private loadCredits;
    private linked;
    /**
     * Namespaces the server supports that are not already connected.
     *
     * Not filtered by what this browser has detected: extensions inject at
     * unpredictable times, so a signer that was absent at first render may be
     * there by the time the user clicks. Missing signers are reported then.
     */
    private get connectable();
    /** Google and GitHub link by redirect rather than by signing in the page. */
    private get redirectConnectable();
    /** OnWallet is offered by this server and not yet on the account. */
    private get openwalletOffered();
    /** The prompt owns the OnWallet button until it is dismissed. */
    private get showOpenwalletPrompt();
    /**
     * The account has no Nostr key and its OnWallet ID shares one: the case
     * "Use my OnWallet Nostr key" exists for.
     */
    private get openwalletNostrOffered();
    private dismissOpenwalletPrompt;
    private clearMessages;
    private connectRedirect;
    /**
     * Turn a refused link into what the panel shows. True when the error was
     * one of the two refusals no consent can lift; anything else is the
     * caller's to handle.
     */
    private refused;
    /**
     * Complete a redirect link this session started. The server parks the
     * proven identity until this page — holding this session — confirms it,
     * so a link URL forwarded to someone else can never attach their identity
     * (or their whole account) to this one.
     */
    private confirmRedirectLink;
    /** Read the outcome of a redirect link, if we just came back from one. */
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
    /**
     * First half of a Nostr link: ask the signer which key it holds and show
     * it. Nothing is signed and nothing is sent until the person says yes.
     */
    private previewNostr;
    private linkPreviewedNostr;
    /**
     * Sign a link challenge with the wallet or the Nostr signer.
     *
     * For Nostr, `key` is the one the person was shown. The signature must
     * come from it — checked here, and again by the server, which is told
     * what to expect — so a signer that answers with a different key between
     * the preview and the signature links nothing.
     */
    private sign;
    private connect;
    private confirmMerge;
    private afterLink;
    /** A refusal reworded for the person, where this element knows how. */
    private explained;
    /**
     * Disconnect a sign-in method — after a question, when it is the
     * OnWallet ID a membership rests on, because that costs something.
     */
    private requestUnlink;
    private unlink;
    /** Call off a merge that is waiting. Either account may. */
    private cancelMerge;
    /** Whether the "delete this account" confirmation is showing. */
    private confirmingDelete;
    private deleteAccount;
    private renderDelete;
    /**
     * For someone signed in with something else: what OnWallet is here, and
     * the way to connect it. Shown until dismissed; after that OnWallet is
     * one more button under "Add another".
     *
     * Three readers. Someone whose browser shows the extension: connect.
     * Someone whose browser does not — which is not proof it is missing —
     * gets both ways forward, connect and install. Someone on a phone, where
     * there is no extension at all, is told where it does run.
     */
    private renderOpenwalletPrompt;
    /**
     * The code OnWallet shows when this account connects an OnWallet ID,
     * beside every button that starts one. A connect is approved in the
     * wallet, and the wallet says which account it is for by these six
     * characters; this is where the person reads the other half. Drawn only
     * where the server gives a well-formed code, and only as text.
     */
    private renderConnectTag;
    /** What the account knows about its Genesis membership. */
    private renderMembership;
    /**
     * Two Nostr keys in view: the account's own, and the one the OnWallet
     * ID shares. Apps use the first. Saying so matters because data kept
     * under a Nostr key is found only under that key.
     */
    private renderNostrKeys;
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