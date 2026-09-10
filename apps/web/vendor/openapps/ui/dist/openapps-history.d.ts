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
import { type TemplateResult } from "lit";
import type { LedgerEntry } from "@openapps/sdk";
import { OpenAppsElement } from "./base.js";
export declare class OpenAppsHistory extends OpenAppsElement {
    /** Entries fetched per page. */
    pageSize: number;
    /**
     * Show only what this app charged. Give it an app id to turn the panel
     * from "your OpenApps spending" into "what you spent here", which is the
     * honest framing for an app that cannot see the others anyway.
     */
    appId: string;
    /** Hide the per-app totals and show only the entries. */
    noSummary: boolean;
    private entries;
    private cursor;
    /** True once the server has no more pages — the summary can say "all". */
    private complete;
    private loaded;
    connectedCallback(): void;
    protected onSessionChange(): void;
    /** Public so a host can refresh after spending credits itself. */
    refresh(): Promise<void>;
    private loadMore;
    /** Entries this element is willing to show, oldest-last as the API sends. */
    private get visible();
    /**
     * Spending grouped by what it bought, largest first.
     *
     * Debits only. A top-up is not somewhere credits went, and folding one in
     * as a negative would make the totals meaningless.
     */
    private get spending();
    render(): TemplateResult;
    static styles: import("lit").CSSResult[];
}
/**
 * What a debit bought, as a label.
 *
 * `app_name` is the product and `ref_id` is the feature within it. Both can
 * be absent — an old entry predating app attribution, a reason an app never
 * set — so every combination degrades to something still true.
 */
export declare function spendLabel(entry: LedgerEntry): string;
/** A whole entry as one line of prose, spend or otherwise. */
export declare function describeEntry(entry: LedgerEntry): string;
/** Ledger timestamps are Unix seconds. */
export declare function formatDate(seconds: number): string;
declare global {
    interface HTMLElementTagNameMap {
        "openapps-history": OpenAppsHistory;
    }
}
//# sourceMappingURL=openapps-history.d.ts.map