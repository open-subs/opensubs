/**
 * `<openapps-credits>` — the user's balance, kept current.
 *
 * Refreshes on session changes (so a login or a confirmed top-up updates it
 * without the host wiring anything) and, optionally, on a poll interval for
 * apps where credits are spent by a backend the page cannot observe.
 */
import { type TemplateResult } from "lit";
import { OpenAppsElement } from "./base.js";
export declare class OpenAppsCredits extends OpenAppsElement {
    #private;
    /** Seconds between background refreshes. 0 (the default) disables them. */
    pollSeconds: number;
    /** Text shown before the label, e.g. "Balance". */
    label: string;
    private balance;
    connectedCallback(): void;
    disconnectedCallback(): void;
    protected onSessionChange(): void;
    /** Public so a host can force a refresh after spending credits itself. */
    refresh(): Promise<void>;
    render(): TemplateResult;
    static styles: import("lit").CSSResult[];
}
declare global {
    interface HTMLElementTagNameMap {
        "openapps-credits": OpenAppsCredits;
    }
}
//# sourceMappingURL=openapps-credits.d.ts.map