var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * `<openapps-credits>` — the user's balance, kept current.
 *
 * Refreshes on session changes (so a login or a confirmed top-up updates it
 * without the host wiring anything) and, optionally, on a poll interval for
 * apps where credits are spent by a backend the page cannot observe.
 */
import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { OpenAppsElement } from "./base.js";
let OpenAppsCredits = class OpenAppsCredits extends OpenAppsElement {
    constructor() {
        super(...arguments);
        /** Seconds between background refreshes. 0 (the default) disables them. */
        this.pollSeconds = 0;
        /** Text shown before the label, e.g. "Balance". */
        this.label = "Credits";
        this.balance = null;
    }
    #timer;
    connectedCallback() {
        super.connectedCallback();
        void this.refresh();
        if (this.pollSeconds > 0) {
            this.#timer = setInterval(() => void this.refresh(), this.pollSeconds * 1000);
        }
    }
    disconnectedCallback() {
        if (this.#timer)
            clearInterval(this.#timer);
        super.disconnectedCallback();
    }
    onSessionChange() {
        void this.refresh();
    }
    /** Public so a host can force a refresh after spending credits itself. */
    async refresh() {
        // Reached before any client exists in two ordinary ways: the element
        // refreshes on connect, which on a plain HTML page happens before the
        // module script calls configure(); and a host may call this method
        // itself at any time. Touching `this.sdk` here would throw out of an
        // un-awaited promise, so read it defensively — with no client there is
        // simply no balance to show yet, and configure() notifies us to retry.
        const sdk = this.sdkOrNull;
        if (!sdk?.isLoggedIn) {
            this.balance = null;
            return;
        }
        const balance = await this.run(() => sdk.credits.balance());
        if (balance !== undefined)
            this.balance = balance;
    }
    render() {
        if (!this.sdkOrNull)
            return html `<span class="muted">…</span>`;
        if (!this.sdk.isLoggedIn)
            return html `<span class="muted">Not signed in</span>`;
        return html `
      <span class="wrap">
        <span class="label muted">${this.label}</span>
        <span class="value" aria-live="polite"
          >${this.balance === null ? "…" : this.balance.toLocaleString()}</span
        >
      </span>
      ${this.error ? html `<span class="error" role="alert">${this.error}</span>` : nothing}
    `;
    }
    static { this.styles = [
        OpenAppsElement.baseStyles,
        css `
      :host {
        display: inline-block;
      }
      .wrap {
        display: inline-flex;
        align-items: baseline;
        gap: 0.4em;
      }
      .label {
        font: var(--type-eyebrow, 500 12px/1.2 "Geist", system-ui, sans-serif);
        letter-spacing: var(--tracking-caps, 0.08em);
        text-transform: uppercase;
        color: var(--text-faint, var(--fb-faint));
      }
      /* A balance is a quantity, so it is set in mono. Tabular figures also
         stop the number jittering sideways as it ticks over on poll. */
      .value {
        font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
        font-variant-numeric: tabular-nums;
        font-weight: var(--weight-medium, 500);
        color: var(--text-strong, var(--fb-strong));
      }
    `,
    ]; }
};
__decorate([
    property({ type: Number, attribute: "poll-seconds" })
], OpenAppsCredits.prototype, "pollSeconds", void 0);
__decorate([
    property({ type: String })
], OpenAppsCredits.prototype, "label", void 0);
__decorate([
    state()
], OpenAppsCredits.prototype, "balance", void 0);
OpenAppsCredits = __decorate([
    customElement("openapps-credits")
], OpenAppsCredits);
export { OpenAppsCredits };
//# sourceMappingURL=openapps-credits.js.map