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
/** The request never reached the server (offline, DNS, CORS, abort). */
 | "network"
/** A poll helper gave up before the top-up reached a terminal state. */
 | "timeout";
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