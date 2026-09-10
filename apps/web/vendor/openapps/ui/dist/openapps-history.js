var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * `<openapps-history>` — where the credits went.
 *
 * A balance answers "how many"; this answers "on what". The ledger already
 * records both halves of that — `app_id` says which product charged, and
 * `ref_id` is the reason string the app passed to `deduct` — so a spend is
 * nameable as "OpenCapture · watermark" rather than as a bare number.
 *
 * The summary describes exactly the entries that have been loaded, and says
 * so. Totalling a first page and labelling it "all time" would be a lie the
 * user cannot detect, and paginating an unbounded ledger to avoid that lie
 * would hang the element on a busy account.
 */
import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { OpenAppsElement } from "./base.js";
let OpenAppsHistory = class OpenAppsHistory extends OpenAppsElement {
    constructor() {
        super(...arguments);
        /** Entries fetched per page. */
        this.pageSize = 25;
        /**
         * Show only what this app charged. Give it an app id to turn the panel
         * from "your OpenApps spending" into "what you spent here", which is the
         * honest framing for an app that cannot see the others anyway.
         */
        this.appId = "";
        /** Hide the per-app totals and show only the entries. */
        this.noSummary = false;
        this.entries = [];
        this.cursor = null;
        /** True once the server has no more pages — the summary can say "all". */
        this.complete = false;
        this.loaded = false;
    }
    connectedCallback() {
        super.connectedCallback();
        void this.refresh();
    }
    onSessionChange() {
        void this.refresh();
    }
    /** Public so a host can refresh after spending credits itself. */
    async refresh() {
        this.entries = [];
        this.cursor = null;
        this.complete = false;
        this.loaded = false;
        await this.loadMore();
    }
    async loadMore() {
        // Same defensive read as the other elements: on a plain HTML page this
        // runs on connect, before the module script has called configure().
        const sdk = this.sdkOrNull;
        if (!sdk?.isLoggedIn) {
            this.loaded = true;
            return;
        }
        const page = await this.run(() => sdk.credits.history({
            cursor: this.cursor ?? undefined,
            limit: this.pageSize,
        }));
        this.loaded = true;
        if (!page)
            return;
        this.entries = [...this.entries, ...page.entries];
        this.cursor = page.next_cursor;
        // A null cursor is the server saying "that was the last page", which is
        // the only way to know the summary covers everything.
        this.complete = page.next_cursor === null;
    }
    /** Entries this element is willing to show, oldest-last as the API sends. */
    get visible() {
        if (!this.appId)
            return this.entries;
        return this.entries.filter((e) => e.app_id === this.appId);
    }
    /**
     * Spending grouped by what it bought, largest first.
     *
     * Debits only. A top-up is not somewhere credits went, and folding one in
     * as a negative would make the totals meaningless.
     */
    get spending() {
        const groups = new Map();
        for (const entry of this.visible) {
            if (entry.amount >= 0)
                continue;
            const label = spendLabel(entry);
            const existing = groups.get(label);
            if (existing) {
                existing.credits += -entry.amount;
                existing.count += 1;
            }
            else {
                groups.set(label, { label, credits: -entry.amount, count: 1 });
            }
        }
        return [...groups.values()].sort((a, b) => b.credits - a.credits);
    }
    render() {
        if (!this.sdkOrNull)
            return html `<p class="muted">Loading…</p>`;
        if (!this.sdk.isLoggedIn) {
            return html `<p class="muted">Sign in to see where your credits went.</p>`;
        }
        if (!this.loaded)
            return html `<p class="muted">Loading…</p>`;
        const entries = this.visible;
        if (entries.length === 0) {
            return html `
        <p class="muted">
          Nothing yet. Credits you buy and spend both appear here, with what
          each one was for.
        </p>
        ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
      `;
        }
        const spending = this.noSummary ? [] : this.spending;
        const spent = spending.reduce((sum, group) => sum + group.credits, 0);
        return html `
      ${spending.length
            ? html `
            <div class="summary">
              <div class="eyebrow">
                ${this.complete ? "Spent, all time" : "Spent, recent activity"}
              </div>
              <ul class="groups">
                ${spending.map((group) => html `
                    <li>
                      <span class="what" title=${group.label}>${group.label}</span>
                      <span class="times muted"
                        >${group.count === 1 ? "once" : `${group.count}×`}</span
                      >
                      <span class="mono amount">${group.credits.toLocaleString()}</span>
                      <!-- The bar is proportional to the largest row, not to
                           the total: with one dominant item every other bar
                           would round to nothing and the comparison people
                           actually want — this against that — disappears. -->
                      <span
                        class="bar"
                        style=${`--w:${Math.round((group.credits / spending[0].credits) * 100)}%`}
                      ></span>
                    </li>
                  `)}
              </ul>
              <p class="caption">
                ${spent.toLocaleString()} credits across ${entries.length}
                ${entries.length === 1 ? "entry" : "entries"}${this.complete
                ? ""
                : " so far"}.
              </p>
            </div>
          `
            : nothing}

      <div class="eyebrow rule">Activity</div>
      <ul class="entries">
        ${entries.map((entry) => html `
            <li>
              <span class="when muted">${formatDate(entry.created_at)}</span>
              <span class="what" title=${describeEntry(entry)}
                >${describeEntry(entry)}</span
              >
              <span class="mono amount ${entry.amount < 0 ? "debit" : "credit"}">
                ${entry.amount > 0 ? "+" : "−"}${Math.abs(entry.amount).toLocaleString()}
              </span>
              <span class="mono after muted" title="Balance after"
                >${entry.balance_after.toLocaleString()}</span
              >
            </li>
          `)}
      </ul>

      ${this.cursor !== null
            ? html `<button
            class="block"
            ?disabled=${this.busy}
            @click=${() => void this.loadMore()}
          >
            ${this.busy ? "Loading…" : "Show earlier"}
          </button>`
            : nothing}
      ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
    `;
    }
    static { this.styles = [
        OpenAppsElement.baseStyles,
        css `
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
      }
      .summary {
        display: grid;
        gap: 8px;
        margin-bottom: 18px;
      }
      /* Label, count, amount — then the bar spanning the full width beneath,
         so a long feature name never squeezes the figure it belongs to. */
      .groups li {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: baseline;
        gap: 8px;
        padding: 5px 0;
      }
      .groups .bar {
        grid-column: 1 / -1;
        height: 3px;
        border-radius: var(--radius-full, 999px);
        background: var(--brand-soft, #e6f9f3);
        width: var(--w, 0%);
        min-width: 2px;
      }
      .times {
        font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
      }
      .rule {
        display: block;
        padding-top: 12px;
        border-top: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      .entries li {
        display: grid;
        grid-template-columns: auto 1fr auto auto;
        align-items: baseline;
        gap: 10px;
        padding: 7px 0;
        border-bottom: var(--border-width, 1px) solid
          var(--border-hairline, var(--fb-hairline));
      }
      .entries li:last-child {
        border-bottom: none;
      }
      .when {
        font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
        white-space: nowrap;
      }
      /* A feature name is arbitrary text from whichever app charged; it
         truncates rather than pushing the amount off the panel. */
      .what {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--text-strong, var(--fb-strong));
        font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
      }
      .amount {
        font-weight: var(--weight-medium, 500);
        color: var(--text-strong, var(--fb-strong));
      }
      /* Spending is the ordinary case here, so it stays in the body colour;
         only money arriving is worth a tone. Colouring every debit red would
         make a working account look like a page of errors. */
      .amount.credit {
        color: var(--success-fg, #0b8a68);
      }
      .after {
        font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
        min-width: 3.5em;
        text-align: right;
      }
      button.block {
        margin-top: 12px;
      }
    `,
    ]; }
};
__decorate([
    property({ type: Number, attribute: "page-size" })
], OpenAppsHistory.prototype, "pageSize", void 0);
__decorate([
    property({ type: String, attribute: "app-id" })
], OpenAppsHistory.prototype, "appId", void 0);
__decorate([
    property({ type: Boolean, attribute: "no-summary" })
], OpenAppsHistory.prototype, "noSummary", void 0);
__decorate([
    state()
], OpenAppsHistory.prototype, "entries", void 0);
__decorate([
    state()
], OpenAppsHistory.prototype, "cursor", void 0);
__decorate([
    state()
], OpenAppsHistory.prototype, "complete", void 0);
__decorate([
    state()
], OpenAppsHistory.prototype, "loaded", void 0);
OpenAppsHistory = __decorate([
    customElement("openapps-history")
], OpenAppsHistory);
export { OpenAppsHistory };
/**
 * What a debit bought, as a label.
 *
 * `app_name` is the product and `ref_id` is the feature within it. Both can
 * be absent — an old entry predating app attribution, a reason an app never
 * set — so every combination degrades to something still true.
 */
export function spendLabel(entry) {
    const app = entry.app_name ?? entry.app_id ?? null;
    const feature = entry.ref_id ?? null;
    if (app && feature)
        return `${app} · ${feature}`;
    if (app)
        return app;
    if (feature)
        return feature;
    return "Spent";
}
/** A whole entry as one line of prose, spend or otherwise. */
export function describeEntry(entry) {
    switch (entry.kind) {
        case "debit":
            return spendLabel(entry);
        case "topup":
            return "Credits purchased";
        case "referral_bonus":
            return "Referral bonus";
        case "adjustment":
            // The reason is an operator's remark, written for this user to read.
            return entry.ref_id ? `Adjustment — ${entry.ref_id}` : "Adjustment";
        case "refund":
            // Negative: a payment was reversed and its credits taken back.
            // Positive: credits given back. Same kind, opposite events.
            return entry.amount < 0 ? "Payment reversed" : "Refund";
        default:
            return spendLabel(entry);
    }
}
/** Ledger timestamps are Unix seconds. */
export function formatDate(seconds) {
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime()))
        return "";
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
//# sourceMappingURL=openapps-history.js.map