import { type Session, type TokenStore } from "./storage.js";
import type { AccountEvent, AuthMethods, AuthServerInfo, LinkStart, SessionInfo, Challenge, CreditPackage, CreditsBreakdown, DelegationView, DeductResult, EmailPowChallenge, EmailPowSolution, EmailStart, EthDeposit, History, LightningInvoice, LinkRedirect, LinkResult, LoginResult, Me, Namespace, Packages, Proof, RedirectProvider, ReferralCode, Referees, ReferralEarnings, StripeCheckout, Topup, Usdt0Deposit } from "./types.js";
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
        /**
         * {@link methods}, with what else the server says about signing in: where
         * OnWallet is installed from. The link is the server's to give, never
         * a page's to make up, and anything that is not a plain `https:` URL is
         * dropped here so it can be put in an `href` as it comes.
         */
        serverInfo: (signal?: AbortSignal) => Promise<AuthServerInfo>;
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
        /** Email sign-in, step 0: a proof-of-work challenge to solve. */
        emailPow: (signal?: AbortSignal) => Promise<EmailPowChallenge>;
        /**
         * Email sign-in, step 1: send a 6-digit code to `email`. `lang` is the
         * sign-in box's language, so the mail matches it.
         */
        emailStart: (email: string, pow: EmailPowSolution, options?: {
            lang?: string;
            signal?: AbortSignal;
        }) => Promise<EmailStart>;
        /**
         * Email sign-in, step 2: the code from the mail. Establishes the
         * session, like {@link verify}.
         */
        emailVerify: (flowId: string, code: string, options?: {
            referralCode?: string;
            signal?: AbortSignal;
        }) => Promise<LoginResult>;
        /**
         * Where to send the browser to sign in with Google or GitHub.
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
        redirectStartUrl: (provider: RedirectProvider, returnTo?: string, referralCode?: string) => string;
        /** {@link redirectStartUrl} for Google. */
        googleStartUrl: (returnTo?: string, referralCode?: string) => string;
        /**
         * {@link redirectStartUrl}, bound to this page with PKCE.
         *
         * Generates a one-time verifier, keeps it in this tab's
         * `sessionStorage`, and puts its SHA-256 on the start URL. The code the
         * server hands back can then only be redeemed by {@link completeRedirect}
         * in this tab — a `#code=` planted in someone else's page by an attacker
         * who signed in to *their* account is refused (login CSRF). Prefer this
         * to {@link redirectStartUrl} wherever the page that starts the sign-in
         * is the page it returns to.
         */
        redirectStart: (provider: RedirectProvider, returnTo?: string, referralCode?: string) => Promise<string>;
        /**
         * {@link redirectStart}, answered with the provider's authorize URL
         * instead of a redirect to it (`mode=json`).
         *
         * For a page that hands the URL to something other than its own
         * address bar: the OnWallet extension's `window.openwallet.signIn`,
         * which opens its approval window over the page and then navigates
         * this tab to the callback itself. Everything else is the redirect
         * sign-in unchanged — the same PKCE verifier kept in this tab, the same
         * browser-binding cookie, the same `#code=` back at `returnTo` for
         * {@link completeRedirect}. The fetch is credentialed because that
         * cookie is set by this response; the server allows credentials on this
         * request alone, and only from its `allowed_origins`.
         *
         * Throws {@link OpenAppsError} when the server refuses (an origin it
         * does not serve, a host with no callback of its own: `conflict`) or
         * cannot be reached; a caller then falls back to
         * `location.href = await redirectStart(…)`.
         */
        redirectAuthorizeUrl: (provider: RedirectProvider, returnTo: string, referralCode?: string, signal?: AbortSignal) => Promise<string>;
        /**
         * Finish a redirect sign-in: exchange the `#code=…` fragment for a
         * session and clear it from the URL.
         *
         * Safe to call on every page load — it returns `null` when there is no
         * code, so a page can call it unconditionally at startup. Concurrent
         * calls share one exchange, because a framework that double-invokes
         * effects would otherwise spend the code on the first call and fail the
         * second.
         *
         * Sends the PKCE verifier {@link redirectStart} kept, if any. A code that
         * arrives in a page that started no sign-in while already signed in is
         * ignored rather than allowed to replace the session silently.
         */
        completeRedirect: (options?: {
            url?: string;
            hash?: string;
            signal?: AbortSignal;
        }) => Promise<LoginResult | null>;
        me: (signal?: AbortSignal) => Promise<Me>;
        /** Revoke the session server-side, then forget it locally. */
        logout: (signal?: AbortSignal) => Promise<void>;
        /**
         * Delete the signed-in account, then forget the session locally.
         *
         * Permanent. The sign-in methods are released — signing in with one of
         * them again starts a new, empty account — and any remaining credits
         * are forfeited, so say both before calling this. App Store guideline
         * 5.1.1(v) is why it exists: an app that creates accounts must let
         * people delete them from inside it.
         */
        deleteAccount: (signal?: AbortSignal) => Promise<void>;
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
            expect?: string;
            signal?: AbortSignal;
        }) => Promise<LinkResult>;
        /**
         * Begin connecting Google, GitHub or Apple to the account already
         * signed in here.
         *
         * Wallet and Nostr link by signing in the page; these need a full
         * redirect, which carries no bearer token — so this authenticated call
         * records who is asking and hands back a URL to navigate to (on the
         * server, which binds the flow to this browser on the way through). On
         * return, {@link completeLinkRedirect} reports a `pending` link, which
         * {@link confirmLink} completes from this page.
         *
         * Nothing about merging is decided here: if the identity turns out to
         * be on another account, {@link confirmLink} answers with that conflict
         * and the page asks the user before confirming with `{ merge: true }`.
         * (`merge` is accepted for compatibility and ignored.)
         *
         * Needs a recent sign-in: an old session gets `reauth_required`.
         */
        redirectLinkStart: (provider: RedirectProvider, returnTo: string, options?: {
            merge?: boolean;
            signal?: AbortSignal;
        }) => Promise<string>;
        /**
         * {@link redirectLinkStart}, with everything the server handed back:
         * the form to post (`go`) as well as the older URL.
         */
        redirectLinkBegin: (provider: RedirectProvider, returnTo: string, options?: {
            signal?: AbortSignal;
        }) => Promise<LinkStart>;
        /**
         * Begin connecting a redirect provider and leave for it — the way to
         * start a link from a page.
         *
         * Where the server offers it, the page leaves by **submitting a form**
         * rather than following a URL. The server binds the link to the browser
         * that posts that form from one of its own pages, so a link cannot be
         * started by sending someone a URL: only this browser, showing this
         * page, with this account signed in, can go on to the provider. A
         * server from before the form existed gets the URL, as before.
         *
         * The page is navigated away; the promise settles only if that fails
         * to start. A page whose Content-Security-Policy sets `form-action`
         * must allow the account server's origin.
         *
         * Needs a recent sign-in: an old session gets `reauth_required`.
         */
        redirectLink: (provider: RedirectProvider, returnTo: string, options?: {
            signal?: AbortSignal;
        }) => Promise<void>;
        /**
         * Complete a redirect link this session started, from the `code` of a
         * `pending` {@link completeLinkRedirect} outcome.
         *
         * Answers like {@link linkVerify}: the link, or a thrown
         * `identity_belongs_to_another_account` conflict to put to the user
         * (then call again with `{ merge: true }` and the same code), or
         * `merge_blocked_by_duplicate_namespace`.
         */
        confirmLink: (code: string, options?: {
            merge?: boolean;
            signal?: AbortSignal;
        }) => Promise<LinkResult>;
        /** This account's live sessions, the current one marked. */
        sessions: (signal?: AbortSignal) => Promise<{
            sessions: SessionInfo[];
        }>;
        /** End one session. Needs a recent sign-in. */
        revokeSession: (id: string, signal?: AbortSignal) => Promise<{
            ok: boolean;
        }>;
        /** End every session but this one. Needs a recent sign-in. */
        revokeOtherSessions: (signal?: AbortSignal) => Promise<{
            ok: boolean;
            revoked: number;
        }>;
        /** The account's security activity: sign-ins, links, merges, revocations. */
        events: (signal?: AbortSignal) => Promise<{
            events: AccountEvent[];
        }>;
        /** {@link redirectLinkStart} for Google. */
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
        /**
         * Cancel a merge that is waiting ({@link Me.pending_merges}), from
         * either of the two accounts. Nothing has moved, so nothing is undone.
         */
        cancelMerge: (id: string, signal?: AbortSignal) => Promise<{
            ok: boolean;
            cancelled: string;
        }>;
        unlink: (caip10: string, signal?: AbortSignal) => Promise<{
            ok: boolean;
        }>;
    };
    credits: {
        balance: (signal?: AbortSignal) => Promise<number>;
        /**
         * The balance and, where the server keeps track, what it is made of:
         * credits bought (which never lapse) and this month's member credits
         * (which do), when they lapse, and why there are none.
         *
         * The same request as {@link balance}. A server with member credits off
         * answers `{ balance }` alone; the other fields are then undefined, and
         * that is how a UI knows to show nothing new.
         */
        breakdown: (signal?: AbortSignal) => Promise<CreditsBreakdown>;
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
    /**
     * The person's delegation: what agents they approve in OnWallet may spend
     * from their credits, per day and per run (`/v1/me/delegation`).
     *
     * - `delegation()` reads it.
     * - `delegation("PUT", { per_day_credits?, per_run_credits? })` creates
     *   or changes it, or turns a revoked one back on (send `{}` for that, or
     *   for the defaults); an omitted limit keeps its current value.
     * - `delegation("DELETE")` turns it off: agents can no longer start
     *   spending.
     */
    delegation: (method?: "GET" | "PUT" | "DELETE", limits?: {
        per_day_credits?: number;
        per_run_credits?: number;
    }) => Promise<DelegationView>;
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
        /**
         * A USD₮0 deposit address on one network: an `id` from
         * `packages().usdt0.networks`. Fails with a 400 unless the server has
         * USD₮0 enabled on that network.
         */
        usdt0DepositAddress: (packageId: string, network: string, signal?: AbortSignal) => Promise<Usdt0Deposit>;
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