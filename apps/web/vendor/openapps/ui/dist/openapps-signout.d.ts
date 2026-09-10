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
import { nothing, type TemplateResult } from "lit";
import { OpenAppsElement } from "./base.js";
export declare class OpenAppsSignout extends OpenAppsElement {
    label: string;
    private signedIn;
    connectedCallback(): void;
    /** Public so a host that changes the session by some other route can
     * say so; `onChange` already covers every route the elements own. */
    refresh(): void;
    protected onSessionChange(): void;
    private signOut;
    render(): TemplateResult | typeof nothing;
    static styles: import("lit").CSSResult[];
}
declare global {
    interface HTMLElementTagNameMap {
        "openapps-signout": OpenAppsSignout;
    }
}
//# sourceMappingURL=openapps-signout.d.ts.map