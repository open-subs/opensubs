/** Wire types, mirroring docs/api.md. */
export type Namespace = "eip155" | "nostr";
/** Login methods a given deployment has configured. */
export interface AuthMethods {
    google: boolean;
    eip155: boolean;
    nostr: boolean;
}
export interface Challenge {
    challenge_id: string;
    /** SIWE message, or a Nostr event template, depending on namespace. */
    message: string;
    expires_at: number;
}
export type Proof = {
    type: "signature";
    signature: string;
} | {
    type: "nostr_event";
    event: string;
};
export interface User {
    id: string;
    display_name: string | null;
    referral_code: string;
    /** Only present on the response that created the account. */
    new?: boolean;
}
export interface LoginResult {
    access_token: string;
    refresh_token: string;
    user: User;
}
export interface LinkedAccount {
    caip10: string;
    namespace: string;
    /**
     * What to show a person: the email for Google, the address or npub
     * otherwise. `caip10` stays the stable key — an OIDC subject is not
     * something anyone recognises.
     */
    label?: string;
}
export interface LinkResult {
    ok: boolean;
    caip10: string;
    /** True when another account was absorbed to make this link. */
    merged: boolean;
    absorbed_account?: string;
    credits_transferred?: number;
}
/** Detail attached to an `identity_belongs_to_another_account` error. */
export interface OtherAccount {
    id: string;
    balance: number;
}
/** What a Google link redirect came back with. */
export type LinkRedirect = {
    status: "linked";
    namespace: string;
    merged: boolean;
    credits: number;
}
/** The identity is on another account; retry the link with `merge: true`. */
 | {
    status: "conflict";
    namespace: string;
    balance: number;
}
/** Both accounts use the same sign-in methods; combining is impossible. */
 | {
    status: "blocked";
    namespaces: string[];
    message: string;
} | {
    status: "error";
    message: string;
};
export interface Me {
    id: string;
    display_name: string | null;
    referral_code: string;
    balance: number;
    linked_accounts: LinkedAccount[];
}
export interface CreditPackage {
    id: string;
    credits: number;
    /** USD minor units (cents). */
    usd_price: number;
}
export interface Packages {
    packages: CreditPackage[];
    rails: {
        stripe: boolean;
        ethereum: boolean;
        lightning: boolean;
    };
}
export type TopupStatus = "pending" | "confirmed" | "failed" | "expired";
export interface Topup {
    id: string;
    rail: string;
    asset: string;
    asset_amount: number;
    credits: number;
    status: TopupStatus;
    /**
     * Confirmations the matching on-chain deposit has accumulated.
     *
     * Absent until a deposit has actually been seen, which is the useful
     * signal in itself: present means "your payment arrived and is maturing",
     * absent means "nothing has landed yet".
     */
    confirmations?: number;
    /**
     * Confirmations needed before crediting. Null when the server waits for
     * finality instead, which is not a block count and so has no honest
     * "N of M" to show.
     */
    confirmations_required?: number | null;
    /** Transaction the deposit was seen in, once seen. */
    observed_tx?: string | null;
}
export interface StripeCheckout {
    checkout_url: string;
    topup_id: string;
}
export interface EthDeposit {
    topup_id: string;
    chain: string;
    address: string;
    /** Token minor units (6 decimals for USDC/USDT). */
    expected_amount: number;
    tokens: {
        usdc: string;
        usdt: string;
    };
}
export interface LightningInvoice {
    topup_id: string;
    bolt11: string;
    payment_hash: string;
    amount_msat: number;
    expires_at: number;
}
export interface LedgerEntry {
    id: number;
    /** Signed: positive added credits, negative spent them. */
    amount: number;
    /** `topup` | `debit` | `referral_bonus` | `adjustment` | `refund`. */
    kind: string;
    ref_type: string | null;
    /**
     * What it was for. On a debit this is the `reason` the app passed to
     * `deduct` — the feature name — which is the finest-grained answer to
     * "where did my credits go".
     */
    ref_id: string | null;
    /** Which app charged it. Null for top-ups, bonuses and adjustments. */
    app_id: string | null;
    /** That app's display name, so a UI need not keep its own lookup table. */
    app_name: string | null;
    balance_after: number;
    created_at: number;
}
export interface History {
    entries: LedgerEntry[];
    next_cursor: number | null;
}
export interface DeductResult {
    new_balance: number;
    ledger_id: number;
    /** True when this was a replay of an earlier identical request. */
    replay: boolean;
}
export interface ReferralCode {
    code: string;
    bonus_percent: number;
    /**
     * A ready-to-share link on the calling app's own domain, with `?ref=`
     * already attached — e.g. `https://opencapture.app/?ref=ABC123`.
     *
     * Only present when `referral.code()` was given an app id *and* an
     * operator registered a URL for it. `null` otherwise, which is the signal
     * to fall back to a link the client builds itself.
     */
    invite_url: string | null;
}
export interface ReferralEarnings {
    total: number;
    entries: {
        amount: number;
        topup_id: string | null;
        created_at: number;
        /**
         * Short handle of the referee whose purchase produced this bonus, so
         * the number can be reconciled against a person. Absent on rows the
         * server could not trace back to a top-up.
         */
        referee?: string | null;
        /** Credits that referee bought, which the bonus is a percentage of. */
        referee_credits?: number | null;
    }[];
}
/**
 * A referee as their referrer may see them.
 *
 * No name, no email, no full id: sharing a link does not entitle you to
 * learn who followed it. The handle is stable enough to tell two referees
 * apart and to match a bonus to a person, and nothing more.
 */
export interface Referees {
    referees: {
        handle: string;
        joined_at: number;
        purchases: number;
        earned: number;
    }[];
}
//# sourceMappingURL=types.d.ts.map