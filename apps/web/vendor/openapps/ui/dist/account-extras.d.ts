/**
 * The parts of `<openapps-account>` that most accounts never see: what a
 * member's balance is made of, the step before a Nostr link, what
 * disconnecting a member's OnWallet ID costs, and a refused link said in
 * parts.
 *
 * A module of its own, fetched on demand. `openapps-ui.js` is downloaded by
 * every page that uses any element, and its size is budgeted
 * (`build-bundle.mjs`); a few thousand members' credits and a refusal that
 * happens once in an account's life should not be paid for by every visitor
 * to every product. The element imports this when the account it is showing
 * could need it, or at the click that does.
 *
 * Functions, not a class: they draw from what they are handed and call back
 * through the handlers they are given. The element keeps all the state.
 */
import { nothing, type TemplateResult } from "lit";
import type { BlockingSignIn, CreditsBreakdown, DelegationView, IdentitySummary, LinkedAccount, Me, PendingMergeInfo } from "@openapps/sdk";
import { type OpenApps } from "@openapps/sdk";
import type { NostrKey } from "./wallet.js";
export { describe as describeError } from "./base.js";
/**
 * The Nostr key about to be linked, shown before anything is signed.
 *
 * `purpose` is which button was pressed: "Use my OnWallet Nostr key"
 * promises one particular key, so a different one answering stops there;
 * "Connect Nostr" promises nothing, so a different one is a warning.
 */
export interface NostrPreview {
    key: NostrKey;
    purpose: "connect" | "openwallet";
    /** The npub the account's OnWallet ID shares, if it has one. */
    claim: string | null;
}
/** Why a link was refused, in the parts the server sent. */
export type Refusal = {
    kind: "merge";
    blocking: BlockingSignIn[];
} | {
    kind: "taken";
    namespace: string;
    name: string;
    linked: IdentitySummary | null;
    offered: IdentitySummary | null;
};
/**
 * What the balance is made of, for an account that holds member credits
 * or is a member who could.
 *
 * Drawn only when the server says (`purchased` is in the answer); a server
 * with member credits off answers the one number and this is nothing.
 */
export declare function renderCredits(me: Me, credits: CreditsBreakdown | null, again?: () => void): TemplateResult;
/**
 * An account with no Nostr key whose OnWallet ID shares one: offer to
 * use it. The shared npub is only what is displayed — the link itself is
 * made by signing with the key.
 */
export declare function renderOpenwalletNostrOffer(claim: string, busy: boolean, use: () => void): TemplateResult;
/** The step before any Nostr link: this key will sign. */
export declare function renderNostrPreview(preview: NostrPreview, busy: boolean, error: string | null, on: {
    link: () => void;
    retry: () => void;
    cancel: () => void;
}): TemplateResult;
/**
 * Merges that are waiting. The account that would be absorbed is shown it
 * as what it is — someone has asked to take this account into theirs — with
 * the one button that matters. Nothing has moved while this is on screen.
 */
export declare function renderPendingMerges(merges: PendingMergeInfo[], busy: boolean, cancel: (id: string) => void): TemplateResult;
/** What disconnecting a member's OnWallet ID costs, before it is done. */
export declare function renderUnlinkConfirm(_account: LinkedAccount, granted: number, busy: boolean, on: {
    confirm: () => void;
    cancel: () => void;
}): TemplateResult;
/**
 * A link that cannot go through, said so that the person knows what is in
 * the way, on which side, and what giving it up costs.
 */
export declare function renderRefusal(refusal: Refusal): TemplateResult;
/**
 * A refusal the server words for developers, reworded for the person.
 * Anything not known here is passed through as it came.
 */
export declare function explained(error: unknown): unknown;
/** Said when the second signature of a merge comes from somewhere else. */
export declare const DIFFERENT_WALLET: () => string;
export declare const MERGE_CANCELLED: () => string;
/** After consenting to a merge that waits: it has not happened. */
export declare const mergeHeld: (effectiveAt: number) => string;
/** Before consenting to one: it will not happen at once. */
export declare const mergeWillWait: (secs: number) => string;
/** Said by the page and by the server's refusal alike. */
export declare const DIFFERENT_KEY: () => string;
/**
 * What agents may spend, for an account with an OnWallet ID — the only
 * accounts an agent can reach; nobody else makes the request. A failure
 * costs the section, never the panel.
 */
export declare function loadDelegation(sdk: OpenApps, me: Me): Promise<DelegationView | null>;
/**
 * What agents the person approves in OnWallet may spend from this account's
 * credits, through the /connect gateway. Connecting OnWallet sets 200
 * credits ($1) a day and 50 a run; the person changes or turns it off here
 * at any time.
 */
export declare function renderDelegation(element: unknown): TemplateResult | typeof nothing;
export declare const extrasStyles: import("lit").CSSResult;
//# sourceMappingURL=account-extras.d.ts.map