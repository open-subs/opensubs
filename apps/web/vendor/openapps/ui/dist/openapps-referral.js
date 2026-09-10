var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * `<openapps-referral>` — your invite link, and what it has earned.
 *
 * The server has carried referrals since the first migration, but nothing
 * ever showed a user their own code, so the feature was unreachable in
 * practice: a referral program nobody can see the link for does not run.
 *
 * Where the share link points, in order of precedence:
 *
 * 1. **The server**, when `app-id` names an app an operator registered a
 *    domain for. One place to correct a product's URL, and it takes effect
 *    without shipping a release of that product.
 * 2. **The `invite-url` attribute**, for an app that is not registered — or
 *    is running against a server that predates the registry.
 * 3. **The host page**, which is right for an ordinary web app: whichever
 *    app a user is in is the app they want to invite someone to.
 *
 * The fallback order matters most where (3) is actively wrong. Inside a
 * browser extension the host page is a `chrome-extension://…` URL, so a link
 * built from it resolves on nobody else's machine — an extension must set at
 * least one of the first two, or it will hand users a broken invite that
 * looks perfectly fine to whoever copied it.
 */
import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { OpenAppsElement } from "./base.js";
/** Unix seconds → "3 Aug". Dates here are context, not precision. */
function shortDate(seconds) {
    return new Date(seconds * 1000).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
    });
}
let OpenAppsReferral = class OpenAppsReferral extends OpenAppsElement {
    constructor() {
        super(...arguments);
        /**
         * Which product this is, e.g. `opencapture`. Lets the server return a link
         * on the app's own registered domain — see the class doc for precedence.
         */
        this.appId = "";
        this.info = null;
        this.earnings = null;
        this.referees = null;
        this.tab = "link";
        this.copied = false;
    }
    connectedCallback() {
        super.connectedCallback();
        void this.load();
    }
    onSessionChange() {
        // A notify may be the configure() that finally supplied a client, or a
        // sign-in — either way the code belongs to whoever is signed in now.
        void this.load();
    }
    async load() {
        const sdk = this.sdkOrNull;
        if (!sdk?.isLoggedIn) {
            this.info = null;
            this.earnings = null;
            this.referees = null;
            return;
        }
        this.info =
            (await this.run(() => sdk.referral.code(this.appId || undefined))) ?? null;
        this.earnings = (await this.run(() => sdk.referral.earnings())) ?? null;
        this.referees = (await this.run(() => sdk.referral.referees())) ?? null;
    }
    updated(changed) {
        // `app-id` decides which domain the server answers with, so a late or
        // changed one has to re-ask. Guarded on the property itself rather than
        // any render, or every state write from load() would re-enter it.
        if (changed.has("appId"))
            void this.load();
    }
    get link() {
        // Registered server-side: already a complete link with `?ref=` attached,
        // so appending anything here would double the parameter.
        if (this.info?.invite_url)
            return this.info.invite_url;
        const base = this.inviteUrl ??
            (typeof location === "undefined"
                ? ""
                : `${location.origin}${location.pathname}`);
        if (!this.info)
            return base;
        const join = base.includes("?") ? "&" : "?";
        return `${base}${join}ref=${encodeURIComponent(this.info.code)}`;
    }
    async copy() {
        try {
            await navigator.clipboard.writeText(this.link);
            this.copied = true;
            setTimeout(() => (this.copied = false), 2000);
        }
        catch {
            // Clipboard access is refused in plenty of ordinary situations —
            // insecure origins, an unfocused document. The link is on screen and
            // selectable, so this is not worth an error.
            this.error = "Could not copy. Select the link and copy it manually.";
        }
    }
    render() {
        if (!this.sdkOrNull)
            return html `<p class="muted">Loading…</p>`;
        if (!this.sdk.isLoggedIn) {
            return html `<p class="muted">Sign in to get your invite link.</p>`;
        }
        if (!this.info) {
            return html `<p class="muted">${this.error ?? "Loading…"}</p>`;
        }
        const people = this.referees?.referees ?? [];
        const rows = this.earnings?.entries ?? [];
        const tabs = [
            ["link", "Your link"],
            ["referees", `Referees${people.length ? ` (${people.length})` : ""}`],
            ["earnings", `Earnings${rows.length ? ` (${rows.length})` : ""}`],
        ];
        return html `
      <div class="stack">
        <div class="tabs" role="tablist">
          ${tabs.map(([id, label]) => html `
              <button
                role="tab"
                aria-selected=${this.tab === id}
                class="tab ${this.tab === id ? "on" : ""}"
                @click=${() => (this.tab = id)}
              >
                ${label}
              </button>
            `)}
        </div>
        ${this.tab === "link"
            ? this.renderLink()
            : this.tab === "referees"
                ? this.renderReferees(people)
                : this.renderEarnings(rows)}
        ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
      </div>
    `;
    }
    renderLink() {
        const total = this.earnings?.total ?? 0;
        const count = this.earnings?.entries.length ?? 0;
        return html `
      <p class="desc">
        Share this link. When someone signs up through it and buys credits,
        you earn <strong>${this.info?.bonus_percent}%</strong> of what they
        buy, as credits.
      </p>
      <code class="payload">${this.link}</code>
      <div class="row">
        <button @click=${this.copy}>${this.copied ? "Copied" : "Copy link"}</button>
        <span class="muted mono">${this.info?.code}</span>
      </div>
      <div class="earned">
        <span class="eyebrow">Earned</span>
        <span class="total mono">${total.toLocaleString()}</span>
        <span class="caption">
          ${count === 0
            ? "No referred purchases yet."
            : `credits from ${count} purchase${count === 1 ? "" : "s"}`}
        </span>
      </div>
    `;
    }
    renderReferees(people) {
        if (people.length === 0) {
            return html `<p class="muted">
        Nobody has signed up through your link yet.
      </p>`;
        }
        return html `
      <p class="caption">
        Handles only — signing up through a link does not share someone's
        identity with you.
      </p>
      <div class="list">
        ${people.map((p) => html `
            <div class="item">
              <span class="mono handle">${p.handle}</span>
              <span class="grow caption">
                joined ${shortDate(p.joined_at)} ·
                ${p.purchases === 0
            ? "no purchases yet"
            : `${p.purchases} purchase${p.purchases === 1 ? "" : "s"}`}
              </span>
              <span class="mono amount ${p.earned > 0 ? "good" : ""}">
                ${p.earned > 0 ? `+${p.earned.toLocaleString()}` : "—"}
              </span>
            </div>
          `)}
      </div>
    `;
    }
    renderEarnings(rows) {
        if (rows.length === 0) {
            return html `<p class="muted">
        No referral earnings yet. A bonus is credited when a referee's
        purchase settles.
      </p>`;
        }
        return html `
      <p class="caption">
        Each row is one bonus, credited in the same transaction as the
        referee's purchase — so this list and your balance cannot disagree.
      </p>
      <div class="list">
        ${rows.map((r) => html `
            <div class="item">
              <span class="mono date">${shortDate(r.created_at)}</span>
              <span class="grow caption">
                ${r.referee ?? "unknown"}
                ${r.referee_credits
            ? html ` bought ${r.referee_credits.toLocaleString()} credits`
            : nothing}
              </span>
              <span class="mono amount good">+${r.amount.toLocaleString()}</span>
            </div>
          `)}
      </div>
    `;
    }
    static { this.styles = [
        OpenAppsElement.baseStyles,
        css `
      .stack {
        display: grid;
        gap: 12px;
      }
      .row {
        display: flex;
        align-items: center;
        gap: 10px;
      }
      .tabs {
        display: flex;
        gap: 4px;
        border-bottom: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      /* Underline tabs sitting on the hairline, with a 2px near-black
         indicator — not a filled pill, and never a coloured bar. The
         indicator is drawn on the tab itself and pulled down over the rule
         so the selected tab reads as continuous with its panel. */
      .tab {
        border: none;
        border-bottom: 2px solid transparent;
        border-radius: 0;
        background: transparent;
        color: var(--text-muted, var(--fb-muted));
        margin-bottom: -1px;
        padding: 0 10px;
      }
      .tab.on {
        border-bottom-color: var(--text-strong, var(--fb-strong));
        color: var(--text-strong, var(--fb-strong));
      }
      .tab:hover:not(.on) {
        color: var(--text-strong, var(--fb-strong));
        background: transparent;
      }
      .list {
        display: grid;
        border: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        overflow: hidden;
      }
      .item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
      }
      .item + .item {
        border-top: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      .grow {
        flex: 1;
      }
      .date,
      .handle {
        font-size: var(--text-2xs, 11px);
        color: var(--text-faint, var(--fb-faint));
        min-width: 3.4em;
      }
      .amount {
        font-size: var(--text-sm, 13px);
        font-weight: var(--weight-medium, 500);
        color: var(--text-muted, var(--fb-muted));
      }
      .amount.good {
        color: var(--success-fg, #0b8a68);
      }
      .earned {
        display: grid;
        gap: 4px;
        padding: 14px 16px;
        border: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
        border-radius: var(--radius-lg, 12px);
        background: var(--surface-card, var(--fb-card));
      }
      /* A balance is a quantity, so it is mono — same rule as the credit
         badge and the ledger. */
      .total {
        font-size: var(--text-3xl, 40px);
        font-weight: var(--weight-medium, 500);
        line-height: 1;
        letter-spacing: var(--tracking-display, -0.035em);
        color: var(--text-strong, var(--fb-strong));
      }
    `,
    ]; }
};
__decorate([
    property({ type: String, attribute: "app-id" })
], OpenAppsReferral.prototype, "appId", void 0);
__decorate([
    property({ type: String, attribute: "invite-url" })
], OpenAppsReferral.prototype, "inviteUrl", void 0);
__decorate([
    state()
], OpenAppsReferral.prototype, "info", void 0);
__decorate([
    state()
], OpenAppsReferral.prototype, "earnings", void 0);
__decorate([
    state()
], OpenAppsReferral.prototype, "referees", void 0);
__decorate([
    state()
], OpenAppsReferral.prototype, "tab", void 0);
__decorate([
    state()
], OpenAppsReferral.prototype, "copied", void 0);
OpenAppsReferral = __decorate([
    customElement("openapps-referral")
], OpenAppsReferral);
export { OpenAppsReferral };
//# sourceMappingURL=openapps-referral.js.map