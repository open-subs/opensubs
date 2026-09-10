var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
/**
 * `<openapps-signout>` — leaving your account, the same way everywhere.
 *
 * Sign-out used to live on `<openapps-login>`, which meant an app that
 * could not mount that element — anything whose window holds unsaved
 * work, since its Google button navigates the whole page away — showed a
 * signed-in account with no way to leave it. One product hand-rolled a
 * button to work around that; another simply had none.
 *
 * Moving it onto `<openapps-account>` fixed *whether* it exists but not
 * *where*: that element renders the identity card, which belongs at the
 * top of an account screen, while the action that ends a session belongs
 * at the bottom — after the balance and the purchase options, not beside
 * them. An element cannot place itself relative to siblings its host
 * owns. So it became its own element: the host decides where, the
 * platform decides what it looks like and what it does.
 *
 * Renders nothing at all when nobody is signed in, so a host can place it
 * unconditionally rather than tracking session state to decide.
 */
import { css, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { OpenAppsElement } from "./base.js";
import { notify } from "./context.js";
let OpenAppsSignout = class OpenAppsSignout extends OpenAppsElement {
    constructor() {
        super(...arguments);
        this.label = "Sign out";
        this.signedIn = false;
    }
    connectedCallback() {
        super.connectedCallback();
        this.refresh();
    }
    /** Public so a host that changes the session by some other route can
     * say so; `onChange` already covers every route the elements own. */
    refresh() {
        this.signedIn = this.sdkOrNull?.isLoggedIn ?? false;
    }
    onSessionChange() {
        this.refresh();
    }
    async signOut() {
        await this.run(() => this.sdk.auth.logout());
        this.signedIn = false;
        this.emit("openapps-logout", null);
        // Tells every other element on the page to re-read: a balance still
        // showing a number after you signed out is worse than a blank one.
        notify();
    }
    render() {
        if (!this.signedIn)
            return nothing;
        return html `
      <button ?disabled=${this.busy} @click=${this.signOut}>${this.label}</button>
      ${this.error ? html `<p class="error" role="alert">${this.error}</p>` : nothing}
    `;
    }
    static { this.styles = [
        OpenAppsElement.baseStyles,
        css `
      /* Full width and quiet. Nobody opens an account screen in order to
         sign out, and it is the one control there that ends a session —
         so it should be easy to find and hard to hit by accident. */
      button {
        display: block;
        width: 100%;
        font-size: 0.875rem;
        padding: 9px 12px;
        border-radius: var(--radius-md, 8px);
        border: 1px solid var(--border-hairline, var(--fb-hairline));
        background: transparent;
        color: var(--text-muted, var(--fb-muted));
        cursor: pointer;
      }
      button:hover:not(:disabled) {
        color: var(--text-strong, var(--fb-strong));
        border-color: var(--text-muted, var(--fb-muted));
      }
    `,
    ]; }
};
__decorate([
    property({ type: String })
], OpenAppsSignout.prototype, "label", void 0);
__decorate([
    state()
], OpenAppsSignout.prototype, "signedIn", void 0);
OpenAppsSignout = __decorate([
    customElement("openapps-signout")
], OpenAppsSignout);
export { OpenAppsSignout };
//# sourceMappingURL=openapps-signout.js.map