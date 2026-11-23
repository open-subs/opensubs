var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var OpenAppsAccount_1;
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
import { adoptStyles, css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { OpenAppsError } from "@openapps/sdk";
import { day, label, LABELS, middle, num } from "./account-format.js";
import { OpenAppsElement } from "./base.js";
import { notify } from "./context.js";
import { t } from "./catalogue.js";
import { ONWALLET_SOON, OPENWALLET_HINT, openwalletStyles, openwalletWordmark, } from "./openwallet-mark.js";
import { connectEthereum, discoverEthereumWallets, nostrPublicKey, proofPublicKey, signNostr, signSiwe, } from "./wallet.js";
/** Linked by leaving the page for the provider, not by signing in it. */
const REDIRECT_PROVIDERS = ["apple", "google", "github", "openwallet"];
/** How long the server says combining would wait, if it says. */
function heldFor(error) {
    const secs = error.detail?.merge_held_for_secs;
    return typeof secs === "number" && secs > 0 ? secs : undefined;
}
function isRedirectProvider(namespace) {
    return REDIRECT_PROVIDERS.includes(namespace);
}
/** Remembers that the OnWallet prompt was dismissed, in this browser. */
const OW_PROMPT_KEY = "openapps.openwallet_prompt_dismissed";
/**
 * Whether the OnWallet extension has put its provider on this page.
 * `false` means "not here", which is not the same as "not installed".
 */
function openwalletDetected() {
    try {
        const ow = globalThis.openwallet;
        return !!ow && ow.isOpenWallet === true;
    }
    catch {
        return false;
    }
}
/** A phone or tablet, where there is no browser extension to install. */
function onPhone() {
    try {
        const nav = navigator;
        if (typeof nav.userAgentData?.mobile === "boolean")
            return nav.userAgentData.mobile;
        return /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent);
    }
    catch {
        return false;
    }
}
function promptDismissed() {
    try {
        return localStorage.getItem(OW_PROMPT_KEY) === "1";
    }
    catch {
        return false;
    }
}
let OpenAppsAccount = class OpenAppsAccount extends OpenAppsElement {
    constructor() {
        super(...arguments);
        this.me = null;
        this.enabled = null;
        this.pending = null;
        this.notice = null;
        /**
         * Where to sign in instead, when the server refused to connect OnWallet
         * from this sign-in (`sign_in_on_account_page`): its own Account page.
         */
        this.signInAt = null;
        /** Set when a link was refused and no consent would change that. */
        this.blocked = null;
        /** The same refusal in parts, when the server sent them. */
        this.refusal = null;
        /** Where OnWallet is installed from, if the server says. */
        this.installUrl = null;
        /** The OnWallet prompt was dismissed, now or on an earlier visit. */
        this.owDismissed = promptDismissed();
        /** What the balance is made of, when the server says. */
        this.credits = null;
        /** The account could not be read; there is nothing to show but that. */
        this.loadFailed = false;
        /** The Nostr key about to be linked, awaiting a yes. */
        this.nostrPreview = null;
        /** The OnWallet identity a member is about to disconnect. */
        this.confirmingUnlink = null;
        /** Wallets to choose between, once more than one has announced itself.
         * Null while there is nothing to choose — one wallet connects straight
         * away rather than making the user confirm which of one. */
        this.wallets = null;
        /** The on-demand part, once it has arrived. */
        this.extras = null;
        this.#loadingExtras = null;
        /** Whether the "delete this account" confirmation is showing. */
        this.confirmingDelete = false;
    }
    static { OpenAppsAccount_1 = this; }
    #loadingExtras;
    /**
     * Fetch the on-demand part (once) and adopt its styles.
     *
     * Asked for when the account being shown could need it — it holds an
     * OnWallet ID — and at the click or the refusal that does. Everyone
     * else never downloads it.
     */
    needExtras() {
        this.#loadingExtras ??= import("./account-extras.js").then((extras) => {
            const own = this.constructor.elementStyles;
            adoptStyles(this.renderRoot, [
                ...own,
                extras.extrasStyles,
            ]);
            this.extras = extras;
            return extras;
        });
        return this.#loadingExtras;
    }
    connectedCallback() {
        super.connectedCallback();
        // Deliberately does no work here. A plain HTML page has these elements
        // in the markup and calls configure() from a module script, so at
        // upgrade time there may be no client yet — touching one synchronously
        // throws out of the upgrade and the element never loads at all.
        void this.load();
    }
    onSessionChange() {
        void this.load();
    }
    async load() {
        // Yield first, so a host that configures its client right after the
        // elements upgrade has had its turn.
        await Promise.resolve();
        // A Google or GitHub link redirect lands back here with the outcome in the
        // fragment. Read it before anything else so the result is on screen as
        // soon as the account renders.
        await this.handleLinkRedirect();
        // What the redirect's outcome said, if it was a refusal. Every `run`
        // below starts by clearing `error`, which used to wipe it before it was
        // ever drawn: a link refused on the way back failed without a word.
        const fromRedirect = this.error;
        try {
            await this.loadAccount();
        }
        finally {
            if (fromRedirect && !this.error)
                this.error = fromRedirect;
        }
    }
    async loadAccount() {
        if (!this.enabled) {
            const info = await this.run(() => this.sdk.auth.serverInfo());
            this.enabled = info?.methods ?? null;
            this.installUrl = info?.openwallet_install_url ?? null;
        }
        if (!this.sdk.isLoggedIn) {
            this.me = null;
            this.credits = null;
            this.loadFailed = false;
            return;
        }
        const me = (await this.run(() => this.sdk.auth.me())) ?? null;
        this.loadFailed = !me && this.sdk.isLoggedIn;
        this.me = me;
        if (me?.pending_merges?.length)
            await this.needExtras().catch(() => undefined);
        const credits = me ? await this.loadCredits(me) : null;
        // Set before `credits`, whose change is what draws it.
        this.deleg = me && (await this.extras?.loadDelegation(this.sdk, me));
        this.credits = credits;
    }
    /**
     * What the balance is made of — asked only for an account that could
     * hold member credits, so a page for anyone else makes the requests it
     * always made. A failure here costs the breakdown, never the panel.
     */
    async loadCredits(me) {
        const couldHold = !!me.membership || me.linked_accounts.some((a) => a.namespace === "openwallet");
        if (!couldHold)
            return null;
        try {
            await this.needExtras();
            return await this.sdk.credits.breakdown();
        }
        catch {
            return null;
        }
    }
    linked(namespace) {
        return (this.me?.linked_accounts ?? []).some((a) => a.namespace === namespace);
    }
    /**
     * Namespaces the server supports that are not already connected.
     *
     * Not filtered by what this browser has detected: extensions inject at
     * unpredictable times, so a signer that was absent at first render may be
     * there by the time the user clicks. Missing signers are reported then.
     */
    get connectable() {
        return ["eip155", "nostr"].filter((ns) => this.enabled?.[ns] && !this.linked(ns));
    }
    /** Google and GitHub link by redirect rather than by signing in the page. */
    get redirectConnectable() {
        return REDIRECT_PROVIDERS.filter((p) => this.enabled?.[p] && !this.linked(p) && !(p === "openwallet" && ONWALLET_SOON));
    }
    /** OnWallet is offered by this server and not yet on the account. */
    get openwalletOffered() {
        return !ONWALLET_SOON && !!this.enabled?.openwallet && !this.linked("openwallet");
    }
    /** The prompt owns the OnWallet button until it is dismissed. */
    get showOpenwalletPrompt() {
        return this.openwalletOffered && !this.owDismissed;
    }
    /**
     * The account has no Nostr key and its OnWallet ID shares one: the case
     * "Use my OnWallet Nostr key" exists for.
     */
    get openwalletNostrOffered() {
        const keys = this.me?.nostr;
        if (!this.enabled?.nostr || !keys || keys.linked || !keys.openwallet_claim)
            return null;
        return keys.openwallet_claim;
    }
    dismissOpenwalletPrompt() {
        this.owDismissed = true;
        try {
            localStorage.setItem(OW_PROMPT_KEY, "1");
        }
        catch {
            // Private mode, or storage switched off: dismissed for this visit.
        }
    }
    clearMessages() {
        this.blocked = null;
        this.refusal = null;
        this.notice = null;
        this.signInAt = null;
    }
    async connectRedirect(provider) {
        await this.run(async () => {
            // Come back to this page, minus any fragment — the server puts the
            // outcome there and refuses a return_to that already has one.
            const here = `${location.origin}${location.pathname}${location.search}`;
            // Leaves by posting the server's form where it offers one: a link
            // started that way cannot be started by sending someone a URL.
            this.signInAt = null;
            try {
                await this.sdk.auth.redirectLink(provider, here);
            }
            catch (cause) {
                // A sign-in this page cannot connect OnWallet from: the server says
                // where to sign in instead, and the error says why.
                const url = cause instanceof OpenAppsError ? cause.detail?.sign_in_url : undefined;
                if (typeof url === "string" && url.startsWith("https://"))
                    this.signInAt = url;
                throw cause;
            }
        });
    }
    /**
     * Turn a refused link into what the panel shows. True when the error was
     * one of the two refusals no consent can lift; anything else is the
     * caller's to handle.
     */
    refused(error) {
        if (!(error instanceof OpenAppsError))
            return false;
        const detail = error.detail ?? {};
        if (detail.code === "merge_blocked_by_duplicate_namespace") {
            const blocking = Array.isArray(detail.blocking) ? detail.blocking : [];
            this.refusal = blocking.length ? { kind: "merge", blocking } : null;
            this.blocked = error.message;
            if (this.refusal)
                void this.needExtras();
            return true;
        }
        if (detail.code === "namespace_already_linked") {
            const namespace = typeof detail.namespace === "string" ? detail.namespace : "";
            this.refusal = namespace
                ? {
                    kind: "taken",
                    namespace,
                    name: typeof detail.name === "string" ? detail.name : label(namespace),
                    linked: detail.linked ?? null,
                    offered: detail.offered ?? null,
                }
                : null;
            this.blocked = error.message;
            if (this.refusal)
                void this.needExtras();
            return true;
        }
        return false;
    }
    /**
     * Complete a redirect link this session started. The server parks the
     * proven identity until this page — holding this session — confirms it,
     * so a link URL forwarded to someone else can never attach their identity
     * (or their whole account) to this one.
     */
    async confirmRedirectLink(namespace, code) {
        await this.run(async () => {
            try {
                this.afterLink(await this.sdk.auth.confirmLink(code));
            }
            catch (error) {
                if (!(error instanceof OpenAppsError))
                    throw error;
                if (error.detail?.code === "identity_belongs_to_another_account") {
                    if (!isRedirectProvider(namespace))
                        throw error;
                    this.pending = {
                        namespace,
                        other: error.detail.other_account,
                        code,
                        heldSecs: heldFor(error),
                    };
                    return;
                }
                if (this.refused(error))
                    return;
                throw await this.explained(error);
            }
        });
    }
    /** Read the outcome of a redirect link, if we just came back from one. */
    async handleLinkRedirect() {
        let outcome;
        try {
            outcome = this.sdk.auth.completeLinkRedirect();
        }
        catch {
            // No client configured yet. Leaving the fragment in place means the
            // next render picks it up rather than losing the result entirely.
            return;
        }
        if (!outcome)
            return;
        switch (outcome.status) {
            case "pending":
                await this.confirmRedirectLink(outcome.namespace, outcome.code);
                break;
            case "linked":
                this.notice = outcome.merged
                    ? t("Accounts combined — {credits} credits moved across.", {
                        credits: num(outcome.credits),
                    })
                    : t("{method} connected.", { method: label(outcome.namespace) });
                this.emit("openapps-identity-linked", outcome);
                notify();
                break;
            case "conflict":
                // Same question as the in-page flows ask, arriving by redirect.
                if (!isRedirectProvider(outcome.namespace))
                    break;
                this.pending = {
                    namespace: outcome.namespace,
                    other: { id: "", balance: outcome.balance },
                };
                break;
            case "blocked":
                this.blocked = outcome.message;
                break;
            case "error":
                this.error = outcome.message;
                break;
        }
    }
    /**
     * Start connecting a wallet.
     *
     * With two wallets installed, `window.ethereum` holds whichever
     * injected last — so connecting blind prompts a wallet the user may
     * not have meant, and dismissing that prompt looks like a failure of
     * this app. Asking EIP-6963 who is present turns that into a choice:
     * one wallet connects immediately, several are offered by name.
     */
    async beginEthereumConnect() {
        this.clearMessages();
        const wallets = await discoverEthereumWallets();
        if (wallets.length > 1) {
            this.wallets = wallets;
            return;
        }
        await this.connect("eip155", wallets[0]);
    }
    /**
     * First half of a Nostr link: ask the signer which key it holds and show
     * it. Nothing is signed and nothing is sent until the person says yes.
     */
    async previewNostr(purpose) {
        this.clearMessages();
        this.wallets = null;
        await this.run(async () => {
            const [key] = await Promise.all([nostrPublicKey(), this.needExtras()]);
            this.nostrPreview = {
                key,
                purpose,
                claim: this.me?.nostr?.openwallet_claim ?? null,
            };
        });
    }
    async linkPreviewedNostr() {
        const preview = this.nostrPreview;
        if (!preview)
            return;
        this.nostrPreview = null;
        await this.connect("nostr", undefined, preview.key);
    }
    /**
     * Sign a link challenge with the wallet or the Nostr signer.
     *
     * For Nostr, `key` is the one the person was shown. The signature must
     * come from it — checked here, and again by the server, which is told
     * what to expect — so a signer that answers with a different key between
     * the preview and the signature links nothing.
     */
    async sign(namespace, wallet, key, expectAddress) {
        // Sign the same challenge the login flow uses — linking differs only
        // in which endpoint verifies it.
        const address = namespace === "eip155" ? await connectEthereum(wallet?.provider) : undefined;
        if (expectAddress && address?.toLowerCase() !== expectAddress.toLowerCase()) {
            throw new Error((await this.needExtras()).DIFFERENT_WALLET());
        }
        const challenge = await this.sdk.auth.linkChallenge(namespace, address);
        const proof = namespace === "eip155"
            ? await signSiwe(challenge.message, address, wallet?.provider)
            : await signNostr(challenge.message);
        if (key && proofPublicKey(proof) !== key.hex) {
            throw new Error((await this.needExtras()).DIFFERENT_KEY());
        }
        return { challenge, proof, address, expect: key ? `nostr:${key.npub}` : undefined };
    }
    async connect(namespace, wallet, key) {
        this.clearMessages();
        this.wallets = null;
        await this.run(async () => {
            const { challenge, proof, address, expect } = await this.sign(namespace, wallet, key);
            try {
                const result = await this.sdk.auth.linkVerify(challenge.challenge_id, proof, { expect });
                this.afterLink(result);
            }
            catch (error) {
                // Nothing to consent to — combining is impossible until the user
                // detaches the duplicate. Say which one.
                if (this.refused(error))
                    return;
                if (error instanceof OpenAppsError &&
                    error.detail?.code === "identity_belongs_to_another_account") {
                    // Do not merge behind the user's back. Park it and ask.
                    this.pending = {
                        namespace,
                        other: error.detail.other_account,
                        key,
                        wallet,
                        address,
                        heldSecs: heldFor(error),
                    };
                    return;
                }
                throw await this.explained(error);
            }
        });
    }
    async confirmMerge() {
        const pending = this.pending;
        if (!pending)
            return;
        if (isRedirectProvider(pending.namespace)) {
            this.pending = null;
            if (pending.code) {
                // Consent, given here, for the identity already proven.
                const code = pending.code;
                await this.run(async () => {
                    try {
                        this.afterLink(await this.sdk.auth.confirmLink(code, { merge: true }));
                    }
                    catch (error) {
                        if (this.refused(error))
                            return;
                        throw await this.explained(error);
                    }
                });
            }
            else {
                // An older server reported the conflict in the fragment and kept no
                // proof; going through the provider again is the only way.
                await this.connectRedirect(pending.namespace);
            }
            return;
        }
        const namespace = pending.namespace;
        // The challenge was consumed by the refused attempt, so a fresh one is
        // needed — challenges are single-use by design.
        await this.run(async () => {
            const { challenge, proof, expect } = await this.sign(namespace, pending.wallet, pending.key, pending.address);
            try {
                const result = await this.sdk.auth.linkVerify(challenge.challenge_id, proof, {
                    merge: true,
                    expect,
                });
                this.pending = null;
                this.afterLink(result);
            }
            catch (error) {
                if (this.refused(error)) {
                    this.pending = null;
                    return;
                }
                throw await this.explained(error);
            }
        });
    }
    afterLink(result) {
        this.notice = result.merge_pending
            ? (this.extras?.mergeHeld(result.pending_merge?.effective_at ?? 0) ?? null)
            : result.merged
                ? t("Accounts combined — {credits} credits moved across.", {
                    credits: num(result.credits_transferred ?? 0),
                })
                : t("Connected.");
        this.emit("openapps-identity-linked", result);
        notify();
        void this.load();
    }
    /** A refusal reworded for the person, where this element knows how. */
    async explained(error) {
        if (!(error instanceof OpenAppsError))
            return error;
        return (await this.needExtras()).explained(error);
    }
    /**
     * Disconnect a sign-in method — after a question, when it is the
     * OnWallet ID a membership rests on, because that costs something.
     */
    requestUnlink(account) {
        this.clearMessages();
        if (account.namespace === "openwallet" && this.me?.membership?.identity === account.caip10) {
            this.confirmingUnlink = account;
            void this.needExtras();
            return;
        }
        void this.unlink(account.caip10);
    }
    async unlink(caip10) {
        this.confirmingUnlink = null;
        await this.run(async () => {
            try {
                await this.sdk.auth.unlink(caip10);
            }
            catch (error) {
                throw await this.explained(error);
            }
            this.notice = t("Disconnected.");
            this.emit("openapps-identity-unlinked", { caip10 });
            notify();
            await this.load();
        });
    }
    /** Call off a merge that is waiting. Either account may. */
    async cancelMerge(id) {
        await this.run(async () => {
            await this.sdk.auth.cancelMerge(id);
            this.notice = (await this.needExtras()).MERGE_CANCELLED();
            await this.load();
        });
    }
    async deleteAccount() {
        await this.run(async () => {
            try {
                await this.sdk.auth.deleteAccount();
            }
            catch (error) {
                throw await this.explained(error);
            }
            this.confirmingDelete = false;
            this.me = null;
            this.credits = null;
            this.emit("openapps-account-deleted", null);
            notify();
        });
    }
    /// At the foot, quiet, and two steps: nobody opens an account screen to
    /// delete it by accident, and the step in between is where what is lost
    /// gets said — the balance by number, because "your credits" is easy to
    /// agree to without thinking about how many. And what is *not* deleted:
    /// an OnWallet ID lives in the person's extension, not here.
    renderDelete() {
        if (!this.confirmingDelete) {
            return html `<button class="link danger-link" ?disabled=${this.busy}
        @click=${() => (this.confirmingDelete = true)}>${t("Delete account…")}</button>`;
        }
        const balance = this.me?.balance ?? 0;
        return html `
      <div class="oa-callout oa-callout--danger confirm-delete" role="alertdialog"
        aria-label=${t("Delete account")}>
        <p><strong>${t("Delete this account?")}</strong> ${t("This cannot be undone.")}</p>
        <p class="muted small">
          ${balance > 0
            ? html `${t("Your sign-in methods are removed from it, and your")}
                <strong>${t("{credits} credits", { credits: num(balance) })}</strong>
                ${t("are lost.")}`
            : t("Your sign-in methods are removed from it.")}
          ${t("Signing in again later starts a new, empty account. It is the same account in every one of our apps, so it is deleted from all of them.")}
        </p>
        ${this.linked("openwallet")
            ? html `<p class="muted small oa-keeps">
              ${t("Your OnWallet ID is not deleted. It lives in your OnWallet extension, not in this account, and it keeps working there.")}
            </p>`
            : nothing}
        <div class="row">
          <button ?disabled=${this.busy} @click=${() => (this.confirmingDelete = false)}>
            ${t("Cancel")}
          </button>
          <button class="danger" ?disabled=${this.busy} @click=${this.deleteAccount}>
            ${t("Delete my account")}
          </button>
        </div>
      </div>
    `;
    }
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
    renderOpenwalletPrompt() {
        const detected = openwalletDetected();
        const phone = !detected && onPhone();
        return html `
      <div class="oa-section ow-prompt" role="group" aria-label="OnWallet">
        <h3>${openwalletWordmark}</h3>
        ${phone
            ? html `<p class="small">
              ${t("OnWallet is a browser extension for a computer. To connect your OnWallet ID, open this page there.")}
            </p>`
            : html `<p class="small">
                ${detected
                ? t("OnWallet is in this browser.")
                : t("OnWallet is a browser extension.")}
                ${t("Connect your OnWallet ID to sign in with it here. It joins the sign-in methods above, on this one account.")}
              </p>
              <div class="row">
                <button
                  ?disabled=${this.busy}
                  aria-describedby="ow-hint"
                  @click=${() => this.connectRedirect("openwallet")}
                >
                  ${t("Connect")} ${openwalletWordmark}
                </button>
                ${!detected && this.installUrl
                ? html `<a
                      class="get"
                      href=${this.installUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      >${t("Get OnWallet")}</a
                    >`
                : nothing}
              </div>
              <p class="ow-hint" id="ow-hint">${t(OPENWALLET_HINT)}</p>
              ${this.renderConnectTag()}
              <p class="muted small">
                ${t("You choose in the extension what it shares. Once connected, this account can be opened with it or with any method above.")}
              </p>`}
        <button class="link" @click=${this.dismissOpenwalletPrompt}>${t("Not now")}</button>
      </div>
    `;
    }
    /**
     * The code OnWallet shows when this account connects an OnWallet ID,
     * beside every button that starts one. A connect is approved in the
     * wallet, and the wallet says which account it is for by these six
     * characters; this is where the person reads the other half. Drawn only
     * where the server gives a well-formed code, and only as text.
     */
    renderConnectTag() {
        const tag = this.me?.openwallet_connect_tag;
        if (typeof tag !== "string" || !/^[0-9A-HJKMNP-TV-Z]{6}$/.test(tag))
            return nothing;
        // prettier-ignore
        return html `<p class="small oa-tag">${t("Connect in OnWallet only if it shows this tag:")}<code>${tag}</code></p>`;
    }
    /** What the account knows about its Genesis membership. */
    renderMembership() {
        const membership = this.me?.membership;
        if (!membership)
            return nothing;
        const several = (this.me?.linked_accounts.length ?? 0) > 1;
        let status;
        if (membership.needs_confirmation) {
            status = html `${t("Confirm in OnWallet to keep your member benefits.")}
        <button class="link" ?disabled=${this.busy} @click=${() => this.connectRedirect("openwallet")}>
          ${t("Confirm")}
        </button>
        ${this.renderConnectTag()}`;
        }
        else if (!membership.benefits_active) {
            status = html `${t("Member benefits start on {date}. This OnWallet ID was on another account before.", { date: day(membership.benefits_from) })}`;
        }
        else {
            status = html `${t("Member benefits are on for this account, however you sign in.")}`;
        }
        return html `
      <div class="oa-section member">
        <span class="tag oa-tag--strong">${t("Genesis member")}</span>
        <p class="small">${status}</p>
        ${several
            ? html `<p class="muted small">
              ${t("Each sign-in method above opens this account. Disconnect any you do not use.")}
            </p>`
            : nothing}
      </div>
    `;
    }
    /**
     * Two Nostr keys in view: the account's own, and the one the OnWallet
     * ID shares. Apps use the first. Saying so matters because data kept
     * under a Nostr key is found only under that key.
     */
    renderNostrKeys() {
        const keys = this.me?.nostr;
        if (!keys?.differs || !keys.linked || !keys.openwallet_claim)
            return nothing;
        return html `
      <div class="oa-section nostr-keys">
        <h3>${t("Two Nostr keys")}</h3>
        <ul class="identities">
          <li>
            <span class="tag oa-tag--strong">${t("In use")}</span>
            <code title=${keys.linked}>${middle(keys.linked)}</code>
            <span class="muted small">${t("this account")}</span>
          </li>
          <li>
            <span class="tag">${t("Not used")}</span>
            <code title=${keys.openwallet_claim}>${middle(keys.openwallet_claim)}</code>
            <span class="muted small">${t("your OnWallet ID")}</span>
          </li>
        </ul>
        <p class="muted small">
          ${t("Apps use the first key. Connecting OnWallet did not change it, and data kept under it stays there.")}
        </p>
        <p class="muted small">
          ${t("The account’s key is not swapped for the other one: data apps keep under a Nostr key can be read only with that key. To use one key everywhere, import the first into OnWallet and choose it for websites.")}
        </p>
      </div>
    `;
    }
    render() {
        // No client configured yet; configure() will notify and re-render.
        if (!this.sdkOrNull)
            return html `<p class="muted">${t("Loading…")}</p>`;
        if (!this.sdk.isLoggedIn) {
            return html `<p class="muted">${t("Sign in to manage your account.")}</p>`;
        }
        if (!this.me) {
            // Not "Loading…" for ever: when the account could not be read, say so
            // and offer the one thing that can help.
            if (this.loadFailed && !this.busy) {
                return html `<div class="oa-card card oa-failed">
          <p class="error" role="alert">
            ${this.error ?? t("Your account could not be loaded.")}
          </p>
          <div class="row">
            <button @click=${() => this.load()}>${t("Try again")}</button>
          </div>
        </div>`;
            }
            return html `<p class="muted">${t("Loading…")}</p>`;
        }
        if (this.pending) {
            if (this.pending.heldSecs && !this.extras)
                void this.needExtras();
            return this.renderMergePrompt(this.pending);
        }
        const extras = this.extras;
        if (extras && this.nostrPreview) {
            return extras.renderNostrPreview(this.nostrPreview, this.busy, this.error, {
                link: () => void this.linkPreviewedNostr(),
                retry: () => void this.previewNostr("openwallet"),
                cancel: () => (this.nostrPreview = null),
            });
        }
        if (extras && this.confirmingUnlink) {
            const account = this.confirmingUnlink;
            return extras.renderUnlinkConfirm(account, this.credits?.granted ?? 0, this.busy, {
                confirm: () => void this.unlink(account.caip10),
                cancel: () => (this.confirmingUnlink = null),
            });
        }
        const identities = this.me.linked_accounts;
        // While its prompt is showing, OnWallet is offered there and not a
        // second time in the row below.
        const redirects = this.redirectConnectable.filter((p) => p !== "openwallet" || !this.showOpenwalletPrompt);
        // While "Use my OnWallet Nostr key" is offered, that is the Nostr
        // button; the plain one stays under "Add another" for a different key.
        return html `
      <div class="oa-card card">
        <div class="head">
          <div>
            <div class="muted small">${t("Account")}</div>
            <code class="id">${this.me.id}</code>
          </div>
          <div class="right">
            <div class="balance">${num(this.me.balance)}</div>
            <div class="muted small">${t("credits")}</div>
          </div>
        </div>

        ${extras && this.me.pending_merges?.length
            ? extras.renderPendingMerges(this.me.pending_merges, this.busy, (id) => void this.cancelMerge(id))
            : nothing}
        ${extras && this.refusal
            ? extras.renderRefusal(this.refusal)
            : this.blocked
                ? html `<p class="oa-callout oa-callout--warning warn" role="alert">${this.blocked}</p>`
                : nothing}
        ${extras
            ? extras.renderCredits(this.me, this.credits, () => void this.connectRedirect("openwallet"))
            : nothing}
        ${extras?.renderDelegation(this)}

        <h3>${t("Sign-in methods")}</h3>
        <ul class="identities">
          ${identities.map((account) => html `
              <li>
                <span class="tag">${label(account.namespace)}</span>
                <code title=${account.caip10}
                  >${middle(account.label ?? account.caip10)}</code
                >
                ${identities.length > 1
            ? html `<button
                      class="link"
                      ?disabled=${this.busy}
                      @click=${() => this.requestUnlink(account)}
                    >
                      ${t("Disconnect")}
                    </button>`
            : html `<span class="muted small">${t("only method")}</span>`}
              </li>
            `)}
        </ul>

        ${this.renderMembership()} ${this.renderNostrKeys()}
        ${extras && this.openwalletNostrOffered
            ? extras.renderOpenwalletNostrOffer(this.openwalletNostrOffered, this.busy, () => void this.previewNostr("openwallet"))
            : nothing}
        ${this.showOpenwalletPrompt ? this.renderOpenwalletPrompt() : nothing}
        ${this.connectable.length || redirects.length
            ? html `
              <h3>${t("Add another")}</h3>
              <div class="row">
                ${redirects.map((provider) => html `<button
                    ?disabled=${this.busy}
                    aria-describedby=${provider === "openwallet" ? "ow-hint" : nothing}
                    @click=${() => this.connectRedirect(provider)}
                  >
                    ${t("Connect")} ${provider === "openwallet" ? openwalletWordmark : LABELS[provider]}
                  </button>`)}
                ${this.connectable.map((ns) => 
            // With several wallets installed, the one button becomes
            // one button per wallet — reusing this same shape rather
            // than opening a chooser, so the choice appears where the
            // click already was.
            ns === "eip155" && this.wallets
                ? this.wallets.map((w) => html `
                          <button ?disabled=${this.busy} @click=${() => this.connect(ns, w)}>
                            ${t("Connect")} ${w.name}
                          </button>
                        `)
                : html `
                        <button
                          ?disabled=${this.busy}
                          @click=${() => ns === "eip155"
                    ? this.beginEthereumConnect()
                    : this.previewNostr("connect")}
                        >
                          ${t("Connect")} ${label(ns)}
                        </button>
                      `)}
              </div>
              ${redirects.includes("openwallet")
                ? html `<p class="ow-hint" id="ow-hint">${t(OPENWALLET_HINT)}</p>
                    ${this.renderConnectTag()}`
                : nothing}
              <p class="muted small">
                ${t("Connecting a method that is already on another account will offer to combine them, so you keep one balance and one history.")}
              </p>
            `
            : this.showOpenwalletPrompt
                ? nothing
                : html `<p class="muted small">${t("Every available method is connected.")}</p>`}

        ${this.notice ? html `<p class="notice" role="status">${this.notice}</p>` : nothing}
        ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
        ${this.signInAt
            ? html `<p><a href=${this.signInAt} target="_blank" rel="noopener"
              >${t("Sign in on the Account page")}</a></p>`
            : nothing}

        <div class="oa-section delete">${this.renderDelete()}</div>
      </div>

    `;
    }
    renderMergePrompt(pending) {
        return html `
      <div class="oa-card card">
        <h3>${t("Combine two accounts?")}</h3>
        <p>
          ${t("That {method} identity already belongs to another account holding", {
            method: label(pending.namespace),
        })}
          <strong>${t("{credits} credits", { credits: num(pending.other.balance) })}</strong>.
        </p>
        <p class="muted small">
          ${t("Combining moves its credits, payment history and referral earnings onto this account, and signs it out everywhere. It cannot be undone.")}
        </p>
        ${pending.heldSecs && this.extras
            ? html `<p class="small oa-held">${this.extras.mergeWillWait(pending.heldSecs)}</p>`
            : nothing}
        <div class="row">
          <button class="primary" ?disabled=${this.busy} @click=${this.confirmMerge}>
            ${t("Combine them")}
          </button>
          <button ?disabled=${this.busy} @click=${() => (this.pending = null)}>
            ${t("Cancel")}
          </button>
        </div>
        ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
      </div>
    `;
    }
    /*
     * An embedded surface: it reads the host's tokens (layer 3 only) and
     * resets nothing outside its own shadow root. Every value is a token with
     * the system's own value as its fallback, so the panel is the same panel
     * in a page that linked `tokens.css` and in one that linked nothing.
     * Classes written for this panel are `oa-` prefixed; the unprefixed ones
     * are older hooks that shipped pages and tests still name.
     */
    static { this.styles = [
        OpenAppsElement.baseStyles,
        openwalletStyles,
        css `
      .oa-card {
        box-sizing: border-box;
        width: 100%;
        max-width: var(--sdk-wide, 560px);
        border: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        padding: var(--space-4, 16px);
        background: var(--surface-card, var(--fb-card));
      }
      .head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: var(--space-4, 16px);
        padding: 0 0 var(--space-3, 12px);
        border-bottom: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
      }
      .head > div:first-child {
        min-width: 0;
      }
      .head > :first-child {
        min-width: 0;
      }
      .right {
        text-align: right;
        /* The balance keeps its own width: the account id beside it gives way
           instead. A host that lets long words break anywhere (a dialog does,
           for file names) otherwise broke 4,000 into "4,00" over "0". */
        flex: none;
      }
      .balance {
        font: var(--weight-medium, 500) var(--text-xl, 24px) / 1.2
          var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        color: var(--text-strong, var(--fb-strong));
      }
      .id {
        font: var(--type-mono, 400 13px/1.5 ui-monospace, monospace);
        font-size: var(--text-xs, 12px);
        overflow-wrap: anywhere;
      }
      h3 {
        font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
        color: var(--text-strong, var(--fb-strong));
        margin: var(--space-4, 16px) 0 var(--space-2, 8px);
      }
      p {
        margin: var(--space-2, 8px) 0;
      }
      code {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-size: var(--text-sm, 13px);
        color: var(--text-strong, var(--fb-strong));
      }
      .oa-tag code{display:block;font-size:1.3rem;letter-spacing:.2em}
      .identities {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: var(--space-2, 8px);
      }
      .identities li {
        display: flex;
        align-items: center;
        gap: var(--space-2, 8px);
        min-width: 0;
      }
      .identities code {
        flex: 1;
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .identities li > :last-child {
        flex: none;
      }
      .tag {
        flex: none;
        font: var(--type-eyebrow, 500 12px/1.2 "Geist", system-ui, sans-serif);
        font-size: var(--text-2xs, 11px);
        text-transform: uppercase;
        letter-spacing: var(--tracking-caps, 0.08em);
        color: var(--text-muted, var(--fb-muted));
        border: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-full, 999px);
        padding: var(--space-1, 4px) var(--space-2, 8px);
      }
      /* "On" is black, not green: green means an action. */
      .oa-tag--strong {
        color: var(--text-strong, var(--fb-strong));
        border-color: var(--border-strong, var(--fb-strong));
      }
      button.link {
        border: none;
        background: none;
        min-height: 0;
        color: var(--text-muted, var(--fb-muted));
        text-decoration: underline;
        text-underline-offset: 3px;
        padding: 0;
        font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
      }
      button.link:hover:not([disabled]) {
        background: none;
        color: var(--text-strong, var(--fb-strong));
      }
      /* A text button is still a touch target. */
      @media (pointer: coarse) {
        button.link {
          min-height: var(--touch-min, 44px);
        }
      }
      .row {
        display: flex;
        gap: var(--space-2, 8px);
        flex-wrap: wrap;
        align-items: center;
      }
      .small {
        font-size: var(--text-sm, 13px);
      }
      /* Set apart by a hairline, like everything else on the card: the
         accent stays in the wordmark's full stop and nowhere else. */
      .oa-section {
        margin-top: var(--space-4, 16px);
        padding-top: var(--space-3, 12px);
        border-top: var(--border-width, 1px) solid var(--border-hairline, var(--fb-hairline));
      }
      .oa-section > h3:first-child {
        margin-top: 0;
      }
      /* The head already ends in a rule; a section straight after it does
         not draw a second one a few pixels below. */
      .head + .oa-section {
        border-top: none;
        padding-top: 0;
      }
      .oa-section > .row {
        margin: var(--space-3, 12px) 0 var(--space-2, 8px);
      }
      a.get {
        font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
        color: var(--text-muted, var(--fb-muted));
        text-decoration: underline;
        text-underline-offset: 3px;
      }

      /* ---- callouts ----
         Semantic tokens rather than a hardcoded pair with its own media
         query: that combination ignored the host entirely, so a page
         forcing dark kept a bright yellow warning. */
      .oa-callout {
        margin: var(--space-3, 12px) 0;
        padding: var(--space-3, 12px);
        border-radius: var(--radius-md, 8px);
        font-size: var(--text-sm, 13px);
      }
      .oa-callout > :first-child {
        margin-top: 0;
      }
      .oa-callout > :last-child {
        margin-bottom: 0;
      }
      .oa-callout--warning {
        background: var(--warning-bg, var(--fb-warning-bg));
        color: var(--warning-fg, var(--fb-warning-fg));
      }
      .oa-callout--danger {
        background: var(--danger-bg, var(--fb-danger-bg));
        color: var(--text-body, var(--fb-body));
      }
      .oa-callout code,
      .oa-callout strong {
        color: inherit;
      }
      .oa-card > h3:first-child {
        margin-top: 0;
      }
      .row + .ow-hint {
        margin-top: var(--space-2, 8px);
      }
      .notice {
        font-size: var(--text-sm, 13px);
        margin-top: var(--space-3, 12px);
        color: var(--text-strong, var(--fb-strong));
      }
      .error {
        font-size: var(--text-sm, 13px);
      }

      /* Deleting sits apart from everything else on the card, so it is not
         read as one more sign-in option. The same danger tokens the base
         styles use for errors, so a host's theme carries through. */
      button.danger-link {
        color: var(--danger-fg, var(--fb-danger));
      }
      button.danger-link:hover:not([disabled]) {
        color: var(--danger-fg, var(--fb-danger));
      }
      .confirm-delete {
        margin: 0;
      }
      button.danger {
        background: var(--danger-fg, var(--fb-danger));
        border-color: var(--danger-fg, var(--fb-danger));
        color: var(--surface-card, var(--fb-card));
      }
      button.danger:hover:not([disabled]) {
        background: var(--danger-fg, var(--fb-danger));
        opacity: 0.9;
      }

      /* Fallbacks for the callout grounds, which the base palette lacks. */
      :host {
        --fb-warning-bg: #fef3c7;
        --fb-warning-fg: #7a4a00;
        --fb-danger-bg: #fdecea;
      }
      @media (prefers-color-scheme: dark) {
        :host {
          --fb-warning-bg: #3a2c05;
          --fb-warning-fg: #f5d58a;
          --fb-danger-bg: #3a1614;
        }
      }
    `,
    ]; }
};
__decorate([
    state()
], OpenAppsAccount.prototype, "me", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "enabled", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "pending", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "notice", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "signInAt", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "blocked", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "refusal", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "installUrl", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "owDismissed", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "credits", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "loadFailed", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "nostrPreview", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "confirmingUnlink", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "wallets", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "extras", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "confirmingDelete", void 0);
OpenAppsAccount = OpenAppsAccount_1 = __decorate([
    customElement("openapps-account")
], OpenAppsAccount);
export { OpenAppsAccount };
//# sourceMappingURL=openapps-account.js.map