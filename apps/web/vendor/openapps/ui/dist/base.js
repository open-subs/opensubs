var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * Shared base for every OpenApps element: client resolution, session
 * subscription, and one visual language.
 *
 * Styles live in shadow DOM, so a host page's CSS cannot break them and
 * they cannot leak out. Everything themable is a custom property, which
 * *does* pierce the shadow boundary — that is the intended seam for hosts.
 */
import { LitElement, css } from "lit";
import { property, state } from "lit/decorators.js";
import { OpenAppsError } from "@openapps/sdk";
import { onChange, resolveClient } from "./context.js";
export class OpenAppsElement extends LitElement {
    constructor() {
        super(...arguments);
        this.error = null;
        this.busy = false;
    }
    #unsubscribe;
    connectedCallback() {
        super.connectedCallback();
        this.#unsubscribe = onChange(() => this.onSessionChange());
    }
    disconnectedCallback() {
        this.#unsubscribe?.();
        super.disconnectedCallback();
    }
    /** Overridden by elements that display session-dependent data. */
    onSessionChange() {
        this.requestUpdate();
    }
    get sdk() {
        return resolveClient(this.client, this.baseUrl);
    }
    /**
     * The client, or null if the host has not configured one yet.
     *
     * Rendering must never throw for this reason. A plain HTML page has the
     * elements in its markup and calls `configure()` from a module script
     * afterwards, so there is a window where no client exists — and
     * `configure()` calls `notify()`, which re-renders everything, so the
     * right move is to draw nothing and wait.
     */
    get sdkOrNull() {
        try {
            return this.sdk;
        }
        catch {
            return null;
        }
    }
    /**
     * Run an action with the busy flag set and errors turned into a message.
     * Elements never surface a raw exception: a user staring at a buy button
     * needs a sentence, not a stack trace.
     */
    async run(action) {
        this.error = null;
        this.busy = true;
        try {
            return await action();
        }
        catch (cause) {
            if (cause instanceof Error && cause.name === "AbortError")
                return undefined;
            this.error = describe(cause);
            return undefined;
        }
        finally {
            this.busy = false;
        }
    }
    emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }
    /**
     * Shared styles, expressed in OpenApps design tokens.
     *
     * Every value reads a semantic token with a literal fallback. The token
     * wins whenever the host has linked `@openapps/tokens`, which is what
     * keeps a themed application in control of the palette; the fallback is
     * what stops an element that was dropped into a page with no stylesheet
     * from rendering unstyled.
     *
     * Tokens are referenced at the semantic layer only — `--surface-card`,
     * never `--gray-50`. Naming a ramp entry inside a component is what makes
     * a design system un-reskinnable.
     */
    static { this.baseStyles = css `
    :host {
      /* Fallback palette: the design system's light values, inlined. */
      --fb-card: #ffffff;
      --fb-subtle: #f8f8f7;
      --fb-hairline: #deded9;
      --fb-strong: #020202;
      --fb-body: #3d3d3d;
      --fb-muted: #656565;
      --fb-faint: #7c7c7c;
      --fb-brand: #00c896;
      --fb-selected: #e6f9f3;
      --fb-danger: #b3261e;

      display: block;
      font: var(--type-body, 400 15px/1.45 "Geist", system-ui, sans-serif);
      letter-spacing: var(--tracking-body, -0.005em);
      color: var(--text-body, var(--fb-body));
    }

    /* Only the *fallbacks* follow the OS. Once tokens are linked, dark mode
       is the host's decision via the oa-auto / oa-dark classes, and a
       component running its own media query would sit stubbornly light
       inside a host that had deliberately forced dark. */
    @media (prefers-color-scheme: dark) {
      :host {
        --fb-card: #1a1a1a;
        --fb-subtle: #1a1a1a;
        --fb-hairline: rgba(255, 255, 255, 0.1);
        --fb-strong: #ffffff;
        --fb-body: rgba(255, 255, 255, 0.7);
        --fb-muted: rgba(255, 255, 255, 0.6);
        --fb-faint: rgba(255, 255, 255, 0.4);
        --fb-selected: #10312a;
        --fb-danger: #ff4d4d;
      }
    }

    /* ---- The SDK frame ----
       One card, capped at --sdk-max. It never assumes a page, so it drops
       into a modal, a settings pane, a phone screen or a route unchanged. */
    .panel {
      width: 100%;
      max-width: var(--sdk-max, 420px);
      background: var(--surface-card, var(--fb-card));
      border: var(--border-width, 1px) solid
        var(--border-hairline, var(--fb-hairline));
      border-radius: var(--radius-xl, 16px);
      box-shadow: var(--shadow-md, 0 4px 12px rgba(0, 0, 0, 0.08));
      overflow: hidden;
      box-sizing: border-box;
    }

    .panel.wide {
      max-width: var(--sdk-wide, 560px);
    }

    .head {
      display: grid;
      gap: 8px;
      padding: 24px 24px 0;
    }

    .title {
      margin: 0;
      font: var(--weight-medium, 500) var(--text-xl, 24px) / 1.2
        var(--font-display, "Geist", system-ui, sans-serif);
      letter-spacing: var(--tracking-heading, -0.02em);
      color: var(--text-strong, var(--fb-strong));
    }

    .desc {
      margin: 0;
      font: var(--type-body, 400 15px/1.45 "Geist", system-ui, sans-serif);
      color: var(--text-muted, var(--fb-muted));
    }

    .body {
      display: grid;
      gap: 14px;
      padding: 24px;
    }

    /* A labelled rule, for "or" between a provider row and the rest. */
    .divider {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .divider::before,
    .divider::after {
      content: "";
      flex: 1;
      height: 1px;
      background: var(--border-hairline, var(--fb-hairline));
    }

    .caption {
      margin: 0;
      font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
      color: var(--text-faint, var(--fb-faint));
    }

    .eyebrow {
      font: var(--type-eyebrow, 500 12px/1.2 "Geist", system-ui, sans-serif);
      letter-spacing: var(--tracking-caps, 0.08em);
      text-transform: uppercase;
      color: var(--text-faint, var(--fb-faint));
    }

    /* The O monogram on a squircle. No logo was ever supplied, so the mark
       is typographic by design: legible at 16px, works in one colour, and
       re-skins from the --logo-* tokens without redrawing anything. */
    .mark {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border-radius: var(--logo-tile-radius, 0.22em);
      background: var(--logo-tile-bg, var(--fb-strong));
      color: var(--logo-tile-fg, var(--fb-brand));
      font: var(--weight-medium, 500) 18px / 1
        var(--font-display, "Geist", system-ui, sans-serif);
      letter-spacing: var(--logo-tracking, -0.04em);
      user-select: none;
    }

    /* A value the user is meant to copy: an address, an invoice, a link.
       Shared because three elements render one and a fourth will. */
    .payload {
      display: block;
      overflow-wrap: anywhere;
      padding: 0.6em;
      border: var(--border-width, 1px) solid
        var(--border-hairline, var(--fb-hairline));
      border-radius: var(--radius-lg, 12px);
      background: var(--bg-subtle, var(--fb-subtle));
      font: var(--type-mono, 400 13px/1.5 ui-monospace, monospace);
      color: var(--text-body, var(--fb-body));
    }

    /* ---- Badge ----
       A read-only status pill. Never given a click handler: a badge that
       does something is a control wearing a status's clothes. */
    .badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 22px;
      padding: 0 8px;
      border-radius: var(--radius-full, 999px);
      font: var(--weight-medium, 500) var(--text-xs, 12px) / 1
        var(--font-sans, "Geist", system-ui, sans-serif);
      white-space: nowrap;
      background: var(--bg-sunken, #f2f2f2);
      color: var(--text-muted, var(--fb-muted));
    }

    .badge.success {
      background: var(--success-bg, #e6f9f3);
      color: var(--success-fg, #0b8a68);
    }

    .badge.danger {
      background: var(--danger-bg, #fdecea);
      color: var(--danger-fg, var(--fb-danger));
    }

    .badge.brand {
      background: var(--brand-soft, #e6f9f3);
      color: var(--text-brand, var(--fb-brand));
    }

    /* Inherits the pill's colour, so a tone change carries the dot with it. */
    .badge .dot {
      width: 5px;
      height: 5px;
      border-radius: var(--radius-full, 999px);
      background: currentColor;
    }

    /* ---- Field ----
       Label, control, hint. Focus is a near-black border plus the offset
       ring — never a coloured glow, and never a removed outline. */
    .field {
      display: grid;
      gap: 6px;
    }

    .field label {
      font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
      color: var(--text-strong, var(--fb-strong));
    }

    .field input {
      width: 100%;
      box-sizing: border-box;
      min-height: var(--control-h-md, 36px);
      padding: 0 12px;
      border: var(--border-width, 1px) solid
        var(--border-hairline, var(--fb-hairline));
      border-radius: var(--radius-md, 8px);
      background: var(--surface-card, var(--fb-card));
      color: var(--text-strong, var(--fb-strong));
      font: var(--type-body, 400 15px/1.45 "Geist", system-ui, sans-serif);
      letter-spacing: inherit;
    }

    .field input::placeholder {
      color: var(--text-faint, var(--fb-faint));
    }

    .field input:focus-visible {
      border-color: var(--text-strong, var(--fb-strong));
      box-shadow: var(--focus-ring, 0 0 0 2px #f2f2f2, 0 0 0 4px #020202);
    }

    .field .hint {
      font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
      color: var(--text-faint, var(--fb-faint));
    }

    /* Anything numeric — balances, prices, per-unit rates, ledger amounts. */
    .mono {
      font-family: var(--font-mono, "Geist Mono", ui-monospace, monospace);
      font-variant-numeric: tabular-nums;
    }

    /* ---- Controls ----
       Height comes from the platform tokens, which re-point themselves under
       a pointer:coarse media query, so touch targets clear 44px with no
       mobile-specific variant here. */
    button {
      font: var(--type-ui, 500 13px/1.3 "Geist", system-ui, sans-serif);
      letter-spacing: inherit;
      cursor: pointer;
      min-height: var(--control-h-md, 36px);
      padding: 0 14px;
      border-radius: var(--radius-md, 8px);
      border: var(--border-width, 1px) solid
        var(--border-hairline, var(--fb-hairline));
      background: var(--surface-card, var(--fb-card));
      color: var(--text-strong, var(--fb-strong));
      transition: var(--transition-control, all 120ms cubic-bezier(0.2, 0, 0, 1));
    }

    button:hover:not([disabled]) {
      background: var(--surface-hover, rgba(0, 0, 0, 0.04));
    }

    /* The whole press feedback is half a pixel. Nothing scales. */
    button:active:not([disabled]) {
      transform: translateY(0.5px);
    }

    button.primary {
      background: var(--brand, var(--fb-brand));
      border-color: var(--brand, var(--fb-brand));
      color: var(--brand-contrast, #020202);
    }

    button.primary:hover:not([disabled]) {
      background: var(--brand-soft, #1ad3a5);
    }

    button.ghost {
      background: transparent;
      border-color: transparent;
    }

    button.block {
      width: 100%;
      justify-content: center;
    }

    button[disabled] {
      opacity: 0.45;
      cursor: not-allowed;
    }

    /* A ring, never a glow, and never removed. */
    :focus-visible {
      outline: none;
      box-shadow: var(--focus-ring, 0 0 0 2px #f2f2f2, 0 0 0 4px #020202);
    }

    a {
      color: var(--text-link, var(--fb-strong));
      text-decoration: none;
      text-underline-offset: 3px;
    }

    a:hover {
      text-decoration: underline;
    }

    .error {
      color: var(--danger-fg, var(--fb-danger));
      font: var(--type-caption, 400 12px/1.35 "Geist", system-ui, sans-serif);
      margin-top: 0.5em;
    }

    .muted {
      color: var(--text-muted, var(--fb-muted));
    }
  `; }
}
__decorate([
    property({ type: String, attribute: "base-url" })
], OpenAppsElement.prototype, "baseUrl", void 0);
__decorate([
    property({ attribute: false })
], OpenAppsElement.prototype, "client", void 0);
__decorate([
    state()
], OpenAppsElement.prototype, "error", void 0);
__decorate([
    state()
], OpenAppsElement.prototype, "busy", void 0);
/** Turn anything thrown into a sentence a user can act on. */
export function describe(cause) {
    if (cause instanceof OpenAppsError) {
        switch (cause.code) {
            case "unauthorized":
                return "Please sign in again.";
            case "insufficient_balance":
                return cause.balance === undefined
                    ? "Not enough credits."
                    : `Not enough credits — you have ${cause.balance}.`;
            case "rate_limited":
                return "Too many attempts. Please wait a moment and try again.";
            case "network":
                return "Could not reach the server. Check your connection.";
            case "timeout":
                return "This is taking longer than expected. It may still complete.";
            default:
                return cause.message;
        }
    }
    return cause instanceof Error ? cause.message : String(cause);
}
//# sourceMappingURL=base.js.map