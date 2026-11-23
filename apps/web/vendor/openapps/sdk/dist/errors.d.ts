/**
 * The server speaks one error shape:
 * `{"error": {"code": "insufficient_balance", "message": "…"}}`.
 * Every failure this SDK raises is an `OpenAppsError` carrying that code, so
 * callers branch on a stable string rather than parsing messages or
 * memorising status codes.
 */
export type ErrorCode = "bad_request" | "unauthorized" | "insufficient_balance" | "not_found" | "conflict" | "rate_limited" | "internal"
/** The identity you tried to link is already on a different account. */
 | "identity_belongs_to_another_account"
/**
 * The two accounts both use some sign-in method and cannot be combined.
 * `detail.blocking` says which, and which identity on each side.
 */
 | "merge_blocked_by_duplicate_namespace"
/** The account already has a sign-in of that kind; `detail.linked` is it. */
 | "namespace_already_linked"
/** It is the account's only sign-in method. */
 | "last_sign_in_method"
/**
 * A method was connected too recently for the older ones to be removed.
 * `detail.removable_at` is when they can be; the new one can go now.
 */
 | "recently_connected_method"
/**
 * A link named the identity it expected (`expect`) and the proof came
 * from another: a different signer answered. Nothing was linked.
 * `detail.expected` and `detail.signed` name the two.
 */
 | "signed_by_a_different_key"
/**
 * The sign-in method proven was connected to its account too recently to
 * combine accounts with. `detail.retry_at` is when it no longer is.
 */
 | "merge_via_new_method"
/** The credentials are good and are not allowed to do this. */
 | "forbidden"
/**
 * OnWallet cannot be connected from this sign-in: it began with a
 * redirect code that was not bound to its page. `detail.sign_in_url` is
 * the server's Account page, which signs in afresh and then connects.
 */
 | "sign_in_on_account_page"
/**
 * The change asked for (link, unlink, merge, delete, ending sessions)
 * needs a recent sign-in. Have the user sign in again — with any method
 * already on the account — and retry.
 */
 | "reauth_required"
/** The account is suspended. */
 | "account_suspended"
/** The request never reached the server (offline, DNS, CORS, abort). */
 | "network"
/** A poll helper gave up before the top-up reached a terminal state. */
 | "timeout" | "email_invalid" | "email_unavailable" | "email_too_soon" | "email_limited" | "email_busy" | "email_send_failed" | "pow_invalid" | "code_wrong" | "code_expired" | "code_format";
export declare class OpenAppsError extends Error {
    readonly code: ErrorCode;
    /** HTTP status, or 0 when the request never got a response. */
    readonly status: number;
    /** Present on `insufficient_balance`: what the user actually has. */
    readonly balance?: number;
    /**
     * The whole error object the server sent. Some conflicts carry structured
     * detail a UI has to act on — `identity_belongs_to_another_account`
     * includes the other account's id and balance so you can ask "combine
     * them?" without a second request.
     */
    readonly detail?: Record<string, unknown>;
    constructor(code: ErrorCode, message: string, status?: number, balance?: number, detail?: Record<string, unknown>);
    /** True when re-authenticating could plausibly fix this. */
    get isAuthError(): boolean;
}
/** Build an error from a response whose body may or may not be our shape. */
export declare function errorFromResponse(status: number, body: unknown): OpenAppsError;
//# sourceMappingURL=errors.d.ts.map