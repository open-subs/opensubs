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
import { type PropertyValues, type TemplateResult } from "lit";
import { OpenAppsElement } from "./base.js";
export declare class OpenAppsReferral extends OpenAppsElement {
    /**
     * Which product this is, e.g. `opencapture`. Lets the server return a link
     * on the app's own registered domain — see the class doc for precedence.
     */
    appId: string;
    /**
     * Where invited people should land, when the server has no registration
     * for `app-id`. Defaults to the current page, minus any query or fragment
     * — a link built from a URL that already carried `?ref=` would otherwise
     * compound one code onto another.
     */
    inviteUrl?: string;
    private info;
    private earnings;
    private referees;
    private tab;
    private copied;
    connectedCallback(): void;
    protected onSessionChange(): void;
    private load;
    protected updated(changed: PropertyValues<this>): void;
    private get link();
    private copy;
    render(): TemplateResult;
    private renderLink;
    private renderReferees;
    private renderEarnings;
    static styles: import("lit").CSSResult[];
}
declare global {
    interface HTMLElementTagNameMap {
        "openapps-referral": OpenAppsReferral;
    }
}
//# sourceMappingURL=openapps-referral.d.ts.map