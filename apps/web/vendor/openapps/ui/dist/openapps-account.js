var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
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
import { css, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { OpenAppsError } from "@openapps/sdk";
import { OpenAppsElement } from "./base.js";
import { notify } from "./context.js";
import { connectEthereum, discoverEthereumWallets, signNostr, signSiwe, } from "./wallet.js";
const LABELS = {
    google: "Google",
    eip155: "Wallet",
    nostr: "Nostr",
};
let OpenAppsAccount = class OpenAppsAccount extends OpenAppsElement {
    constructor() {
        super(...arguments);
        this.me = null;
        this.enabled = null;
        this.pending = null;
        this.notice = null;
        /** Set when the two accounts share a sign-in method and cannot combine. */
        this.blocked = null;
        /** Wallets to choose between, once more than one has announced itself.
         * Null while there is nothing to choose — one wallet connects straight
         * away rather than making the user confirm which of one. */
        this.wallets = null;
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
        // A Google link redirect lands back here with the outcome in the
        // fragment. Read it before anything else so the result is on screen as
        // soon as the account renders.
        this.handleLinkRedirect();
        if (!this.enabled) {
            this.enabled = (await this.run(() => this.sdk.auth.methods())) ?? null;
        }
        if (!this.sdk.isLoggedIn) {
            this.me = null;
            return;
        }
        this.me = (await this.run(() => this.sdk.auth.me())) ?? null;
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
    /** Google links by redirect rather than by signing in the page. */
    get canConnectGoogle() {
        return (this.enabled?.google ?? false) && !this.linked("google");
    }
    async connectGoogle(merge = false) {
        await this.run(async () => {
            // Come back to this page, minus any fragment — the server puts the
            // outcome there and refuses a return_to that already has one.
            const here = `${location.origin}${location.pathname}${location.search}`;
            const authUrl = await this.sdk.auth.googleLinkStart(here, { merge });
            window.location.href = authUrl;
        });
    }
    /** Read the outcome of a Google link redirect, if we just came back. */
    handleLinkRedirect() {
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
            case "linked":
                this.notice = outcome.merged
                    ? `Accounts combined — ${outcome.credits.toLocaleString()} credits moved across.`
                    : "Google connected.";
                this.emit("openapps-identity-linked", outcome);
                notify();
                break;
            case "conflict":
                // Same question as the in-page flows ask, arriving by redirect.
                this.pending = {
                    namespace: "google",
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
        this.blocked = null;
        const wallets = await discoverEthereumWallets();
        if (wallets.length > 1) {
            this.wallets = wallets;
            return;
        }
        await this.connect("eip155", wallets[0]);
    }
    async connect(namespace, wallet) {
        this.blocked = null;
        this.wallets = null;
        await this.run(async () => {
            // Sign the same challenge the login flow uses — linking differs only
            // in which endpoint verifies it.
            const address = namespace === "eip155" ? await connectEthereum(wallet?.provider) : undefined;
            const challenge = await this.sdk.auth.linkChallenge(namespace, address);
            const proof = namespace === "eip155"
                ? await signSiwe(challenge.message, address, wallet?.provider)
                : await signNostr(challenge.message);
            try {
                const result = await this.sdk.auth.linkVerify(challenge.challenge_id, proof);
                this.afterLink(result);
            }
            catch (error) {
                if (error instanceof OpenAppsError &&
                    (error.detail?.code === "merge_blocked_by_duplicate_namespace" ||
                        error.detail?.code === "namespace_already_linked")) {
                    // Nothing to consent to — combining is impossible until the user
                    // detaches the duplicate. Say which one.
                    this.blocked = error.message;
                    return;
                }
                if (error instanceof OpenAppsError &&
                    error.detail?.code === "identity_belongs_to_another_account") {
                    // Do not merge behind the user's back. Park it and ask.
                    this.pending = {
                        namespace,
                        other: error.detail.other_account,
                    };
                    return;
                }
                throw error;
            }
        });
    }
    async confirmMerge() {
        const pending = this.pending;
        if (!pending)
            return;
        if (pending.namespace === "google") {
            // Consent has to be given before the redirect, because the callback
            // has no way to ask mid-flight.
            this.pending = null;
            await this.connectGoogle(true);
            return;
        }
        // The challenge was consumed by the refused attempt, so a fresh one is
        // needed — challenges are single-use by design.
        await this.run(async () => {
            const address = pending.namespace === "eip155" ? await connectEthereum() : undefined;
            const challenge = await this.sdk.auth.linkChallenge(pending.namespace, address);
            const proof = pending.namespace === "eip155"
                ? await signSiwe(challenge.message, address)
                : await signNostr(challenge.message);
            const result = await this.sdk.auth.linkVerify(challenge.challenge_id, proof, {
                merge: true,
            });
            this.pending = null;
            this.afterLink(result);
        });
    }
    afterLink(result) {
        this.notice = result.merged
            ? `Accounts combined — ${(result.credits_transferred ?? 0).toLocaleString()} credits moved across.`
            : "Connected.";
        this.emit("openapps-identity-linked", result);
        notify();
        void this.load();
    }
    async unlink(caip10) {
        await this.run(async () => {
            await this.sdk.auth.unlink(caip10);
            this.notice = "Disconnected.";
            this.emit("openapps-identity-unlinked", { caip10 });
            await this.load();
        });
    }
    render() {
        // No client configured yet; configure() will notify and re-render.
        if (!this.sdkOrNull)
            return html `<p class="muted">Loading…</p>`;
        if (!this.sdk.isLoggedIn) {
            return html `<p class="muted">Sign in to manage your account.</p>`;
        }
        if (!this.me)
            return html `<p class="muted">Loading…</p>`;
        if (this.pending)
            return this.renderMergePrompt(this.pending);
        const identities = this.me.linked_accounts;
        return html `
      <div class="card">
        <div class="head">
          <div>
            <div class="muted small">Account</div>
            <code class="id">${this.me.id}</code>
          </div>
          <div class="right">
            <div class="balance">${this.me.balance.toLocaleString()}</div>
            <div class="muted small">credits</div>
          </div>
        </div>

        <h3>Sign-in methods</h3>
        <ul class="identities">
          ${identities.map((account) => html `
              <li>
                <span class="tag">${LABELS[account.namespace] ?? account.namespace}</span>
                <code title=${account.caip10}
                  >${middle(account.label ?? account.caip10)}</code
                >
                ${identities.length > 1
            ? html `<button
                      class="link"
                      ?disabled=${this.busy}
                      @click=${() => this.unlink(account.caip10)}
                    >
                      Disconnect
                    </button>`
            : html `<span class="muted small">only method</span>`}
              </li>
            `)}
        </ul>

        ${this.connectable.length || this.canConnectGoogle
            ? html `
              <h3>Add another</h3>
              <div class="row">
                ${this.canConnectGoogle
                ? html `<button ?disabled=${this.busy} @click=${() => this.connectGoogle()}>
                      Connect Google
                    </button>`
                : nothing}
                ${this.connectable.map((ns) => 
            // With several wallets installed, the one button becomes
            // one button per wallet — reusing this same shape rather
            // than opening a chooser, so the choice appears where the
            // click already was.
            ns === "eip155" && this.wallets
                ? this.wallets.map((w) => html `
                          <button ?disabled=${this.busy} @click=${() => this.connect(ns, w)}>
                            Connect ${w.name}
                          </button>
                        `)
                : html `
                        <button
                          ?disabled=${this.busy}
                          @click=${() => ns === "eip155" ? this.beginEthereumConnect() : this.connect(ns)}
                        >
                          Connect ${LABELS[ns]}
                        </button>
                      `)}
              </div>
              <p class="muted small">
                Connecting a method that is already on another account will offer to
                combine them, so you keep one balance and one history.
              </p>
            `
            : html `<p class="muted small">Every available method is connected.</p>`}

        ${this.blocked
            ? html `<p class="warn" role="alert">${this.blocked}</p>`
            : nothing}
        ${this.notice ? html `<p class="notice">${this.notice}</p>` : nothing}
        ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
      </div>

    `;
    }
    renderMergePrompt(pending) {
        return html `
      <div class="card">
        <h3>Combine two accounts?</h3>
        <p>
          That ${LABELS[pending.namespace] ?? pending.namespace} identity already
          belongs to another account holding
          <strong>${pending.other.balance.toLocaleString()} credits</strong>.
        </p>
        <p class="muted small">
          Combining moves its credits, payment history and referral earnings onto
          this account, and signs it out everywhere. It cannot be undone.
        </p>
        <div class="row">
          <button class="primary" ?disabled=${this.busy} @click=${this.confirmMerge}>
            Combine them
          </button>
          <button ?disabled=${this.busy} @click=${() => (this.pending = null)}>
            Cancel
          </button>
        </div>
        ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
    `;
    }
    static { this.styles = [
        OpenAppsElement.baseStyles,
        css `
      .card {
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        padding: 1rem 1.1rem;
        background: var(--surface-card, var(--fb-card));
      }
      .head {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 1rem;
        border-bottom: 1px solid var(--border-hairline, var(--fb-hairline));
        padding-bottom: 0.75rem;
      }
      .right {
        text-align: right;
      }
      .balance {
        font-size: 1.5rem;
        font-weight: 700;
        font-variant-numeric: tabular-nums;
      }
      .id {
        font-size: 0.8rem;
        overflow-wrap: anywhere;
      }
      h3 {
        font-size: 0.9rem;
        margin: 1rem 0 0.5rem;
      }
      .identities {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 0.4rem;
      }
      .identities li {
        display: flex;
        align-items: center;
        gap: 0.6rem;
        font-size: 0.9rem;
      }
      .identities code {
        flex: 1;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .tag {
        font-size: 0.7rem;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        border-radius: 999px;
        padding: 0.1em 0.6em;
      }
      button.link {
        border: none;
        background: none;
        color: var(--text-muted, var(--fb-muted));
        text-decoration: underline;
        padding: 0;
        font-size: 0.85em;
      }
      .row {
        display: flex;
        gap: 0.5rem;
        flex-wrap: wrap;
      }
      .small {
        font-size: 0.8rem;
      }
      .notice {
        font-size: 0.85rem;
        margin-top: 0.6rem;
      }
      /* Semantic tokens rather than a hardcoded pair with its own media
         query: that combination ignored the host entirely, so a page
         forcing dark kept a bright yellow warning. */
      .warn {
        font-size: 0.85rem;
        margin-top: 0.6rem;
        padding: 0.5em 0.7em;
        border-radius: var(--radius-lg, 12px);
        background: var(--warning-bg, #fef3c7);
        color: var(--warning-fg, #92400e);
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
], OpenAppsAccount.prototype, "blocked", void 0);
__decorate([
    state()
], OpenAppsAccount.prototype, "wallets", void 0);
OpenAppsAccount = __decorate([
    customElement("openapps-account")
], OpenAppsAccount);
export { OpenAppsAccount };
/** Middle-truncate a long identifier for display. */
function middle(value, head = 18, tail = 8) {
    return value.length <= head + tail + 1
        ? value
        : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
//# sourceMappingURL=openapps-account.js.map