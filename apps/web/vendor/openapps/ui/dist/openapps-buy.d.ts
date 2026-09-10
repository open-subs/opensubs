/**
 * `<openapps-buy>` — pick a package, pick a rail, pay, get credits.
 *
 * The three rails look different to the user but share one shape: start the
 * top-up, then watch its status. Nothing here decides whether a payment
 * succeeded — the server does that from a webhook, a chain log, or a
 * Lightning settlement, and this element only polls `waitFor`.
 */
import { type TemplateResult } from "lit";
import type { CreditPackage } from "@openapps/sdk";
import { OpenAppsElement } from "./base.js";
export declare class OpenAppsBuy extends OpenAppsElement {
    #private;
    /** Restrict the offered rails, e.g. `rails="lightning,stripe"`. */
    rails: string;
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
    returnTo: string;
    private packages;
    private selected;
    private instruction;
    private topup;
    private waiting;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected onSessionChange(): void;
    private load;
    /** Rails the server has enabled, intersected with the `rails` attribute. */
    private get offeredRails();
    private start;
    private watch;
    private reset;
    render(): TemplateResult;
    private renderPackages;
    private renderRails;
    private renderInstruction;
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
    private renderWaiting;
    private copy;
    static styles: import("lit").CSSResult[];
}
/** USD minor units → "$10.00". */
export declare function formatUsd(cents: number): string;
/**
 * Unit price, as "0.45¢ each".
 *
 * Three packs at three prices are not comparable by inspection — the whole
 * point of a larger pack is a lower unit cost, and that is the one number
 * the prices themselves do not show. Two decimals below a cent, one above,
 * so a realistic range stays readable without implying false precision.
 */
export declare function perCreditCost(pkg: CreditPackage): string;
/** Token minor units → a decimal string, trailing zeros trimmed. */
export declare function formatUnits(amount: number, decimals: number): string;
declare global {
    interface HTMLElementTagNameMap {
        "openapps-buy": OpenAppsBuy;
    }
}
//# sourceMappingURL=openapps-buy.d.ts.map