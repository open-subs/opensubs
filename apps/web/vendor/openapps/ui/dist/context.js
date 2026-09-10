/**
 * One client, shared by every element on the page.
 *
 * Elements are dropped into HTML, often by someone who never writes a line
 * of JavaScript, so they cannot be handed a client by a parent component.
 * The host configures once — in a script tag or via the `base-url`
 * attribute on any element — and everything else resolves the same
 * instance, which matters because the session lives inside it.
 */
import { OpenApps } from "@openapps/sdk";
import { captureReferral } from "./referral-code.js";
let shared = null;
/** Configure the shared client. Call once, before the elements render. */
export function configure(options) {
    shared = new OpenApps(options);
    // Capture `?ref=` here rather than at sign-in time. Every app calls
    // configure() once per page, including the landing page a referral link
    // actually points at — which usually mounts no OpenApps element at all,
    // and so would see the code and drop it. Sign-in frequently happens on a
    // different URL (a /login popup), where the query string is long gone.
    captureReferral();
    notify();
    return shared;
}
/** The shared client, if one has been configured or derived from an attribute. */
export function getClient() {
    return shared;
}
/**
 * Resolve the client an element should use: an explicitly assigned one, the
 * shared one, or a new shared one built from a `base-url` attribute.
 */
export function resolveClient(explicit, baseUrl) {
    if (explicit)
        return explicit;
    if (shared)
        return shared;
    if (baseUrl)
        return configure({ baseUrl });
    throw new Error("no OpenApps client: call configure({ baseUrl }) or set base-url on the element");
}
// --- session change fan-out ---------------------------------------------
const listeners = new Set();
/**
 * Subscribe to "something about the session or balance may have changed".
 * Deliberately payload-free: elements re-read what they need, so a login in
 * one element refreshes the balance in another without them knowing about
 * each other.
 */
export function onChange(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}
export function notify() {
    for (const listener of listeners)
        listener();
}
/** Tests only: forget the shared client so ordering can be exercised. */
export function resetClient() {
    shared = null;
}
//# sourceMappingURL=context.js.map