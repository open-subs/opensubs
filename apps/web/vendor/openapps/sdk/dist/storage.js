export function memoryStore(initial = null) {
    let session = initial;
    return {
        get: () => session,
        set: (next) => {
            session = next;
        },
    };
}
/**
 * `localStorage` under one key, so a reload keeps the user logged in.
 * Falls back to memory wherever `localStorage` is missing or throws
 * (Safari private mode, sandboxed iframes, server-side rendering).
 */
export function localStorageStore(key = "openapps.session") {
    let backing = null;
    try {
        backing = typeof localStorage !== "undefined" ? localStorage : null;
        // Presence is not permission: private mode throws only on write.
        backing?.setItem(key, backing.getItem(key) ?? "");
        if (backing?.getItem(key) === "")
            backing.removeItem(key);
    }
    catch {
        backing = null;
    }
    if (!backing)
        return memoryStore();
    const storage = backing;
    return {
        get() {
            const raw = storage.getItem(key);
            if (!raw)
                return null;
            try {
                const parsed = JSON.parse(raw);
                return parsed.accessToken && parsed.refreshToken ? parsed : null;
            }
            catch {
                return null;
            }
        },
        set(session) {
            if (session)
                storage.setItem(key, JSON.stringify(session));
            else
                storage.removeItem(key);
        },
    };
}
/**
 * Pick the sensible default for the current runtime.
 *
 * `typeof localStorage` is not a safe probe. When a browser refuses storage
 * access — third-party context, "block all cookies", a privacy extension —
 * the property is still *present* and its getter throws `SecurityError`, so
 * the very check meant to detect absence is what throws. Unguarded, that
 * propagates out of `configure()` and takes down the whole app rather than
 * costing it persistence, which is the opposite of the intended fallback.
 */
export function defaultStore() {
    try {
        return typeof localStorage !== "undefined" ? localStorageStore() : memoryStore();
    }
    catch {
        return memoryStore();
    }
}
/**
 * Adapt an async backend to the synchronous [`TokenStore`] the client needs.
 *
 * The client reads the session on every request and cannot await, so an
 * in-memory copy is the source of truth during a session: hydrated once at
 * construction, written through on every change. Writes are fire-and-forget
 * because nothing the caller does should block on persistence — a failed
 * write costs the session on next startup, not this one.
 */
export function asyncBackedStore(backend, onError) {
    let session = null;
    let hydrated = false;
    const ready = backend
        .load()
        .then((loaded) => {
        // A login that raced the hydration wins: it is newer than whatever
        // was on disk, and clobbering it would silently log the user out.
        if (!hydrated)
            session = loaded;
    })
        .catch((error) => {
        onError?.(error);
    })
        .then(() => {
        hydrated = true;
    });
    return {
        ready,
        get: () => session,
        set(next) {
            session = next;
            hydrated = true;
            backend.save(next).catch((error) => onError?.(error));
        },
    };
}
//# sourceMappingURL=storage.js.map