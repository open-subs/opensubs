import { type Session, type TokenStore } from "./storage.js";
import type { AuthMethods, Challenge, CreditPackage, DeductResult, EthDeposit, History, LightningInvoice, LinkRedirect, LinkResult, LoginResult, Me, Namespace, Packages, Proof, ReferralCode, Referees, ReferralEarnings, StripeCheckout, Topup } from "./types.js";
/** Fetch implementations differ across runtimes; only this shape is used. */
type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
export interface OpenAppsOptions {
    /** The server's public URL, e.g. `https://accounts.example.com`. */
    baseUrl: string;
    /**
     * `oa_live_…` app key. Required only for `credits.deduct`, which acts on
     * behalf of a user and must therefore identify the calling app. Never ship
     * one in a public client you do not control.
     */
    appKey?: string;
    /** Defaults to `localStorage` in browsers, memory elsewhere. */
    store?: TokenStore;
    /** Override for tests, proxies, or non-standard runtimes. */
    fetch?: FetchLike;
    /** Fires whenever the session appears, changes, or is dropped. */
    onAuthChange?: (session: Session | null) => void;
}
export declare class OpenApps {
    #private;
    readonly baseUrl: string;
    constructor(options: OpenAppsOptions);
    get session(): Session | null;
    get isLoggedIn(): boolean;
    /** Adopt a session obtained elsewhere (an OAuth redirect, another tab). */
    adoptSession(accessToken: string, refreshToken: string): void;
    /** Drop local tokens without calling the server. */
    clearSession(): void;
    auth: {
        /**
         * Which login methods this server can actually complete. Google needs
         * credentials the deployment may not have, and wallet/Nostr can each be
         * switched off, so a sign-in UI should ask rather than assume.
         */
        methods: (signal?: AbortSignal) => Promise<AuthMethods>;
        /** Step 1 of wallet/Nostr login: get something to sign. */
        challenge: (namespace: Namespace, address?: string, signal?: AbortSignal) => Promise<Challenge>;
        /**
         * Step 2: hand back the signed proof. Establishes the session, so
         * everything afterwards is authenticated automatically.
         */
        verify: (challengeId: string, proof: Proof, options?: {
            referralCode?: string;
            signal?: AbortSignal;
        }) => Promise<LoginResult>;
        /**
         * Where to send the browser for Google sign-in.
         *
         * Pass `returnTo` and the server redirects back there afterwards with a
         * one-time code, which {@link completeRedirect} turns into a session.
         * Omit it and the callback answers with JSON instead — what a native
         * shell or extension wants, since neither has a page to return to.
         *
         * The URL must be on an origin in the server's `allowed_origins`, or
         * the request is refused: that check is what stops the flow being used
         * as an open redirect.
         */
        googleStartUrl: (returnTo?: string, referralCode?: string) => string;
        /**
         * Finish a redirect sign-in: exchange the `#code=…` fragment for a
         * session and clear it from the URL.
         *
         * Safe to call on every page load — it returns `null` when there is no
         * code, so a page can call it unconditionally at startup. Concurrent
         * calls share one exchange, because a framework that double-invokes
         * effects would otherwise spend the code on the first call and fail the
         * second.
         */
        completeRedirect: (options?: {
            url?: string;
            hash?: string;
            signal?: AbortSignal;
        }) => Promise<LoginResult | null>;
        me: (signal?: AbortSignal) => Promise<Me>;
        /** Revoke the session server-side, then forget it locally. */
        logout: (signal?: AbortSignal) => Promise<void>;
        linkChallenge: (namespace: Namespace, address?: string, signal?: AbortSignal) => Promise<Challenge>;
        /**
         * Attach a verified identity to the signed-in account.
         *
         * If that identity already belongs to a *different* account, this
         * throws `identity_belongs_to_another_account` rather than guessing —
         * `error.detail.other_account` carries its id and balance so you can
         * ask the user before combining. Retry with `{ merge: true }` to
         * absorb it: the other account's credits, top-up history, deposit
         * addresses and referral earnings all move across, and its sessions
         * are revoked.
         */
        linkVerify: (challengeId: string, proof: Proof, options?: {
            merge?: boolean;
            signal?: AbortSignal;
        }) => Promise<LinkResult>;
        /**
         * Begin connecting Google to the account already signed in here.
         *
         * Wallet and Nostr link by signing in the page; Google needs a full
         * redirect, which carries no bearer token — so this authenticated call
         * records the intent first and hands back a URL to navigate to. On
         * return, {@link completeLinkRedirect} reports what happened.
         *
         * Throws `identity_belongs_to_another_account` semantics via the
         * redirect rather than here: the conflict is only discovered after
         * Google has verified the identity, so it comes back in the fragment
         * and you re-run this with `{ merge: true }`.
         */
        googleLinkStart: (returnTo: string, options?: {
            merge?: boolean;
            signal?: AbortSignal;
        }) => Promise<string>;
        /**
         * Read the outcome of a Google link out of the URL fragment and clear
         * it. Returns `null` when this was not a link redirect, so a page can
         * call it unconditionally on load.
         */
        completeLinkRedirect: (options?: {
            url?: string;
            hash?: string;
        }) => LinkRedirect | null;
        unlink: (caip10: string, signal?: AbortSignal) => Promise<{
            ok: boolean;
        }>;
    };
    credits: {
        balance: (signal?: AbortSignal) => Promise<number>;
        /**
         * Charge the logged-in user for something this app did.
         *
         * `idempotencyKey` must be stable for one logical operation: retry the
         * same call with the same key after a timeout and the user is charged
         * once, with the original result returned.
         */
        deduct: (amount: number, reason: string, idempotencyKey: string, signal?: AbortSignal) => Promise<DeductResult>;
        history: (options?: {
            cursor?: number;
            limit?: number;
            signal?: AbortSignal;
        }) => Promise<History>;
    };
    payments: {
        packages: (signal?: AbortSignal) => Promise<Packages>;
        /**
         * Start a hosted Checkout.
         *
         * `returnTo` is where Stripe sends the browser afterwards. Defaults to
         * the current page, because a purchase should end where it started —
         * pass `null` to land on the server's own confirmation page instead,
         * which is what a context with no page to return to wants.
         *
         * The URL must be on an origin in the server's `allowed_origins`, the
         * same check the OAuth flow applies: an unvalidated redirect target
         * handed to a third party is an open redirect with a payment attached.
         */
        stripeCheckout: (packageId: string, options?: {
            returnTo?: string | null;
            signal?: AbortSignal;
        }) => Promise<StripeCheckout>;
        ethDepositAddress: (packageId: string, signal?: AbortSignal) => Promise<EthDeposit>;
        lightningInvoice: (packageId: string, signal?: AbortSignal) => Promise<LightningInvoice>;
        list: (signal?: AbortSignal) => Promise<{
            topups: Topup[];
        }>;
        get: (topupId: string, signal?: AbortSignal) => Promise<Topup>;
        /**
         * Poll a top-up until it leaves `pending`.
         *
         * Every rail confirms out-of-band — a Stripe webhook, a chain watcher, a
         * Lightning settlement — so the client's only job is to watch the status.
         * Transient network blips are retried rather than thrown, because a
         * dropped poll says nothing about the payment.
         */
        waitFor: (topupId: string, options?: {
            intervalMs?: number;
            timeoutMs?: number;
            signal?: AbortSignal;
            onPoll?: (topup: Topup) => void;
        }) => Promise<Topup>;
    };
    referral: {
        /**
         * Your referral code, and — when `appId` names an app the operator has
         * registered a domain for — a ready-to-share link on that app's own
         * domain.
         *
         * Pass the app id whenever you know it. A referral link has to carry the
         * *product's* domain: an invite to OpenCapture that lands on the accounts
         * server is an invite to nothing the recipient recognises, and one built
         * from `location` inside a browser extension points at a
         * `chrome-extension://` URL that resolves on nobody else's machine.
         *
         * Without an id, or for an app with no registered URL, `invite_url` comes
         * back `null` and building the link is the caller's problem.
         */
        code: (appId?: string, signal?: AbortSignal) => Promise<ReferralCode>;
        apply: (code: string, signal?: AbortSignal) => Promise<{
            ok: boolean;
        }>;
        earnings: (signal?: AbortSignal) => Promise<ReferralEarnings>;
        /**
         * Everyone who signed up through your code.
         *
         * Returns handles rather than identities — see `Referees`. Use it to
         * reconcile earnings, not to find out who someone is.
         */
        referees: (signal?: AbortSignal) => Promise<Referees>;
    };
}
export type { CreditPackage, Session, TokenStore };
//# sourceMappingURL=client.d.ts.map