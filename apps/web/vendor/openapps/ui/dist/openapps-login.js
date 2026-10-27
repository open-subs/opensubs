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
import { OpenAppsError } from "@openapps/sdk";
import { OpenAppsElement } from "./base.js";
import { appleMark, emailMark, ethereumMark, githubMark, googleMark, nostrMark, } from "./provider-marks.js";
import { notify } from "./context.js";
import { loadLocale, localeFor, t } from "./i18n.js";
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
        /**
         * Hand the Nostr signer used to sign in to the host page, as an
         * `openapps-nostr-signer` event. Off by default.
         *
         * For a host whose own feature runs on the same key — OpenSync syncs as
         * the npub a person signs in with — so signing in once is enough rather
         * than signing in and then choosing the same signer again. The detail is
         * `{ method: "nip07", pubkey }`, `{ method: "bunker", pubkey, bunker,
         * clientSecret }` (32 bytes; the bunker already trusts it) or
         * `{ method: "nsec", pubkey, nsec }`. The last hands a raw key to page
         * script, which the pasted-key form already did while it was typed; only
         * a host that asked for it, by setting this, receives it.
         */
        this.shareSigner = false;
        /** Wallets to choose between, once more than one has announced. */
        this.wallets = null;
        /** Which Nostr fallback the user has opened, if any. */
        this.nostrFallback = "none";
        this.nostrHint = null;
        /** A bunker asking the user to approve in a browser. */
        this.authUrl = null;
        /**
         * Email sign-in: closed, asking for the address, or asking for the code
         * that was sent to it.
         */
        this.emailStep = "closed";
        this.emailAddress = "";
        this.emailFlow = null;
        this.emailError = null;
        /** Seconds until "Send a new code" is allowed again. */
        this.resendIn = 0;
        /**
         * The proof of work for the next send, started as soon as the email form
         * opens so it is usually done before the address is typed.
         */
        this.#pow = null;
        this.#shownLocale = null;
    }
    #resendTimer;
    /**
     * The proof of work for the next send, started as soon as the email form
     * opens so it is usually done before the address is typed.
     */
    #pow;
    /** Re-render when the page switches language. */
    #langObserver;
    #shownLocale;
    /** The page's language, read fresh so a language switch is followed. */
    get locale() {
        return localeFor(this);
    }
    tr(key, vars) {
        return t(this.locale, key, vars);
    }
    /** Fetch the page language's strings the first time it is seen. */
    willUpdate() {
        const locale = this.locale;
        if (locale !== this.#shownLocale) {
            this.#shownLocale = locale;
            void loadLocale(locale).then(() => this.requestUpdate());
        }
    }
    connectedCallback() {
        super.connectedCallback();
        this.#langObserver = new MutationObserver(() => this.requestUpdate());
        this.#langObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["lang"],
        });
        void this.load();
    }
    disconnectedCallback() {
        this.#langObserver?.disconnect();
        clearInterval(this.#resendTimer);
        super.disconnectedCallback();
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
            this.shareNostrSigner(proof, { method: "nip07" });
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
            // Made here rather than inside the signer so it can be handed over.
            const clientSecret = crypto.getRandomValues(new Uint8Array(32));
            const challenge = await this.sdk.auth.challenge("nostr");
            const proof = await signNostrWithBunker(challenge.message, value, {
                clientSecret,
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
            this.shareNostrSigner(proof, { method: "bunker", bunker: value, clientSecret });
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
                this.shareNostrSigner(proof, { method: "nsec", nsec });
                notify();
            }
            finally {
                // Whatever happened, do not leave the key sitting in the DOM.
                if (input)
                    input.value = "";
            }
        });
    }
    /** See `shareSigner`. The pubkey is read off the event that was signed,
     * which the server has just verified. */
    shareNostrSigner(proof, detail) {
        if (this.shareSigner) {
            this.emit("openapps-nostr-signer", {
                ...detail,
                pubkey: JSON.parse(proof.event).pubkey,
            });
        }
    }
    // ---------- email ----------
    openEmail() {
        this.error = null;
        this.emailError = null;
        this.emailStep = "address";
        this.prepareEmailPow();
        void this.updateComplete.then(() => this.renderRoot.querySelector("#oa-email")?.focus());
    }
    /** Start solving the next proof of work, if one is not already under way. */
    prepareEmailPow() {
        if (this.#pow)
            return;
        const pending = this.sdk.auth.emailPow().then((challenge) => solve(challenge));
        // A failure here is reported when the send needs it, not before.
        pending.catch(() => undefined);
        this.#pow = pending;
    }
    /** The prepared proof of work, spent: each one is good for one send. */
    async takeEmailPow() {
        this.prepareEmailPow();
        const pow = this.#pow;
        this.#pow = null;
        try {
            return await pow;
        }
        catch {
            // Expired or failed in the background: one fresh attempt.
            return solve(await this.sdk.auth.emailPow());
        }
    }
    async sendEmailCode(event) {
        event?.preventDefault();
        const input = this.renderRoot.querySelector("#oa-email");
        const address = (input?.value ?? this.emailAddress).trim();
        if (!address || (input && !input.checkValidity())) {
            this.emailError = this.tr("Enter a valid email address.");
            return;
        }
        this.emailAddress = address;
        this.emailError = null;
        this.busy = true;
        try {
            let pow = await this.takeEmailPow();
            let flow;
            try {
                flow = await this.sdk.auth.emailStart(address, pow, { lang: this.locale });
            }
            catch (cause) {
                // A proof of work that went stale while the address was typed is
                // ours to fix, not the person's: solve a fresh one and send once.
                if (!(cause instanceof OpenAppsError && cause.code === "pow_invalid"))
                    throw cause;
                pow = await solve(await this.sdk.auth.emailPow());
                flow = await this.sdk.auth.emailStart(address, pow, { lang: this.locale });
            }
            this.emailFlow = flow;
            this.emailStep = "code";
            this.startResendCountdown(flow.resend_after);
            // The next send (a resend) should not wait for its proof of work.
            this.prepareEmailPow();
            void this.updateComplete.then(() => this.renderRoot.querySelector("#oa-code")?.focus());
        }
        catch (cause) {
            this.emailError = this.describeEmailError(cause);
        }
        finally {
            this.busy = false;
        }
    }
    startResendCountdown(seconds) {
        clearInterval(this.#resendTimer);
        this.resendIn = Math.max(0, Math.ceil(seconds));
        if (this.resendIn === 0)
            return;
        this.#resendTimer = setInterval(() => {
            this.resendIn = Math.max(0, this.resendIn - 1);
            if (this.resendIn === 0)
                clearInterval(this.#resendTimer);
        }, 1000);
    }
    onCodeInput(event) {
        const input = event.target;
        const digits = input.value.replace(/\D/g, "").slice(0, 6);
        if (digits !== input.value)
            input.value = digits;
        // Six digits is the whole answer: submit without making the person
        // find the button, which on a phone is often under the keyboard.
        if (digits.length === 6 && !this.busy)
            void this.verifyEmailCode();
    }
    async verifyEmailCode(event) {
        event?.preventDefault();
        const input = this.renderRoot.querySelector("#oa-code");
        const code = (input?.value ?? "").replace(/\D/g, "");
        if (!this.emailFlow)
            return;
        if (code.length !== 6) {
            this.emailError = this.tr("The code is 6 digits.");
            return;
        }
        this.emailError = null;
        this.busy = true;
        try {
            const result = await this.sdk.auth.emailVerify(this.emailFlow.flow_id, code, {
                referralCode: referralFromUrl(),
            });
            this.closeEmail();
            clearReferral();
            this.emit("openapps-login", result);
            notify();
        }
        catch (cause) {
            if (input)
                input.value = "";
            this.emailError = this.describeEmailError(cause);
        }
        finally {
            this.busy = false;
        }
    }
    closeEmail() {
        clearInterval(this.#resendTimer);
        this.emailStep = "closed";
        this.emailFlow = null;
        this.emailError = null;
        this.resendIn = 0;
    }
    describeEmailError(cause) {
        if (!(cause instanceof OpenAppsError)) {
            return this.tr("Could not reach the server. Check your connection and try again.");
        }
        const detail = cause.detail ?? {};
        const retry = Number(detail.retry_after ?? 0);
        switch (cause.code) {
            case "email_invalid":
                return this.tr("Enter a valid email address.");
            case "code_wrong": {
                const left = Number(detail.attempts_left ?? 0);
                return left === 1
                    ? this.tr("That code is not right. 1 try left.")
                    : this.tr("That code is not right. {n} tries left.", { n: left });
            }
            case "code_expired":
                return this.tr("This code has expired or was tried too many times. Send a new one.");
            case "code_format":
                return this.tr("The code is 6 digits.");
            case "email_too_soon":
                this.startResendCountdown(retry);
                return this.tr("Wait {s} s before asking for another code.", { s: Math.max(1, retry) });
            case "email_limited":
            case "rate_limited":
                return this.tr("Too many codes were requested. Try again in {m} min, or sign in another way.", { m: Math.max(1, Math.ceil(retry / 60)) });
            case "email_busy":
                return this.tr("Email sign-in is busy right now. Sign in another way, or try again later.");
            case "email_send_failed":
                return this.tr("The code could not be sent. Try again in a minute, or sign in another way.");
            case "email_unavailable":
            case "not_found":
                return this.tr("Email sign-in is not available here.");
            default:
                return this.tr("Could not reach the server. Check your connection and try again.");
        }
    }
    loginWithRedirect(provider) {
        // A full-page redirect, not a popup: popups are blocked by default in
        // extensions and on mobile Safari. Come back to this exact page —
        // minus any fragment, which the server refuses because it needs to put
        // the login code there.
        const here = `${location.origin}${location.pathname}${location.search}`;
        // The referral code has to be handed over now. The account is created
        // inside the callback, which never sees this page's query string, so a
        // code left only in `return_to` arrives one step too late to attribute
        // the signup.
        window.location.href = this.sdk.auth.redirectStartUrl(provider, here, referralFromUrl());
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
        const email = this.enabled?.email ?? false;
        const apple = this.enabled?.apple ?? false;
        const google = this.enabled?.google ?? false;
        const github = this.enabled?.github ?? false;
        const wallet = this.enabled?.eip155 ?? false;
        const nostr = this.enabled?.nostr ?? false;
        if (this.enabled && !email && !apple && !google && !github && !wallet && !nostr) {
            return this.frame(html `
        <p class="muted">${this.tr("This server has no login methods configured.")}</p>
        ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
      `);
        }
        // Every provider button is neutral, never brand-filled. That is what
        // Google's own guidelines show, it is what the design kit's
        // ProviderButton does, and it keeps the coloured mark — the thing a user
        // actually recognises — as the only colour in the row.
        const block = this.variant === "panel" ? "block" : "";
        const googleButton = html `<button
      class="provider ${block}"
      ?disabled=${this.busy}
      @click=${() => this.loginWithRedirect("google")}
    >
      ${googleMark}<span>${this.tr("Continue with Google")}</span>
    </button>`;
        const emailButton = html `<button
      class="provider ${block}"
      ?disabled=${this.busy}
      aria-expanded=${this.emailStep !== "closed" ? "true" : "false"}
      @click=${() => (this.emailStep === "closed" ? this.openEmail() : this.closeEmail())}
    >
      ${emailMark}<span>${this.tr("Continue with email")}</span>
    </button>`;
        return this.frame(html `
      <div class="stack">
        ${email && google
            ? // Email first, beside Google: the two a person without a wallet
                // or an Apple device is most likely to have. The pair wraps to
                // two rows when the box is too narrow for both labels.
                html `<div class="pair">${emailButton}${googleButton}</div>`
            : email
                ? emailButton
                : nothing}
        ${email && this.emailStep !== "closed" ? this.renderEmailForm() : nothing}
        ${apple
            ? // First, and the same size as the rest: Apple's guidelines ask
                // that it be at least as prominent as any other sign-in offered.
                html `<button
              class="provider ${block}"
              ?disabled=${this.busy}
              @click=${() => this.loginWithRedirect("apple")}
            >
              ${appleMark}<span>${this.tr("Continue with Apple")}</span>
            </button>`
            : nothing}
        ${google && !email ? googleButton : nothing}
        ${github
            ? html `<button
              class="provider ${block}"
              ?disabled=${this.busy}
              @click=${() => this.loginWithRedirect("github")}
            >
              ${githubMark}<span>${this.tr("Continue with GitHub")}</span>
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
                ${ethereumMark}<span>${this.tr("Continue with {name}", { name: w.name })}</span>
              </button>`)
            : wallet
                ? html `<button
                class="provider ${block}"
                ?disabled=${this.busy}
                @click=${() => this.beginWalletLogin()}
              >
                ${ethereumMark}<span>${this.tr("Continue with a wallet")}</span>
              </button>`
                : nothing}
        ${nostr
            ? html `
              <button
                class="provider ${block}"
                ?disabled=${this.busy}
                @click=${this.loginWithNostr}
              >
                ${nostrMark}<span>${this.tr("Continue with Nostr")}</span>
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
     * The email form: the address, then the code sent to it.
     *
     * `autocomplete="one-time-code"` lets iOS and Android offer the code
     * straight from the mail notification, and `inputmode="numeric"` brings
     * up the number pad; neither needs the code to leave this page.
     */
    renderEmailForm() {
        const error = this.emailError
            ? html `<p class="error" role="alert">${this.emailError}</p>`
            : nothing;
        if (this.emailStep === "address") {
            return html `
        <form class="email" @submit=${this.sendEmailCode} novalidate>
          <div class="field">
            <label for="oa-email">${this.tr("Email address")}</label>
            <input
              id="oa-email"
              type="email"
              inputmode="email"
              autocomplete="email"
              autocapitalize="off"
              spellcheck="false"
              required
              maxlength="254"
              .value=${this.emailAddress}
              ?disabled=${this.busy}
            />
          </div>
          ${error}
          <button class="primary" type="submit" ?disabled=${this.busy}>
            ${this.busy ? this.tr("Sending…") : this.tr("Send code")}
          </button>
        </form>
      `;
        }
        return html `
      <form class="email" @submit=${this.verifyEmailCode} novalidate>
        <p class="muted small">
          ${this.tr("We sent a 6-digit code to {email}. It works for 10 minutes.", {
            email: this.emailAddress,
        })}
        </p>
        <div class="field">
          <label for="oa-code">${this.tr("Code")}</label>
          <input
            id="oa-code"
            class="code"
            type="text"
            inputmode="numeric"
            autocomplete="one-time-code"
            pattern="[0-9]*"
            maxlength="6"
            spellcheck="false"
            ?disabled=${this.busy}
            @input=${this.onCodeInput}
          />
          <span class="hint">${this.tr("Not there? Check your spam folder.")}</span>
        </div>
        ${error}
        <button class="primary" type="submit" ?disabled=${this.busy}>
          ${this.busy ? this.tr("Checking…") : this.tr("Sign in")}
        </button>
        <div class="row wrap">
          <button
            class="link"
            type="button"
            ?disabled=${this.busy || this.resendIn > 0}
            @click=${() => this.sendEmailCode()}
          >
            ${this.resendIn > 0
            ? this.tr("Send a new code in {s}s", { s: this.resendIn })
            : this.tr("Send a new code")}
          </button>
          <button
            class="link"
            type="button"
            ?disabled=${this.busy}
            @click=${() => {
            this.closeEmail();
            this.openEmail();
        }}
          >
            ${this.tr("Use a different email")}
          </button>
        </div>
      </form>
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
        ${this.tr("No extension? Use a remote signer")}
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
        // An email identity reads as the address, not as `email:jane@…`.
        const identity = (me.display_name ?? me.linked_accounts[0]?.caip10 ?? me.id).replace(/^email:/, "");
        return html `
      <div class="row">
        <span class="identity" title=${identity}>${shorten(identity)}</span>
        <button ?disabled=${this.busy} @click=${this.logout}>${this.tr("Sign out")}</button>
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
      /* Email and Google side by side, each half the row, labels on one
         line. When the box is too narrow for both whole labels (a phone, a
         long translation) the pair wraps to two full-width rows rather than
         breaking a label in two. Email stays first either way. */
      .pair {
        display: flex;
        flex-wrap: wrap;
        gap: 0.5em;
      }
      .pair > button.provider {
        flex: 1 1 0;
        min-width: max-content;
        justify-content: center;
        gap: 8px;
        padding-inline: 10px;
        font-size: 0.875em;
      }
      .pair > button.provider span,
      .pair > button.provider.block span {
        flex: 0 1 auto;
        margin-right: 0;
        white-space: nowrap;
      }
      .email {
        display: flex;
        flex-direction: column;
        gap: 0.6em;
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        padding: 0.8em;
      }
      .email input.code {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-size: 1.25em;
        letter-spacing: 0.3em;
        text-align: center;
      }
      .row.wrap {
        flex-wrap: wrap;
        justify-content: space-between;
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
    property({ type: Boolean, attribute: "share-signer" })
], OpenAppsLogin.prototype, "shareSigner", void 0);
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
__decorate([
    state()
], OpenAppsLogin.prototype, "emailStep", void 0);
__decorate([
    state()
], OpenAppsLogin.prototype, "emailAddress", void 0);
__decorate([
    state()
], OpenAppsLogin.prototype, "emailFlow", void 0);
__decorate([
    state()
], OpenAppsLogin.prototype, "emailError", void 0);
__decorate([
    state()
], OpenAppsLogin.prototype, "resendIn", void 0);
OpenAppsLogin = __decorate([
    customElement("openapps-login")
], OpenAppsLogin);
export { OpenAppsLogin };
/**
 * The proof-of-work solver, fetched the first time someone opens the email
 * form: every page carries the sign-in box, and most never use email.
 */
async function solve(challenge) {
    const { solvePow } = await import("./pow.js");
    return solvePow(challenge);
}
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