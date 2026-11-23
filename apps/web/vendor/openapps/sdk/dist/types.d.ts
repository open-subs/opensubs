/** Wire types, mirroring docs/api.md. */
export type Namespace = "eip155" | "nostr";
/**
 * Sign-ins that leave the page for the provider and come back with a
 * one-time code, rather than being signed in the page.
 */
/** Sign-ins that leave the page for the provider and come back. */
export type RedirectProvider = "google" | "github" | "apple" | "openwallet";
/** Login methods a given deployment has configured. */
export interface AuthMethods {
    google: boolean;
    /**
     * Answered for the host that asked: GitHub needs an OAuth app per
     * product, so it can be on for one product and off for another.
     */
    github: boolean;
    /** Sign in with Apple — offered alongside Google, as App Store
     *  guideline 4.8 requires of an app with a third-party sign-in. */
    apple?: boolean;
    /**
     * A 6-digit code sent to any email address. Answered per host, and false
     * until the operator switches it on — so a sign-in box shows it only
     * where a code can really be sent.
     */
    email?: boolean;
    /**
     * Sign in with OnWallet: OnWallet ID's OpenID Connect provider. The
     * person approves in the OnWallet browser extension. Absent on servers
     * from before it existed.
     */
    openwallet?: boolean;
    eip155: boolean;
    nostr: boolean;
}
/**
 * A proof-of-work challenge for an email code. Find a decimal `nonce` such
 * that SHA-256(`${salt}:${nonce}`) starts with `bits` zero bits, then hand
 * the whole thing back with the nonce. It costs a browser about a second
 * and a script sending thousands of codes a great deal more.
 */
export interface EmailPowChallenge {
    salt: string;
    bits: number;
    signature: string;
    expires_at: number;
}
export interface EmailPowSolution {
    salt: string;
    bits: number;
    signature: string;
    nonce: string;
}
/** A code is on its way. Hold `flow_id` for {@link OpenApps.auth.emailVerify}. */
export interface EmailStart {
    flow_id: string;
    /** Unix seconds; the code stops working then. */
    expires_at: number;
    /** Seconds before another code may be asked for. */
    resend_after: number;
    code_length: number;
}
/**
 * What `GET /v1/auth/methods` says about the deployment, beyond which
 * buttons to show.
 */
export interface AuthServerInfo {
    methods: AuthMethods;
    /**
     * Where to send someone who has no OnWallet extension. Configured on
     * the server, so every product links to the same place; `null` until the
     * operator sets it, and always `null` unless it is an `https:` URL.
     */
    openwallet_install_url: string | null;
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
     * What to show a person: the email for Google, `@handle` for GitHub,
     * the address or npub otherwise. `caip10` stays the stable key — an OIDC subject is not
     * something anyone recognises.
     */
    label?: string;
    /**
     * When it came onto this account (unix seconds): at sign-up, at a link,
     * or at the merge that brought it over. A method connected within
     * `Me.new_method_cooldown_secs` cannot yet be used to remove older ones.
     */
    connected_at?: number;
}
/**
 * Genesis membership, as the account holds it.
 *
 * It belongs to the account's linked OnWallet ID and is decided only by
 * what OnWallet ID says at sign-in — never by an address, an email or a
 * key. It holds however the person signs in afterwards.
 */
export interface Membership {
    genesis: true;
    /** The OnWallet identity that carries it, `openwallet:…`. */
    identity: string;
    /** When this account first held it (unix seconds). */
    since: number;
    /** The last OnWallet sign-in or link that confirmed it. */
    confirmed_at: number;
    /** What membership earns applies from this time. */
    benefits_from: number;
    /**
     * What to act on. False while an OnWallet ID that moved here from
     * another account serves its wait, or when the confirmation is too old.
     */
    benefits_active: boolean;
    /** The person should sign in with OnWallet again to keep the perks. */
    needs_confirmation: boolean;
}
/**
 * The Nostr keys an account has in view.
 *
 * Products use `linked` and nothing else: it is the key the person proved
 * by signing. `openwallet_claim` is the npub their OnWallet ID says it
 * has — for display, and never to sign in, to find an account, or to keep
 * data under.
 */
export interface NostrKeys {
    /** The account's Nostr sign-in, `npub1…`, or null. */
    linked: string | null;
    /** The npub the linked OnWallet ID shares, or null. */
    openwallet_claim: string | null;
    /** `"linked"` when the account has a Nostr sign-in; otherwise null. */
    in_use: "linked" | null;
    /** Both are present and they are different keys. */
    differs: boolean;
}
/**
 * What the server hands back to start a redirect link.
 *
 * `go` is a form to submit as a top-level navigation; the server binds the
 * link to the browser that posts it from one of its own pages. `auth_url`
 * is the older plain URL, which a server may refuse.
 */
export interface LinkStart {
    auth_url: string;
    go?: {
        url: string;
        method: "POST";
        fields: Record<string, string>;
    };
    /**
     * For OnWallet, where the server says in the request that this is a
     * connect: the six characters OnWallet will show for it. The same as
     * `Me.openwallet_connect_tag`.
     */
    account_tag?: string | null;
}
/** One sign-in method, as a refusal names it. */
export interface IdentitySummary {
    caip10: string;
    label: string;
}
/**
 * One entry of `detail.blocking` on a
 * `merge_blocked_by_duplicate_namespace` error: a kind of sign-in both
 * accounts hold, and which identity it is on each side.
 */
export interface BlockingSignIn {
    namespace: string;
    /** `Nostr`, `Google`, … */
    name: string;
    this_account: IdentitySummary | null;
    other_account: IdentitySummary | null;
    /** Products keep data under this kind of key; giving it up costs more
     *  than a way in. True for Nostr. */
    data_depends_on_it: boolean;
}
/**
 * A merge that has been asked for and is waiting. Nothing has moved; either
 * account can cancel until `effective_at`.
 */
export interface PendingMergeInfo {
    id: string;
    /**
     * `"absorbed"`: this account would be folded into another one.
     * `"survivor"`: this account asked, and would remain.
     */
    role: "absorbed" | "survivor";
    requested_at: number;
    /** When it happens unless cancelled (unix seconds). */
    effective_at: number;
    /** The sign-in method it was asked with, on the absorbed account only. */
    via: {
        caip10: string;
        namespace: string;
        name: string;
        label: string;
    } | null;
}
export interface LinkResult {
    ok: boolean;
    /**
     * The identity is on another, established account: combining the two was
     * recorded and will happen at `pending_merge.effective_at` unless either
     * account cancels. Nothing has moved, and `merged` is false.
     */
    merge_pending?: boolean;
    pending_merge?: {
        id: string;
        effective_at: number;
    };
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
/** What a Google or GitHub link redirect came back with. */
export type LinkRedirect = 
/**
 * The provider proved the identity; nothing is linked until this page
 * confirms it with `auth.confirmLink(code)`. Current servers answer only
 * with this; the other shapes are what older servers sent.
 */
{
    status: "pending";
    namespace: string;
    code: string;
} | {
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
    /** Merges waiting that name this account. Absent when there are none. */
    pending_merges?: PendingMergeInfo[];
    /** Genesis membership, or null. Absent on servers from before it. */
    membership?: Membership | null;
    /** Which Nostr key is in use. Absent on servers from before it. */
    nostr?: NostrKeys;
    /**
     * How long after a method is connected the older ones cannot be removed
     * (seconds). The new one can always be disconnected.
     */
    new_method_cooldown_secs?: number;
    /**
     * When this session's sign-in happened (unix seconds). Linking,
     * unlinking and deleting need a recent one; older sessions get
     * `reauth_required` and must sign in again first.
     */
    auth_time?: number;
    /**
     * The code OnWallet shows when this account connects an OnWallet ID:
     * six characters, upper case, digits and letters without I, L, O and U.
     * Show it beside "Connect OnWallet" so the person can compare the two
     * before approving. Present only on a server where OnWallet is
     * configured and a connect says what it is; absent otherwise.
     */
    openwallet_connect_tag?: string | null;
    /**
     * An OnWallet ID is connected and the account has no Genesis
     * membership. Which of two things the latest approval said:
     *
     * - `"not_shared"`: nothing. The person left the membership switch off
     *   in the wallet, so nobody knows whether they are a member. Say that
     *   nothing was shared and that connecting again with the switch on turns
     *   member perks on; do not say they are a member.
     * - `"not_member"`: OnWallet ID answered that this ID is not a member
     *   now. Say that, and nothing more: the same answer comes from someone
     *   who never was a member and someone who no longer is, so never word it
     *   as a membership that ended.
     *
     * Absent in every other case. Treat a value you do not know as absent.
     */
    membership_hint?: "not_shared" | "not_member";
}
/** One live session of the account, as `auth.sessions()` lists it. */
export interface SessionInfo {
    id: string;
    current: boolean;
    created_at: number;
    last_used_at: number;
    expires_at: number;
    auth_time: number;
    amr: string[];
    client: {
        user_agent?: string | null;
        origin?: string | null;
    } | null;
}
/** A security-relevant change to the account, from `auth.events()`. */
export interface AccountEvent {
    id: number;
    kind: string;
    detail: Record<string, unknown>;
    created_at: number;
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
        /** Present, and true, only on a server with USD₮0 enabled. */
        usdt0?: boolean;
    };
    /** The USD₮0 networks on offer. Absent unless the rail is enabled. */
    usdt0?: Usdt0Offer;
}
/**
 * USD₮0 (Tether's omnichain USD₮) as a server offers it.
 *
 * Issuer-freezable: Tether can freeze any address holding it, and the
 * server screens every deposit against Tether's blocklist before crediting.
 * Anything that offers this rail should show `notice`.
 */
export interface Usdt0Offer {
    /** "USD₮0". */
    token: string;
    issuer_freezable: true;
    notice: string;
    networks: Usdt0Network[];
}
export interface Usdt0Network {
    /** `arbitrum` | `plasma` | `stable` — what `usdt0DepositAddress` takes. */
    id: string;
    /** What the payer selects in their wallet, e.g. "Arbitrum One". */
    name: string;
    /** CAIP-2, e.g. `eip155:42161`. */
    chain: string;
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
export interface Usdt0Deposit {
    topup_id: string;
    network: string;
    network_name: string;
    /** CAIP-2, e.g. `eip155:42161`. */
    chain: string;
    address: string;
    /** Token minor units (6 decimals). */
    expected_amount: number;
    token: {
        symbol: string;
        contract: string;
        decimals: number;
    };
    issuer_freezable: true;
    notice: string;
    /** Null where the wait is for finality rather than a block count. */
    confirmations_required: number | null;
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
/**
 * Why an account has no member credits this month. Each is about the
 * caller's own account and the OnWallet ID it holds, never another one.
 */
export type NoGrantReason = "not_member" | "disabled" | "waiting_after_move" | "budget_exhausted" | "month_not_run" | "inactive";
/** This month's member credits, when they are on this account. */
export interface MemberGrant {
    /** The UTC calendar month, `"2026-11"`. */
    month: string;
    /** The level's name, as the operator configured it. */
    level: string;
    /** What the level is due, in credits. */
    nominal: number;
    /** What was granted, in credits. Less than `nominal` when scaled. */
    granted: number;
    /** The month's budget scaled this grant down. */
    scaled: boolean;
    /** The scale, in parts per million of `nominal`. */
    scale_ppm: number;
    /** What is left of it. */
    remaining: number;
    granted_at: number;
    /** When what is left lapses (unix seconds; 00:00 UTC on the 1st). */
    expires_at: number;
}
/**
 * What a balance is made of.
 *
 * A server with member credits off answers `{ balance }` and nothing else,
 * so every field but `balance` is optional: its absence means "this server
 * does not say", and a UI then shows the number alone.
 */
export interface CreditsBreakdown {
    /** Everything spendable now. */
    balance: number;
    /** Credits that never lapse: bought, a referral bonus, an adjustment. */
    purchased?: number;
    /** Member credits; they lapse at the end of their month. */
    granted?: number;
    /** When the soonest of them lapse, or null when there are none. */
    granted_expires_at?: number | null;
    /** Every lapse ahead, soonest first. */
    expiring?: {
        amount: number;
        expires_at: number;
    }[];
    /** This month's grant, or null. */
    member_grant?: MemberGrant | null;
    /** Null when there is a grant; otherwise why there is none. */
    no_grant_reason?: NoGrantReason | null;
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
/**
 * What agents a person approves in OnWallet may spend from this account's
 * credits through the /connect gateway (`GET /v1/me/delegation`).
 */
export interface Delegation {
    per_day_credits: number;
    per_run_credits: number;
    /** Delegated spending today (UTC): captured, plus holds still running. */
    used_today: number;
    /** Unix seconds when it was turned off, or null while it is on. */
    revoked_at: number | null;
}
export interface DelegationView {
    /** Whether the account has an OnWallet ID; without one nothing applies. */
    onwallet_linked: boolean;
    /** Null until it is set (connecting OnWallet sets the defaults). */
    delegation: Delegation | null;
    used_today: number;
    /** Spendable now: the balance less credits held for work under way. */
    balance: number;
    /** What a new delegation starts at: 200 a day, 50 a run. */
    defaults: {
        per_day_credits: number;
        per_run_credits: number;
    };
    /** 0.005: 200 credits is $1. */
    usd_per_credit: number;
}
//# sourceMappingURL=types.d.ts.map