var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * `<openapps-login>` — the whole sign-in flow in one tag.
 *
 * Offers every method the *server* has configured, and works out whether
 * this browser can complete it when the user clicks. Detecting up front is
 * tempting but wrong: extensions inject their providers at unpredictable
 * moments, and multi-chain wallets register their less-used chains last, so
 * a snapshot taken at first render hides buttons the user could have used.
 */
import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { OpenAppsElement } from "./base.js";
import { ethereumMark, googleMark, nostrMark } from "./provider-marks.js";
import { notify } from "./context.js";
import { clearReferral, referralInUrl, storedReferral } from "./referral-code.js";
import { connectEthereum, discoverEthereumWallets, nostrProviderNames, signNostr, signNostrWithBunker, signNostrWithSecretKey, signSiwe, waitForNostrProvider, } from "./wallet.js";
let OpenAppsLogin = class OpenAppsLogin extends OpenAppsElement {
    constructor() {
        super(...arguments);
        this.me = null;
        /** Methods the server has configured. Null until asked. */
        this.enabled = null;
        /**
         * How long to wait for a browser signer to register before offering the
         * key fallback. Extensions inject at wildly different moments, so a
         * single check is not enough; two seconds covers the slow ones without
         * making a genuinely-absent signer feel broken.
         */
        this.signerTimeout = 2000;
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
        this.variant = "inline";
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
        this.heading = "Sign in to OpenApps";
        this.description = "One account for every app in the suite. Optional — the apps work without it.";
        this.mark = "O";
        /** Wallets to choose between, once more than one has announced. */
        this.wallets = null;
        /** Which Nostr fallback the user has opened, if any. */
        this.nostrFallback = "none";
        this.nostrHint = null;
        /** A bunker asking the user to approve in a browser. */
        this.authUrl = null;
    }
    connectedCallback() {
        super.connectedCallback();
        void this.load();
    }
    onSessionChange() {
        void this.load();
    }
    async load() {
        // A redirect sign-in lands back here with a code in the fragment.
        // Redeem it before anything else, so the rest of this runs as a
        // signed-in user rather than briefly rendering the sign-in buttons.
        const redirected = await this.run(() => this.sdk.auth.completeRedirect());
        if (redirected) {
            clearReferral();
            this.emit("openapps-login", redirected);
            notify();
        }
        // Offer only what both sides can do: a method needs a signer in this
        // browser and credentials on that server.
        if (!this.enabled) {
            this.enabled = (await this.run(() => this.sdk.auth.methods())) ?? null;
        }
        if (!this.sdk.isLoggedIn) {
            this.me = null;
            return;
        }
        // A stored session can still be dead (revoked, expired family); `me`
        // is the cheapest way to find out, and the SDK clears it if so.
        this.me = (await this.run(() => this.sdk.auth.me())) ?? null;
    }
    /** See `<openapps-account>`'s own version: one wallet connects, several
     * are offered by name, because `window.ethereum` holds only whichever
     * injected last and cannot express a choice. */
    async beginWalletLogin() {
        const wallets = await discoverEthereumWallets();
        if (wallets.length > 1) {
            this.wallets = wallets;
            return;
        }
        await this.loginWithWallet(wallets[0]);
    }
    async loginWithWallet(wallet) {
        this.wallets = null;
        await this.run(async () => {
            // connectEthereum throws a readable WalletError when no provider
            // responded, which is the right moment to find out — not at render.
            const address = await connectEthereum(wallet?.provider);
            const challenge = await this.sdk.auth.challenge("eip155", address);
            const proof = await signSiwe(challenge.message, address, wallet?.provider);
            const result = await this.sdk.auth.verify(challenge.challenge_id, proof, {
                referralCode: referralFromUrl(),
            });
            clearReferral();
            this.emit("openapps-login", result);
            notify();
        });
    }
    async loginWithNostr() {
        // Give a slow extension a moment to register before concluding it is
        // absent — checking once at render time is what made installed wallets
        // look missing.
        if (!(await waitForNostrProvider(this.signerTimeout))) {
            // A remote signer is the right answer here — on mobile there is no
            // extension to find, and it keeps the key off this device.
            this.nostrFallback = "bunker";
            this.nostrHint =
                `No signer extension answered. Checked ${nostrProviderNames().join(" and ")}. ` +
                    "On a phone, or without an extension, connect a remote signer below.";
            return;
        }
        await this.run(async () => {
            const challenge = await this.sdk.auth.challenge("nostr");
            const proof = await signNostr(challenge.message);
            const result = await this.sdk.auth.verify(challenge.challenge_id, proof, {
                referralCode: referralFromUrl(),
            });
            clearReferral();
            this.emit("openapps-login", result);
            notify();
        });
    }
    /** Sign through a remote signer (NIP-46). The key never comes here. */
    async loginWithBunker(event) {
        event.preventDefault();
        const input = this.renderRoot.querySelector("#bunker");
        const value = input?.value.trim() ?? "";
        if (!value)
            return;
        this.authUrl = null;
        await this.run(async () => {
            const challenge = await this.sdk.auth.challenge("nostr");
            const proof = await signNostrWithBunker(challenge.message, value, {
                // Some bunkers need a one-off approval in a browser tab; surface
                // the link rather than silently stalling.
                onAuthUrl: (url) => {
                    this.authUrl = url;
                },
            });
            const result = await this.sdk.auth.verify(challenge.challenge_id, proof, {
                referralCode: referralFromUrl(),
            });
            this.nostrFallback = "none";
            this.authUrl = null;
            clearReferral();
            this.emit("openapps-login", result);
            notify();
        });
    }
    /** Sign with a pasted `nsec1…`. The key stays in this browser. */
    async loginWithNsec(event) {
        event.preventDefault();
        const input = this.renderRoot.querySelector("#nsec");
        const nsec = input?.value.trim() ?? "";
        if (!nsec)
            return;
        await this.run(async () => {
            try {
                const challenge = await this.sdk.auth.challenge("nostr");
                const proof = await signNostrWithSecretKey(challenge.message, nsec);
                const result = await this.sdk.auth.verify(challenge.challenge_id, proof, {
                    referralCode: referralFromUrl(),
                });
                this.nostrFallback = "none";
                clearReferral();
                this.emit("openapps-login", result);
                notify();
            }
            finally {
                // Whatever happened, do not leave the key sitting in the DOM.
                if (input)
                    input.value = "";
            }
        });
    }
    loginWithGoogle() {
        // A full-page redirect, not a popup: popups are blocked by default in
        // extensions and on mobile Safari. Come back to this exact page —
        // minus any fragment, which the server refuses because it needs to put
        // the login code there.
        const here = `${location.origin}${location.pathname}${location.search}`;
        // The referral code has to be handed over now. The account is created
        // inside the callback, which never sees this page's query string, so a
        // code left only in `return_to` arrives one step too late to attribute
        // the signup.
        window.location.href = this.sdk.auth.googleStartUrl(here, referralFromUrl());
    }
    async logout() {
        await this.run(() => this.sdk.auth.logout());
        this.me = null;
        this.emit("openapps-logout", null);
        notify();
    }
    render() {
        if (this.me)
            return this.renderSignedIn(this.me);
        // Offer everything the *server* supports. Whether this browser has a
        // signer is discovered when the user clicks, because extensions inject
        // at unpredictable times and hiding a button the user could have used
        // is worse than showing one that explains itself.
        const google = this.enabled?.google ?? false;
        const wallet = this.enabled?.eip155 ?? false;
        const nostr = this.enabled?.nostr ?? false;
        if (this.enabled && !google && !wallet && !nostr) {
            return this.frame(html `
        <p class="muted">This server has no login methods configured.</p>
        ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
      `);
        }
        // Every provider button is neutral, never brand-filled. That is what
        // Google's own guidelines show, it is what the design kit's
        // ProviderButton does, and it keeps the coloured mark — the thing a user
        // actually recognises — as the only colour in the row.
        const block = this.variant === "panel" ? "block" : "";
        return this.frame(html `
      <div class="stack">
        ${google
            ? html `<button
              class="provider ${block}"
              ?disabled=${this.busy}
              @click=${this.loginWithGoogle}
            >
              ${googleMark}<span>Continue with Google</span>
            </button>`
            : nothing}
        ${wallet && this.wallets
            ? // Several installed: one button each, named, in place of the
                // generic one — see <openapps-account> for why.
                this.wallets.map((w) => html `<button
                class="provider ${block}"
                ?disabled=${this.busy}
                @click=${() => this.loginWithWallet(w)}
              >
                ${ethereumMark}<span>Continue with ${w.name}</span>
              </button>`)
            : wallet
                ? html `<button
                class="provider ${block}"
                ?disabled=${this.busy}
                @click=${() => this.beginWalletLogin()}
              >
                ${ethereumMark}<span>Continue with a wallet</span>
              </button>`
                : nothing}
        ${nostr
            ? html `
              <button
                class="provider ${block}"
                ?disabled=${this.busy}
                @click=${this.loginWithNostr}
              >
                ${nostrMark}<span>Continue with Nostr</span>
              </button>
              ${this.renderNostrFallback()}
            `
            : nothing}
        ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
      </div>
    `);
    }
    /**
     * Wrap the provider buttons in the SDK card, or hand them back bare.
     *
     * The panel deliberately carries no navigation of its own — no back link,
     * no footer. The host owns where the user goes next, which is what lets
     * the same surface sit in a modal, a settings pane and a route.
     */
    frame(inner) {
        if (this.variant !== "panel")
            return inner;
        return html `
      <div class="panel">
        <div class="head">
          <span class="mark" aria-hidden="true">${this.mark}</span>
          <h1 class="title">${this.heading}</h1>
          ${this.description
            ? html `<p class="desc">${this.description}</p>`
            : nothing}
        </div>
        <div class="body">${inner}</div>
      </div>
    `;
    }
    /**
     * The two ways to sign Nostr without a browser extension.
     *
     * A remote signer is offered first and by name, because it is strictly
     * better: the key stays in the signing app and only requests travel. The
     * raw key is behind a second click, where it belongs.
     */
    renderNostrFallback() {
        if (this.nostrFallback === "bunker")
            return this.renderBunkerForm();
        if (this.nostrFallback === "nsec")
            return this.renderNsecForm();
        return html `
      <button
        class="link"
        ?disabled=${this.busy}
        @click=${() => {
            this.nostrFallback = "bunker";
            this.nostrHint = null;
        }}
      >
        No extension? Use a remote signer
      </button>
    `;
    }
    renderBunkerForm() {
        return html `
      <form class="nsec" @submit=${this.loginWithBunker}>
        ${this.nostrHint ? html `<p class="muted small">${this.nostrHint}</p>` : nothing}
        <p class="muted small">
          Paste the connection string from your signer — Amber, nsec.app, or your
          own bunker. It looks like <code>bunker://…</code>, or you can use a
          NIP-05 name. <strong>Your key never leaves the signer</strong>; only the
          request to sign travels, and you approve it there.
        </p>
        <div class="field">
          <label for="bunker">Remote signer</label>
          <input
            id="bunker"
            type="text"
            placeholder="bunker://… or you@example.com"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            ?disabled=${this.busy}
          />
          <span class="hint">
            A bunker URI, or the NIP-05 address your signer is reachable at.
          </span>
        </div>
        ${this.authUrl
            ? html `<p class="muted small">
              Your signer needs approval:
              <a href=${this.authUrl} target="_blank" rel="noreferrer noopener"
                >open it</a
              >, then come back.
            </p>`
            : nothing}
        <div class="row">
          <button class="primary" type="submit" ?disabled=${this.busy}>
            ${this.busy ? "Waiting for your signer…" : "Connect signer"}
          </button>
          <button
            type="button"
            ?disabled=${this.busy}
            @click=${() => (this.nostrFallback = "none")}
          >
            Cancel
          </button>
        </div>
        <button
          class="link"
          type="button"
          ?disabled=${this.busy}
          @click=${() => {
            this.nostrFallback = "nsec";
            this.nostrHint = null;
        }}
        >
          I only have a private key
        </button>
      </form>
    `;
    }
    renderNsecForm() {
        return html `
      <form class="nsec" @submit=${this.loginWithNsec}>
        ${this.nostrHint ? html `<p class="muted small">${this.nostrHint}</p>` : nothing}
        <p class="warn">
          <strong>Only do this on a key you can afford to lose.</strong>
          An <code>nsec</code> is your whole Nostr identity — it cannot be changed
          without abandoning the account, and any script on this page can read it
          while you paste it. A signer extension exists so a website never sees
          your key.
        </p>
        <div class="field">
          <label for="nsec">Secret key</label>
          <input
            id="nsec"
            type="password"
            placeholder="nsec1…"
            autocomplete="off"
            autocapitalize="off"
            autocorrect="off"
            spellcheck="false"
            ?disabled=${this.busy}
          />
        </div>
        <p class="muted small">
          The key is used in this browser to sign one message. It is not sent to
          the server and not saved anywhere.
        </p>
        <div class="row">
          <button class="primary" type="submit" ?disabled=${this.busy}>
            Sign in
          </button>
          <button type="button" ?disabled=${this.busy} @click=${() => (this.nostrFallback = "none")}>
            Cancel
          </button>
        </div>
      </form>
    `;
    }
    renderSignedIn(me) {
        const identity = me.display_name ?? me.linked_accounts[0]?.caip10 ?? me.id;
        return html `
      <div class="row">
        <span class="identity" title=${identity}>${shorten(identity)}</span>
        <button ?disabled=${this.busy} @click=${this.logout}>Sign out</button>
      </div>
      ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
    `;
    }
    static { this.styles = [
        OpenAppsElement.baseStyles,
        css `
      /* Mark on the left, label centred in the space that remains — so the
         three labels line up with each other rather than each sitting a
         different distance from its own icon. */
      button.provider {
        display: flex;
        align-items: center;
        gap: 10px;
        text-align: left;
      }
      button.provider svg {
        flex: none;
      }
      button.provider.block span {
        flex: 1;
        text-align: center;
        /* Balance the mark so the label is centred on the button, not on
           the space beside the mark. */
        margin-right: 26px;
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: 0.5em;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 0.75em;
      }
      .identity {
        font-variant-numeric: tabular-nums;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      button.link {
        border: none;
        background: none;
        color: var(--text-muted, var(--fb-muted));
        text-decoration: underline;
        padding: 0.1em 0;
        font-size: 0.85em;
        text-align: left;
      }
      .nsec {
        display: flex;
        flex-direction: column;
        gap: 0.5em;
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        padding: 0.8em;
      }
      /* Everything else comes from .field. Only the family is overridden:
         a key is a literal, and mono carries literals. */
      .nsec input {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
      }
      /* Semantic tokens, so a host forcing dark gets the dark warning —
         the hardcoded pair here used its own media query and so ignored
         the host entirely. */
      .warn {
        font-size: 0.8rem;
        margin: 0;
        padding: 0.5em 0.6em;
        border-radius: var(--radius-lg, 12px);
        background: var(--warning-bg, #fef3c7);
        color: var(--warning-fg, #92400e);
      }
      .small {
        font-size: 0.78rem;
      }
      .row {
        display: flex;
        gap: 0.5em;
      }
    `,
    ]; }
};
__decorate([
    state()
], OpenAppsLogin.prototype, "me", void 0);
__decorate([
    state()
], OpenAppsLogin.prototype, "enabled", void 0);
__decorate([
    property({ type: Number, attribute: "signer-timeout" })
], OpenAppsLogin.prototype, "signerTimeout", void 0);
__decorate([
    property({ type: String })
], OpenAppsLogin.prototype, "variant", void 0);
__decorate([
    property({ type: String })
], OpenAppsLogin.prototype, "heading", void 0);
__decorate([
    property({ type: String })
], OpenAppsLogin.prototype, "description", void 0);
__decorate([
    property({ type: String })
], OpenAppsLogin.prototype, "mark", void 0);
__decorate([
    state()
], OpenAppsLogin.prototype, "wallets", void 0);
__decorate([
    state()
], OpenAppsLogin.prototype, "nostrFallback", void 0);
__decorate([
    state()
], OpenAppsLogin.prototype, "nostrHint", void 0);
__decorate([
    state()
], OpenAppsLogin.prototype, "authUrl", void 0);
OpenAppsLogin = __decorate([
    customElement("openapps-login")
], OpenAppsLogin);
export { OpenAppsLogin };
/** Middle-truncate long identifiers (addresses, npubs) for display. */
export function shorten(value, head = 10, tail = 6) {
    return value.length <= head + tail + 1
        ? value
        : `${value.slice(0, head)}…${value.slice(-tail)}`;
}
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
export function referralFromUrl() {
    return referralInUrl() ?? storedReferral();
}
//# sourceMappingURL=openapps-login.js.map