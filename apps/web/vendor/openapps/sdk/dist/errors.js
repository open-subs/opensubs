export class OpenAppsError extends Error {
    code;
    /** HTTP status, or 0 when the request never got a response. */
    status;
    /** Present on `insufficient_balance`: what the user actually has. */
    balance;
    /**
     * The whole error object the server sent. Some conflicts carry structured
     * detail a UI has to act on — `identity_belongs_to_another_account`
     * includes the other account's id and balance so you can ask "combine
     * them?" without a second request.
     */
    detail;
    constructor(code, message, status = 0, balance, detail) {
        super(message);
        this.name = "OpenAppsError";
        this.code = code;
        this.status = status;
        this.balance = balance;
        this.detail = detail;
    }
    /** True when re-authenticating could plausibly fix this. */
    get isAuthError() {
        return this.code === "unauthorized";
    }
}
const STATUS_CODES = {
    400: "bad_request",
    401: "unauthorized",
    402: "insufficient_balance",
    404: "not_found",
    409: "conflict",
    429: "rate_limited",
};
/** Build an error from a response whose body may or may not be our shape. */
export function errorFromResponse(status, body) {
    const envelope = body && typeof body === "object" ? body.error : undefined;
    const detail = envelope && typeof envelope === "object" ? envelope : undefined;
    const code = detail?.code ?? STATUS_CODES[status] ?? "internal";
    const message = detail?.message ?? `request failed with status ${status}`;
    // `balance is 42` — the server puts the real balance in the message so the
    // UI can say how many credits are short without a second round-trip.
    let balance;
    if (code === "insufficient_balance") {
        const match = /-?\d+/.exec(message);
        if (match)
            balance = Number(match[0]);
    }
    return new OpenAppsError(code, message, status, balance, detail);
}
//# sourceMappingURL=errors.js.map