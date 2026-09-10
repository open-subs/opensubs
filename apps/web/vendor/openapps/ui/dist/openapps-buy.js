var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * `<openapps-buy>` — pick a package, pick a rail, pay, get credits.
 *
 * The three rails look different to the user but share one shape: start the
 * top-up, then watch its status. Nothing here decides whether a payment
 * succeeded — the server does that from a webhook, a chain log, or a
 * Lightning settlement, and this element only polls `waitFor`.
 */
import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { OpenAppsElement } from "./base.js";
import { notify } from "./context.js";
let OpenAppsBuy = class OpenAppsBuy extends OpenAppsElement {
    constructor() {
        super(...arguments);
        /** Restrict the offered rails, e.g. `rails="lightning,stripe"`. */
        this.rails = "";
        /**
         * Where Stripe returns the browser after checkout.
         *
         * Empty (the default) comes back to this page, which is what a web app
         * wants. `none` ends on the server's own confirmation page instead — for
         * a host that cannot be redirected to at all, which is every browser
         * extension: Chrome refuses to land a cross-origin redirect on a
         * `chrome-extension://` page. Anything else is used verbatim.
         *
         * Without this, an extension had to hand-roll its own Stripe button and
         * restrict this element to the other rails, which is how one payment
         * surface turns into two that look nothing alike.
         */
        this.returnTo = "";
        this.packages = null;
        this.selected = null;
        this.instruction = null;
        this.topup = null;
        this.waiting = false;
    }
    #abort;
    connectedCallback() {
        super.connectedCallback();
        void this.load();
    }
    disconnectedCallback() {
        // Leaving the page must not keep a poll loop alive.
        this.#abort?.abort();
        super.disconnectedCallback();
    }
    onSessionChange() {
        // A notify may be the configure() that finally supplied a client, so a
        // load that could not run before has to be retried. Re-rendering alone
        // would leave the element on "Loading packages…" forever, because the
        // fetch it is waiting for never happened.
        if (!this.packages) {
            void this.load();
            return;
        }
        this.requestUpdate();
    }
    async load() {
        // The element upgrades the moment the bundle defines it, which on a
        // plain HTML page is before the host script calls configure(). There is
        // nothing to fetch yet, and reporting "no OpenApps client" here would
        // latch a message into `error` that outlives the condition and that a
        // user cannot act on anyway.
        if (!this.sdkOrNull)
            return;
        const packages = await this.run(() => this.sdk.payments.packages());
        if (packages)
            this.packages = packages;
    }
    /** Rails the server has enabled, intersected with the `rails` attribute. */
    get offeredRails() {
        if (!this.packages)
            return [];
        const enabled = ["stripe", "ethereum", "lightning"].filter((rail) => this.packages?.rails?.[rail]);
        const allowed = this.rails
            .split(",")
            .map((r) => r.trim())
            .filter(Boolean);
        return allowed.length ? enabled.filter((r) => allowed.includes(r)) : enabled;
    }
    async start(rail) {
        const pkg = this.selected;
        if (!pkg)
            return;
        await this.run(async () => {
            let topupId;
            switch (rail) {
                case "stripe": {
                    // `none` means "do not try to come back here"; empty means the
                    // SDK's default of this page.
                    const checkout = await this.sdk.payments.stripeCheckout(pkg.id, {
                        returnTo: this.returnTo === "none" ? null : this.returnTo || undefined,
                    });
                    this.instruction = { kind: "redirect" };
                    // Stripe hosts the card form; we hand the browser over and the
                    // webhook credits the account whether or not the user comes back.
                    //
                    // Cancelable, so a host that must not navigate its own window —
                    // an extension page, which is destroyed the moment it does — can
                    // open the URL its own way instead. Everyone else gets the
                    // navigation by doing nothing.
                    const handled = !this.dispatchEvent(new CustomEvent("openapps-checkout", {
                        detail: { url: checkout.checkout_url, packageId: pkg.id },
                        cancelable: true,
                        bubbles: true,
                        composed: true,
                    }));
                    if (!handled)
                        window.location.href = checkout.checkout_url;
                    return;
                }
                case "ethereum": {
                    const deposit = await this.sdk.payments.ethDepositAddress(pkg.id);
                    topupId = deposit.topup_id;
                    this.instruction = {
                        kind: "address",
                        chain: deposit.chain,
                        address: deposit.address,
                        amount: deposit.expected_amount,
                    };
                    break;
                }
                case "lightning": {
                    const invoice = await this.sdk.payments.lightningInvoice(pkg.id);
                    topupId = invoice.topup_id;
                    this.instruction = {
                        kind: "invoice",
                        bolt11: invoice.bolt11,
                        amountMsat: invoice.amount_msat,
                    };
                    break;
                }
            }
            void this.watch(topupId, WAIT_TIMEOUT_MS[rail]);
        });
    }
    async watch(topupId, timeoutMs) {
        this.#abort?.abort();
        const controller = new AbortController();
        this.#abort = controller;
        this.waiting = true;
        try {
            const topup = await this.sdk.payments.waitFor(topupId, {
                timeoutMs,
                signal: controller.signal,
                onPoll: (t) => {
                    this.topup = t;
                },
            });
            this.topup = topup;
            if (topup.status === "confirmed") {
                this.emit("openapps-topup", topup);
                // Tells every other element on the page (the balance, typically)
                // that its data is stale.
                notify();
            }
        }
        catch (cause) {
            if (!(cause instanceof Error && cause.name === "AbortError")) {
                this.error = describeWait(cause);
            }
        }
        finally {
            this.waiting = false;
        }
    }
    reset() {
        this.#abort?.abort();
        this.selected = null;
        this.instruction = null;
        this.topup = null;
        this.error = null;
    }
    render() {
        // No client configured yet; configure() will notify and re-render.
        if (!this.sdkOrNull)
            return html `<p class="muted">Loading…</p>`;
        if (!this.sdk.isLoggedIn) {
            return html `<p class="muted">Sign in to buy credits.</p>`;
        }
        if (!this.packages) {
            return html `<p class="muted">${this.error ?? "Loading packages…"}</p>`;
        }
        if (this.instruction)
            return this.renderInstruction(this.instruction);
        if (this.selected)
            return this.renderRails(this.selected);
        // A malformed or partial response must degrade to "nothing to buy",
        // never to a blank element from a render-time crash.
        return this.renderPackages(this.packages.packages ?? []);
    }
    renderPackages(packages) {
        if (packages.length === 0) {
            return html `<p class="muted">No credit packages are configured.</p>`;
        }
        return html `
      <div class="grid">
        ${packages.map((pkg) => html `
            <button class="package" @click=${() => (this.selected = pkg)}>
              <span class="credits">
                ${pkg.credits.toLocaleString()} credits
              </span>
              <span class="perunit caption">${perCreditCost(pkg)}</span>
              <span class="price">${formatUsd(pkg.usd_price)}</span>
            </button>
          `)}
      </div>
      ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
    `;
    }
    renderRails(pkg) {
        const rails = this.offeredRails;
        return html `
      <p>
        <strong>${pkg.credits.toLocaleString()} credits</strong> —
        ${formatUsd(pkg.usd_price)}
      </p>
      <div class="stack">
        ${rails.map((rail) => html `
            <button class="primary" ?disabled=${this.busy} @click=${() => this.start(rail)}>
              ${RAIL_LABELS[rail]}
            </button>
          `)}
        ${rails.length === 0
            ? html `<p class="muted">No payment methods are enabled.</p>`
            : nothing}
        <button @click=${this.reset}>Back</button>
      </div>
      ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
    `;
    }
    renderInstruction(instruction) {
        const status = this.topup?.status ?? "pending";
        if (status === "confirmed") {
            return html `
        <span class="badge success"><span class="dot"></span>Confirmed</span>
        <p class="ok">Payment confirmed — credits added.</p>
        <button @click=${this.reset}>Buy more</button>
      `;
        }
        if (status === "failed" || status === "expired") {
            return html `
        <span class="badge danger"><span class="dot"></span>${status === "failed" ? "Failed" : "Expired"}</span>
        <p class="error" role="alert">This top-up ${status}. Nothing was charged.</p>
        <button @click=${this.reset}>Try again</button>
      `;
        }
        return html `
      ${instruction.kind === "redirect"
            ? html `<p class="muted">Redirecting to checkout…</p>`
            : nothing}
      ${instruction.kind === "address"
            ? html `
            <p>Send exactly <strong>${formatUnits(instruction.amount, 6)}</strong> USDC or
            USDT on <code>${instruction.chain}</code> to:</p>
            <code class="payload">${instruction.address}</code>
          `
            : nothing}
      ${instruction.kind === "invoice"
            ? html `
            <p>Pay this Lightning invoice
            (<strong>${Math.ceil(instruction.amountMsat / 1000).toLocaleString()} sats</strong>):</p>
            <code class="payload">${instruction.bolt11}</code>
          `
            : nothing}
      ${instruction.kind !== "redirect"
            ? html `
            <div class="row">
              <button @click=${() => this.copy(payloadOf(instruction))}>Copy</button>
              <button @click=${this.reset}>Cancel</button>
            </div>
            ${this.renderWaiting()}
          `
            : nothing}
      ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
    `;
    }
    /**
     * What to say while a payment settles.
     *
     * An on-chain deposit is credited only once it is deep enough, which is
     * minutes. Through all of that the payer has already sent their money, so
     * an unchanging "Waiting for payment…" reads as though it was lost — and
     * the natural response to that is to pay again. Once the server has seen
     * the deposit it reports how deep it is, and a number that visibly climbs
     * is the difference between waiting and worrying.
     */
    renderWaiting() {
        if (!this.waiting) {
            return html `<p class="muted" aria-live="polite">Not watching for payment.</p>`;
        }
        const seen = this.topup?.confirmations;
        // Nothing matching has appeared on chain yet — including the whole
        // Stripe and Lightning case, where confirmations never apply.
        if (seen === undefined) {
            return html `<p class="muted" aria-live="polite">Waiting for payment…</p>`;
        }
        const required = this.topup?.confirmations_required;
        // Finality is not a block count, so there is no honest fraction to
        // show; that the deposit was seen at all is the reassuring part.
        if (required == null) {
            return html `
        <p class="muted" aria-live="polite">
          Payment received — waiting for the network to finalise it.
        </p>
      `;
        }
        // Confirmations keep climbing after the requirement is met, but a bar
        // reading "14 of 12" looks like a bug rather than success.
        const done = Math.min(seen, required);
        return html `
      <p class="muted" aria-live="polite">
        Payment received — confirming (${done} of ${required}).
      </p>
      <progress
        class="confirms"
        max=${required}
        value=${done}
        aria-label="Confirmations"
      ></progress>
    `;
    }
    async copy(text) {
        try {
            await navigator.clipboard.writeText(text);
        }
        catch {
            this.error = "Could not copy — select the text and copy it manually.";
        }
    }
    static { this.styles = [
        OpenAppsElement.baseStyles,
        css `
      /* Packs stack as rows rather than tiles: the numbers line up down the
         right edge, which is what makes three prices comparable at a glance. */
      .grid {
        display: grid;
        gap: 8px;
      }
      .package {
        display: flex;
        align-items: center;
        gap: 14px;
        min-height: auto;
        padding: 14px 16px;
        text-align: left;
        border-radius: var(--radius-lg, 12px);
      }
      .package:hover:not([disabled]) {
        border-color: var(--border-strong, var(--fb-hairline));
      }
      .credits {
        flex: 1;
        font: var(--weight-medium, 500) var(--text-base, 15px) / 1.2
          var(--font-sans, "Geist", system-ui, sans-serif);
        color: var(--text-strong, var(--fb-strong));
      }
      /* Money is always mono — balances, prices, per-unit rates, ledger
         amounts. Tabular figures keep the column aligned across packs. */
      .price {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-size: var(--text-md, 17px);
        color: var(--text-strong, var(--fb-strong));
      }
      .perunit {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-size: var(--text-2xs, 11px);
        color: var(--text-faint, var(--fb-faint));
      }
      .stack {
        display: flex;
        flex-direction: column;
        gap: 0.5em;
      }
      .row {
        display: flex;
        gap: 0.5em;
        margin-top: 0.5em;
      }
      .ok {
        font-weight: 600;
      }
      .confirms {
        display: block;
        width: 100%;
        height: 0.4em;
        margin-top: 0.35em;
        border: none;
        border-radius: 999px;
        overflow: hidden;
        background: var(--surface-card, var(--fb-card));
        accent-color: var(--brand, var(--fb-brand));
      }
      /* WebKit ignores accent-color on <progress>, so colour it directly. */
      .confirms::-webkit-progress-bar {
        background: var(--surface-card, var(--fb-card));
      }
      .confirms::-webkit-progress-value {
        background: var(--brand, var(--fb-brand));
      }
    `,
    ]; }
};
__decorate([
    property({ type: String })
], OpenAppsBuy.prototype, "rails", void 0);
__decorate([
    property({ type: String, attribute: "return-to" })
], OpenAppsBuy.prototype, "returnTo", void 0);
__decorate([
    state()
], OpenAppsBuy.prototype, "packages", void 0);
__decorate([
    state()
], OpenAppsBuy.prototype, "selected", void 0);
__decorate([
    state()
], OpenAppsBuy.prototype, "instruction", void 0);
__decorate([
    state()
], OpenAppsBuy.prototype, "topup", void 0);
__decorate([
    state()
], OpenAppsBuy.prototype, "waiting", void 0);
OpenAppsBuy = __decorate([
    customElement("openapps-buy")
], OpenAppsBuy);
export { OpenAppsBuy };
const RAIL_LABELS = {
    stripe: "Pay by card",
    ethereum: "Pay with USDC / USDT",
    lightning: "Pay with Lightning",
};
/**
 * How long to keep watching a top-up, per rail. `undefined` keeps the SDK's
 * 15-minute default.
 *
 * Ethereum credits only at the `finalized` tag, and finality is slower than
 * it first looks: an epoch is 6.4 minutes, and a block finalises two epochs
 * after the one containing it, so a transaction landing early in an epoch
 * can take ~19 minutes. Against the default the UI would stop watching a
 * payment that is merely still settling — the watcher credits it either
 * way, but the page would have already said it gave up. Stripe and
 * Lightning confirm in seconds and need no extension.
 */
const WAIT_TIMEOUT_MS = {
    stripe: undefined,
    lightning: undefined,
    ethereum: 30 * 60 * 1000,
};
function payloadOf(instruction) {
    if (instruction.kind === "address")
        return instruction.address;
    if (instruction.kind === "invoice")
        return instruction.bolt11;
    return "";
}
/** USD minor units → "$10.00". */
export function formatUsd(cents) {
    return `$${(cents / 100).toFixed(2)}`;
}
/**
 * Unit price, as "0.45¢ each".
 *
 * Three packs at three prices are not comparable by inspection — the whole
 * point of a larger pack is a lower unit cost, and that is the one number
 * the prices themselves do not show. Two decimals below a cent, one above,
 * so a realistic range stays readable without implying false precision.
 */
export function perCreditCost(pkg) {
    if (pkg.credits <= 0)
        return "";
    const cents = pkg.usd_price / pkg.credits;
    return `${cents < 1 ? cents.toFixed(2) : cents.toFixed(1)}¢ each`;
}
/** Token minor units → a decimal string, trailing zeros trimmed. */
export function formatUnits(amount, decimals) {
    const scale = 10 ** decimals;
    const value = amount / scale;
    return value.toFixed(decimals).replace(/\.?0+$/, "");
}
/** A timed-out wait is not a failed payment, and must not read like one. */
function describeWait(cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return message.includes("still pending")
        ? "Still waiting on the network. Your credits will appear once the payment settles."
        : message;
}
//# sourceMappingURL=openapps-buy.js.map