import { OpenAppsError, errorFromResponse } from "./errors.js";
import { defaultStore } from "./storage.js";
const TERMINAL_STATUSES = new Set(["confirmed", "failed", "expired"]);
export class OpenApps {
    baseUrl;
    #appKey;
    #store;
    #fetch;
    #onAuthChange;
    /**
     * In-flight refresh, shared by every request that hits a 401 at once.
     * Without this, a page that fires five requests on load would burn five
     * refresh tokens — and because rotation treats a replayed token as theft,
     * that revokes the whole family and logs the user out.
     */
    #refreshing = null;
    /** In-flight redirect-code exchange, shared by concurrent callers. */
    #completing = null;
    constructor(options) {
        this.baseUrl = options.baseUrl.replace(/\/+$/, "");
        this.#appKey = options.appKey;
        this.#store = options.store ?? defaultStore();
        const bound = options.fetch ?? globalThis.fetch;
        if (!bound) {
            throw new OpenAppsError("network", "no fetch implementation available; pass one via options.fetch");
        }
        this.#fetch = (input, init) => bound(input, init);
        this.#onAuthChange = options.onAuthChange;
    }
    // ---------- session ----------
    get session() {
        return this.#store.get();
    }
    get isLoggedIn() {
        return this.#store.get() !== null;
    }
    #setSession(session) {
        this.#store.set(session);
        this.#onAuthChange?.(session);
    }
    /** Adopt a session obtained elsewhere (an OAuth redirect, another tab). */
    adoptSession(accessToken, refreshToken) {
        this.#setSession({ accessToken, refreshToken });
    }
    /** Drop local tokens without calling the server. */
    clearSession() {
        this.#setSession(null);
    }
    // ---------- transport ----------
    async #request(path, options = {}) {
        const auth = options.auth ?? "none";
        if (auth !== "none" && !this.#store.get()) {
            throw new OpenAppsError("unauthorized", "not logged in");
        }
        if (auth === "app+bearer" && !this.#appKey) {
            throw new OpenAppsError("unauthorized", "this call needs an app key; construct OpenApps with { appKey }");
        }
        return this.#send(path, options, auth, true);
    }
    async #send(path, options, auth, mayRefresh) {
        let url = `${this.baseUrl}${path}`;
        if (options.query) {
            const params = new URLSearchParams();
            for (const [key, value] of Object.entries(options.query)) {
                if (value !== undefined)
                    params.set(key, String(value));
            }
            const qs = params.toString();
            if (qs)
                url += `?${qs}`;
        }
        const headers = { accept: "application/json" };
        if (options.body !== undefined)
            headers["content-type"] = "application/json";
        if (auth !== "none") {
            headers.authorization = `Bearer ${this.#store.get()?.accessToken ?? ""}`;
        }
        if (auth === "app+bearer" && this.#appKey) {
            headers["x-openapps-app-key"] = this.#appKey;
        }
        let response;
        try {
            response = await this.#fetch(url, {
                method: options.method ?? "GET",
                headers,
                body: options.body === undefined ? undefined : JSON.stringify(options.body),
                signal: options.signal,
            });
        }
        catch (cause) {
            // AbortError must stay an abort so callers can distinguish "I
            // cancelled this" from "the network is down".
            if (cause instanceof Error && cause.name === "AbortError")
                throw cause;
            throw new OpenAppsError("network", cause instanceof Error ? cause.message : "network request failed");
        }
        if (response.status === 401 && auth !== "none" && mayRefresh) {
            const refreshed = await this.#refresh();
            if (refreshed)
                return this.#send(path, options, auth, false);
        }
        const payload = await this.#parseBody(response);
        if (!response.ok) {
            const error = errorFromResponse(response.status, payload);
            // A 401 that survived a refresh attempt means the session is dead.
            if (error.code === "unauthorized" && auth !== "none")
                this.#setSession(null);
            throw error;
        }
        return payload;
    }
    async #parseBody(response) {
        if (response.status === 204)
            return null;
        const text = await response.text();
        if (!text)
            return null;
        try {
            return JSON.parse(text);
        }
        catch {
            // A proxy or error page got in the way; surface the body, truncated.
            throw new OpenAppsError(response.ok ? "internal" : "network", `expected JSON, got: ${text.slice(0, 200)}`, response.status);
        }
    }
    /** Rotate the refresh token. Concurrent callers share one attempt. */
    #refresh() {
        if (this.#refreshing)
            return this.#refreshing;
        const current = this.#store.get();
        if (!current)
            return Promise.resolve(null);
        this.#refreshing = (async () => {
            try {
                const result = await this.#send("/v1/auth/refresh", { method: "POST", body: { refresh_token: current.refreshToken } }, "none", false);
                const session = {
                    accessToken: result.access_token,
                    refreshToken: result.refresh_token,
                };
                this.#setSession(session);
                return session;
            }
            catch {
                // Refresh failed: the family is revoked or expired. Drop the
                // session so the UI can show a login prompt instead of looping.
                this.#setSession(null);
                return null;
            }
            finally {
                this.#refreshing = null;
            }
        })();
        return this.#refreshing;
    }
    // ---------- auth ----------
    auth = {
        /**
         * Which login methods this server can actually complete. Google needs
         * credentials the deployment may not have, and wallet/Nostr can each be
         * switched off, so a sign-in UI should ask rather than assume.
         */
        methods: async (signal) => {
            const result = await this.#request("/v1/auth/methods", { signal });
            return result.methods;
        },
        /** Step 1 of wallet/Nostr login: get something to sign. */
        challenge: (namespace, address, signal) => this.#request("/v1/auth/challenge", {
            method: "POST",
            body: { namespace, address },
            signal,
        }),
        /**
         * Step 2: hand back the signed proof. Establishes the session, so
         * everything afterwards is authenticated automatically.
         */
        verify: async (challengeId, proof, options = {}) => {
            const result = await this.#request("/v1/auth/verify", {
                method: "POST",
                body: {
                    challenge_id: challengeId,
                    proof,
                    referral_code: options.referralCode,
                },
                signal: options.signal,
            });
            this.#setSession({
                accessToken: result.access_token,
                refreshToken: result.refresh_token,
            });
            return result;
        },
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
        googleStartUrl: (returnTo, referralCode) => {
            const params = new URLSearchParams();
            if (returnTo)
                params.set("return_to", returnTo);
            // A referral is applied when the account is created, and for OAuth
            // that happens inside the callback — a request from the provider that
            // carries nothing of the page the user started on. So the code has to
            // be handed to the server up front, where it rides on the challenge.
            if (referralCode)
                params.set("ref", referralCode);
            const query = params.toString();
            return `${this.baseUrl}/v1/auth/oidc/google/start${query ? `?${query}` : ""}`;
        },
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
        completeRedirect: (options = {}) => {
            const code = readRedirectParam(options, "code");
            if (!code)
                return Promise.resolve(null);
            if (this.#completing)
                return this.#completing;
            this.#completing = (async () => {
                try {
                    const result = await this.#request("/v1/auth/oidc/exchange", {
                        method: "POST",
                        body: { code },
                        signal: options.signal,
                    });
                    this.#setSession({
                        accessToken: result.access_token,
                        refreshToken: result.refresh_token,
                    });
                    // Drop the code from the address bar and from history. It is
                    // already spent, but a URL carrying it should not be shareable.
                    if (options.hash === undefined &&
                        options.url === undefined &&
                        typeof history !== "undefined" &&
                        typeof location !== "undefined") {
                        history.replaceState({}, "", location.pathname + location.search);
                    }
                    return result;
                }
                finally {
                    this.#completing = null;
                }
            })();
            return this.#completing;
        },
        me: (signal) => this.#request("/v1/me", { auth: "bearer", signal }),
        /** Revoke the session server-side, then forget it locally. */
        logout: async (signal) => {
            try {
                await this.#request("/v1/auth/logout", {
                    method: "POST",
                    auth: "bearer",
                    signal,
                });
            }
            finally {
                // Whatever the server said, this device is logged out.
                this.#setSession(null);
            }
        },
        linkChallenge: (namespace, address, signal) => this.#request("/v1/auth/link/challenge", {
            method: "POST",
            auth: "bearer",
            body: { namespace, address },
            signal,
        }),
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
        linkVerify: (challengeId, proof, options = {}) => this.#request("/v1/auth/link/verify", {
            method: "POST",
            auth: "bearer",
            body: {
                challenge_id: challengeId,
                proof,
                merge: options.merge ?? false,
            },
            signal: options.signal,
        }),
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
        googleLinkStart: async (returnTo, options = {}) => {
            const result = await this.#request("/v1/auth/link/oidc/google/start", {
                method: "POST",
                auth: "bearer",
                body: { return_to: returnTo, merge: options.merge ?? false },
                signal: options.signal,
            });
            return result.auth_url;
        },
        /**
         * Read the outcome of a Google link out of the URL fragment and clear
         * it. Returns `null` when this was not a link redirect, so a page can
         * call it unconditionally on load.
         */
        completeLinkRedirect: (options = {}) => {
            const params = redirectParams(options);
            const linked = params.get("linked");
            const conflict = params.get("link_conflict");
            const blockedBy = params.get("link_blocked");
            const error = params.get("link_error");
            if (!linked && !conflict && !blockedBy && !error)
                return null;
            if (options.hash === undefined &&
                options.url === undefined &&
                typeof history !== "undefined") {
                history.replaceState({}, "", location.pathname + location.search);
            }
            if (error)
                return { status: "error", message: error };
            if (blockedBy) {
                const namespaces = (params.get("clashes") ?? "").split(",").filter(Boolean);
                const names = namespaces
                    .map((n) => ({ google: "Google", eip155: "wallet", nostr: "Nostr" })[n] ?? n)
                    .join(" and ");
                return {
                    status: "blocked",
                    namespaces,
                    message: `That Google account belongs to another account which also has a ${names} ` +
                        "sign-in, and so does this one. Disconnect it from the other account first.",
                };
            }
            if (conflict) {
                return {
                    status: "conflict",
                    namespace: conflict,
                    balance: Number(params.get("balance") ?? 0),
                };
            }
            return {
                status: "linked",
                namespace: linked,
                merged: params.get("merged") === "1",
                credits: Number(params.get("credits") ?? 0),
            };
        },
        unlink: (caip10, signal) => this.#request(`/v1/auth/link/${encodeURIComponent(caip10)}`, {
            method: "DELETE",
            auth: "bearer",
            signal,
        }),
    };
    // ---------- credits ----------
    credits = {
        balance: async (signal) => {
            const result = await this.#request("/v1/credits/balance", {
                auth: "bearer",
                signal,
            });
            return result.balance;
        },
        /**
         * Charge the logged-in user for something this app did.
         *
         * `idempotencyKey` must be stable for one logical operation: retry the
         * same call with the same key after a timeout and the user is charged
         * once, with the original result returned.
         */
        deduct: (amount, reason, idempotencyKey, signal) => this.#request("/v1/credits/deduct", {
            method: "POST",
            auth: "app+bearer",
            body: { amount, reason, idempotency_key: idempotencyKey },
            signal,
        }),
        history: (options = {}) => this.#request("/v1/credits/history", {
            auth: "bearer",
            query: { cursor: options.cursor, limit: options.limit },
            signal: options.signal,
        }),
    };
    // ---------- payments ----------
    payments = {
        packages: (signal) => this.#request("/v1/payments/packages", { signal }),
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
        stripeCheckout: (packageId, options = {}) => this.#request("/v1/payments/stripe/checkout", {
            method: "POST",
            auth: "bearer",
            body: {
                package_id: packageId,
                return_to: options.returnTo === null
                    ? undefined
                    : (options.returnTo ?? currentPageUrl()),
            },
            signal: options.signal,
        }),
        ethDepositAddress: (packageId, signal) => this.#request("/v1/payments/eth/deposit-address", {
            method: "POST",
            auth: "bearer",
            body: { package_id: packageId },
            signal,
        }),
        lightningInvoice: (packageId, signal) => this.#request("/v1/payments/lightning/invoice", {
            method: "POST",
            auth: "bearer",
            body: { package_id: packageId },
            signal,
        }),
        list: (signal) => this.#request("/v1/payments/topups", {
            auth: "bearer",
            signal,
        }),
        get: (topupId, signal) => this.#request(`/v1/payments/topups/${encodeURIComponent(topupId)}`, {
            auth: "bearer",
            signal,
        }),
        /**
         * Poll a top-up until it leaves `pending`.
         *
         * Every rail confirms out-of-band — a Stripe webhook, a chain watcher, a
         * Lightning settlement — so the client's only job is to watch the status.
         * Transient network blips are retried rather than thrown, because a
         * dropped poll says nothing about the payment.
         */
        waitFor: async (topupId, options = {}) => {
            const interval = options.intervalMs ?? 2000;
            const deadline = Date.now() + (options.timeoutMs ?? 15 * 60 * 1000);
            for (;;) {
                options.signal?.throwIfAborted();
                try {
                    const topup = await this.payments.get(topupId, options.signal);
                    options.onPoll?.(topup);
                    if (TERMINAL_STATUSES.has(topup.status))
                        return topup;
                }
                catch (error) {
                    // Auth and 404 are terminal; anything else may be transient.
                    if (error instanceof OpenAppsError && error.code !== "network")
                        throw error;
                    if (!(error instanceof OpenAppsError))
                        throw error;
                }
                if (Date.now() + interval > deadline) {
                    throw new OpenAppsError("timeout", `top-up ${topupId} was still pending after the timeout`);
                }
                await sleep(interval, options.signal);
            }
        },
    };
    // ---------- referral ----------
    referral = {
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
        code: (appId, signal) => this.#request("/v1/referral/code", {
            auth: "bearer",
            query: { app: appId },
            signal,
        }),
        apply: (code, signal) => this.#request("/v1/referral/apply", {
            method: "POST",
            auth: "bearer",
            body: { code },
            signal,
        }),
        earnings: (signal) => this.#request("/v1/referral/earnings", {
            auth: "bearer",
            signal,
        }),
        /**
         * Everyone who signed up through your code.
         *
         * Returns handles rather than identities — see `Referees`. Use it to
         * reconcile earnings, not to find out who someone is.
         */
        referees: (signal) => this.#request("/v1/referral/referees", {
            auth: "bearer",
            signal,
        }),
    };
}
/**
 * This page, without its fragment.
 *
 * The fragment is dropped because it is where the redirect login flow puts
 * its one-time code: returning from a payment to a URL still carrying a
 * spent code would make the SDK try to redeem it again and surface a
 * confusing failure on an otherwise successful purchase.
 */
function currentPageUrl() {
    if (typeof location === "undefined")
        return undefined;
    return `${location.origin}${location.pathname}${location.search}`;
}
/**
 * Pull the redirect parameters out of wherever they arrived.
 *
 * A browser reads them from `location.hash`. A native app is handed a whole
 * URL by the OS instead — and platforms disagree about whether a custom
 * scheme keeps its fragment through an Android intent or an iOS
 * `ASWebAuthenticationSession`, so both the fragment and the query are
 * searched. The server only ever writes the fragment; reading the query too
 * costs nothing and removes a class of platform-specific breakage.
 */
function redirectParams(options) {
    if (options.url !== undefined) {
        const url = options.url;
        const hashAt = url.indexOf("#");
        const queryAt = url.indexOf("?");
        const fragment = hashAt >= 0 ? url.slice(hashAt + 1) : "";
        // A `?` after the `#` belongs to the fragment, not the query.
        const hasQuery = queryAt >= 0 && (hashAt < 0 || queryAt < hashAt);
        const query = hasQuery ? url.slice(queryAt + 1, hashAt >= 0 ? hashAt : undefined) : "";
        const inFragment = new URLSearchParams(fragment);
        const inQuery = new URLSearchParams(query);
        // The fragment is what the server writes; the query is the fallback for
        // platforms that drop it.
        return { get: (name) => inFragment.get(name) ?? inQuery.get(name) };
    }
    const hash = options.hash ?? (typeof location === "undefined" ? "" : location.hash);
    return new URLSearchParams(hash.replace(/^#/, ""));
}
function readRedirectParam(options, name) {
    return redirectParams(options).get(name);
}
function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            reject(signal?.reason ?? new Error("aborted"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
//# sourceMappingURL=client.js.map