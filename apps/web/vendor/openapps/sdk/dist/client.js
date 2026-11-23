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
        /**
         * {@link methods}, with what else the server says about signing in: where
         * OnWallet is installed from. The link is the server's to give, never
         * a page's to make up, and anything that is not a plain `https:` URL is
         * dropped here so it can be put in an `href` as it comes.
         */
        serverInfo: async (signal) => {
            const result = await this.#request("/v1/auth/methods", { signal });
            return {
                methods: result.methods,
                openwallet_install_url: httpsUrl(result.openwallet_install_url),
            };
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
        /** Email sign-in, step 0: a proof-of-work challenge to solve. */
        emailPow: (signal) => this.#request("/v1/auth/email/pow", { signal }),
        /**
         * Email sign-in, step 1: send a 6-digit code to `email`. `lang` is the
         * sign-in box's language, so the mail matches it.
         */
        emailStart: (email, pow, options = {}) => this.#request("/v1/auth/email/start", {
            method: "POST",
            body: { email, pow, lang: options.lang },
            signal: options.signal,
        }),
        /**
         * Email sign-in, step 2: the code from the mail. Establishes the
         * session, like {@link verify}.
         */
        emailVerify: async (flowId, code, options = {}) => {
            const result = await this.#request("/v1/auth/email/verify", {
                method: "POST",
                body: { flow_id: flowId, code, referral_code: options.referralCode },
                signal: options.signal,
            });
            this.#setSession({
                accessToken: result.access_token,
                refreshToken: result.refresh_token,
            });
            return result;
        },
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
        redirectStartUrl: (provider, returnTo, referralCode) => {
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
            return `${this.baseUrl}/v1/auth/oidc/${provider}/start${query ? `?${query}` : ""}`;
        },
        /** {@link redirectStartUrl} for Google. */
        googleStartUrl: (returnTo, referralCode) => this.auth.redirectStartUrl("google", returnTo, referralCode),
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
        redirectStart: async (provider, returnTo, referralCode) => {
            const base = this.auth.redirectStartUrl(provider, returnTo, referralCode);
            const challenge = await newPkceChallenge(returnTo);
            if (!challenge)
                return base;
            const join = base.includes("?") ? "&" : "?";
            return `${base}${join}code_challenge=${challenge}&code_challenge_method=S256`;
        },
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
        redirectAuthorizeUrl: async (provider, returnTo, referralCode, signal) => {
            const start = await this.auth.redirectStart(provider, returnTo, referralCode);
            const url = `${start}${start.includes("?") ? "&" : "?"}mode=json`;
            let response;
            try {
                response = await this.#fetch(url, {
                    method: "GET",
                    credentials: "include",
                    headers: { accept: "application/json" },
                    signal,
                });
            }
            catch (cause) {
                if (cause instanceof Error && cause.name === "AbortError")
                    throw cause;
                throw new OpenAppsError("network", cause instanceof Error ? cause.message : "network request failed");
            }
            const payload = await this.#parseBody(response);
            if (!response.ok)
                throw errorFromResponse(response.status, payload);
            const authorizeUrl = payload?.authorize_url;
            if (typeof authorizeUrl !== "string" || !authorizeUrl) {
                throw new OpenAppsError("internal", "the sign-in start returned no authorize_url");
            }
            return authorizeUrl;
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
         *
         * Sends the PKCE verifier {@link redirectStart} kept, if any. A code that
         * arrives in a page that started no sign-in while already signed in is
         * ignored rather than allowed to replace the session silently.
         */
        completeRedirect: (options = {}) => {
            const code = readRedirectParam(options, "code");
            if (!code)
                return Promise.resolve(null);
            if (this.#completing)
                return this.#completing;
            const verifier = takePkceVerifier();
            if (!verifier && this.isLoggedIn) {
                stripRedirectParams(options, ["code"]);
                return Promise.resolve(null);
            }
            this.#completing = (async () => {
                try {
                    const result = await this.#request("/v1/auth/oidc/exchange", {
                        method: "POST",
                        body: verifier ? { code, code_verifier: verifier } : { code },
                        signal: options.signal,
                    });
                    this.#setSession({
                        accessToken: result.access_token,
                        refreshToken: result.refresh_token,
                    });
                    return result;
                }
                finally {
                    this.#completing = null;
                    // Drop the code from the address bar and from history, whether or
                    // not the exchange worked. It is spent either way -- the server
                    // rejected it or consumed it -- and a code that failed pollutes a
                    // page-view report exactly as much as one that succeeded, which is
                    // the harm this is here to prevent. Leaving it also
                    // means a reload retries a code that can never work.
                    stripRedirectParams(options, ["code"]);
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
        /**
         * Delete the signed-in account, then forget the session locally.
         *
         * Permanent. The sign-in methods are released — signing in with one of
         * them again starts a new, empty account — and any remaining credits
         * are forfeited, so say both before calling this. App Store guideline
         * 5.1.1(v) is why it exists: an app that creates accounts must let
         * people delete them from inside it.
         */
        deleteAccount: async (signal) => {
            await this.#request("/v1/me", { method: "DELETE", auth: "bearer", signal });
            this.#setSession(null);
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
                // The identity the person was shown and agreed to link
                // (`nostr:npub1…`). When given, the server links nothing unless
                // the proof came from exactly that one: a signer that answers
                // with a different key between the preview and the signature is
                // refused (`signed_by_a_different_key`), not quietly linked.
                ...(options.expect ? { expect: options.expect } : {}),
            },
            signal: options.signal,
        }),
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
        redirectLinkStart: async (provider, returnTo, options = {}) => (await this.auth.redirectLinkBegin(provider, returnTo, options)).auth_url,
        /**
         * {@link redirectLinkStart}, with everything the server handed back:
         * the form to post (`go`) as well as the older URL.
         */
        redirectLinkBegin: (provider, returnTo, options = {}) => this.#request(`/v1/auth/link/oidc/${provider}/start`, {
            method: "POST",
            auth: "bearer",
            body: { return_to: returnTo },
            signal: options.signal,
        }),
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
        redirectLink: async (provider, returnTo, options = {}) => {
            const start = await this.auth.redirectLinkBegin(provider, returnTo, options);
            if (submitLinkForm(start))
                return;
            if (typeof window === "undefined") {
                throw new Error("redirectLink needs a page to navigate; use redirectLinkBegin");
            }
            window.location.href = start.auth_url;
        },
        /**
         * Complete a redirect link this session started, from the `code` of a
         * `pending` {@link completeLinkRedirect} outcome.
         *
         * Answers like {@link linkVerify}: the link, or a thrown
         * `identity_belongs_to_another_account` conflict to put to the user
         * (then call again with `{ merge: true }` and the same code), or
         * `merge_blocked_by_duplicate_namespace`.
         */
        confirmLink: (code, options = {}) => this.#request("/v1/auth/link/oidc/confirm", {
            method: "POST",
            auth: "bearer",
            body: { code, merge: options.merge ?? false },
            signal: options.signal,
        }),
        /** This account's live sessions, the current one marked. */
        sessions: (signal) => this.#request("/v1/sessions", { auth: "bearer", signal }),
        /** End one session. Needs a recent sign-in. */
        revokeSession: (id, signal) => this.#request(`/v1/sessions/${encodeURIComponent(id)}`, {
            method: "DELETE",
            auth: "bearer",
            signal,
        }),
        /** End every session but this one. Needs a recent sign-in. */
        revokeOtherSessions: (signal) => this.#request("/v1/sessions/revoke-others", {
            method: "POST",
            auth: "bearer",
            signal,
        }),
        /** The account's security activity: sign-ins, links, merges, revocations. */
        events: (signal) => this.#request("/v1/me/events", { auth: "bearer", signal }),
        /** {@link redirectLinkStart} for Google. */
        googleLinkStart: (returnTo, options = {}) => this.auth.redirectLinkStart("google", returnTo, options),
        /**
         * Read the outcome of a Google link out of the URL fragment and clear
         * it. Returns `null` when this was not a link redirect, so a page can
         * call it unconditionally on load.
         */
        completeLinkRedirect: (options = {}) => {
            const params = redirectParams(options);
            const pending = params.get("link_pending");
            const linked = params.get("linked");
            const conflict = params.get("link_conflict");
            const blockedBy = params.get("link_blocked");
            const error = params.get("link_error");
            if (!pending && !linked && !conflict && !blockedBy && !error)
                return null;
            stripRedirectParams(options, ["link_pending", "provider", "linked", "link_conflict", "link_blocked", "link_error", "clashes"], 
            // What an older server put beside `linked` and `link_conflict`.
            // Everyday words, so they are cleared from the fragment only: a
            // page's own `?credits=` is not ours to remove.
            ["merged", "credits", "balance"]);
            if (pending) {
                return { status: "pending", code: pending, namespace: params.get("provider") ?? "" };
            }
            if (error)
                return { status: "error", message: error };
            if (blockedBy) {
                const namespaces = (params.get("clashes") ?? "").split(",").filter(Boolean);
                const names = namespaces.map(providerName).join(" and ");
                return {
                    status: "blocked",
                    namespaces,
                    message: `That ${providerName(blockedBy)} account belongs to another account which also ` +
                        `has a ${names} sign-in, and so does this one. Disconnect it from the other ` +
                        "account first.",
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
        /**
         * Cancel a merge that is waiting ({@link Me.pending_merges}), from
         * either of the two accounts. Nothing has moved, so nothing is undone.
         */
        cancelMerge: (id, signal) => this.#request(`/v1/auth/merges/${encodeURIComponent(id)}/cancel`, { method: "POST", auth: "bearer", signal }),
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
         * The balance and, where the server keeps track, what it is made of:
         * credits bought (which never lapse) and this month's member credits
         * (which do), when they lapse, and why there are none.
         *
         * The same request as {@link balance}. A server with member credits off
         * answers `{ balance }` alone; the other fields are then undefined, and
         * that is how a UI knows to show nothing new.
         */
        breakdown: (signal) => this.#request("/v1/credits/balance", { auth: "bearer", signal }),
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
    // ---------- what agents may spend ----------
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
    delegation = (method = "GET", limits) => this.#request("/v1/me/delegation", { method, auth: "bearer", body: limits });
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
        /**
         * A USD₮0 deposit address on one network: an `id` from
         * `packages().usdt0.networks`. Fails with a 400 unless the server has
         * USD₮0 enabled on that network.
         */
        usdt0DepositAddress: (packageId, network, signal) => this.#request("/v1/payments/usdt0/deposit-address", {
            method: "POST",
            auth: "bearer",
            body: { package_id: packageId, network },
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
/**
 * Take the auth parameters back out of the address bar, and leave the rest.
 *
 * The code is spent the moment it is exchanged, so this is not a secret being
 * protected -- it is the URL being put back the way the user left it. Two
 * things go wrong when it is not:
 *
 *   - **The analytics see a page.** A page-view tag reports `location` as it
 *     finds it, so every sign-in produces a unique "page" -- `/#code=oac_4fa4…`
 *     -- with exactly one visitor, for ever. openpixels.app's report filled up
 *     with them, and the funnel through `/#studio` was cut into slivers.
 *     Nothing errors; the only symptom is in a dashboard nobody
 *     reads daily.
 *   - **The code lands in browser history.**
 *
 * The previous version dropped the whole fragment:
 *
 *     history.replaceState({}, "", location.pathname + location.search)
 *
 * which is right for a `?code=` callback and wrong for a `#code=` one. Every
 * app in this suite that routes on the hash -- `/#studio`, `/#models` -- was
 * thrown back to the top of the app by its own sign-in. So this removes the
 * named parameters from *both* the query and the fragment and puts whatever
 * else was there back.
 *
 * It also no longer skips the cleanup when the caller passed `hash` or `url`.
 * That condition had it backwards: a caller passes `hash` precisely because
 * the parameters are in the fragment, which is the case that most needs
 * clearing. `url` is still skipped -- that is a string the caller parsed, not
 * the address bar, and there is nothing there to rewrite.
 */
function stripRedirectParams(options, names, fragmentOnly = []) {
    if (options.url !== undefined)
        return;
    if (typeof history === "undefined" || typeof location === "undefined")
        return;
    const query = new URLSearchParams(location.search.replace(/^\?/, ""));
    const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
    for (const name of names) {
        query.delete(name);
        fragment.delete(name);
    }
    for (const name of fragmentOnly)
        fragment.delete(name);
    const q = query.toString();
    const f = fragment.toString();
    history.replaceState({}, "", location.pathname + (q ? `?${q}` : "") + (f ? `#${f}` : ""));
}
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
// ---------- leaving for a provider to link ----------
/** `value` if it is a plain `https:` URL, else `null`. */
function httpsUrl(value) {
    if (typeof value !== "string")
        return null;
    try {
        const url = new URL(value);
        return url.protocol === "https:" && !url.username && !url.password ? value : null;
    }
    catch {
        return null;
    }
}
/**
 * Submit the server's link form as a top-level navigation. False when there
 * is no form to submit (an older server) or no document to submit it from,
 * so the caller can fall back to the URL.
 *
 * The target must be http(s): the fields carry the flow's state, and it
 * goes to the account server or nowhere.
 */
function submitLinkForm(start) {
    const go = start.go;
    if (!go || go.method !== "POST" || typeof document === "undefined")
        return false;
    let action;
    try {
        action = new URL(go.url);
    }
    catch {
        return false;
    }
    if (action.protocol !== "https:" && action.protocol !== "http:")
        return false;
    const form = document.createElement("form");
    form.method = "POST";
    form.action = action.href;
    form.hidden = true;
    for (const [name, value] of Object.entries(go.fields ?? {})) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = String(value);
        form.append(input);
    }
    document.body.append(form);
    form.submit();
    return true;
}
// ---------- PKCE for the redirect code exchange ----------
const PKCE_KEY = "openapps.pkce_verifier";
function tabStorage() {
    try {
        return typeof sessionStorage === "undefined" ? null : sessionStorage;
    }
    catch {
        // Storage disabled (privacy mode, sandboxed frame): no PKCE, and the
        // server accepts that only while it allows challenge-less sign-ins.
        return null;
    }
}
function base64url(bytes) {
    let s = "";
    for (const b of bytes)
        s += String.fromCharCode(b);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/**
 * Make a verifier, keep it for this tab, and return its S256 challenge —
 * or null where that cannot work: no storage or Web Crypto, or a `returnTo`
 * on another origin, whose page could never read this tab's storage.
 */
async function newPkceChallenge(returnTo) {
    const storage = tabStorage();
    const subtle = globalThis.crypto?.subtle;
    if (!storage || !subtle || typeof location === "undefined")
        return null;
    if (returnTo) {
        try {
            if (new URL(returnTo).origin !== location.origin)
                return null;
        }
        catch {
            return null;
        }
    }
    const random = new Uint8Array(32);
    globalThis.crypto.getRandomValues(random);
    const verifier = base64url(random);
    const digest = new Uint8Array(await subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
    try {
        storage.setItem(PKCE_KEY, verifier);
    }
    catch {
        return null;
    }
    return base64url(digest);
}
/** The verifier this tab kept, removed as it is read: it is single-use. */
function takePkceVerifier() {
    const storage = tabStorage();
    if (!storage)
        return null;
    try {
        const verifier = storage.getItem(PKCE_KEY);
        storage.removeItem(PKCE_KEY);
        return verifier;
    }
    catch {
        return null;
    }
}
/** How to name a sign-in method to a person. */
function providerName(namespace) {
    return ({
        google: "Google",
        github: "GitHub",
        apple: "Apple",
        openwallet: "OnWallet",
        eip155: "wallet",
        nostr: "Nostr",
    }[namespace] ?? namespace);
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