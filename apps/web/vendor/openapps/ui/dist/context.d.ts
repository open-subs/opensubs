/**
 * One client, shared by every element on the page.
 *
 * Elements are dropped into HTML, often by someone who never writes a line
 * of JavaScript, so they cannot be handed a client by a parent component.
 * The host configures once — in a script tag or via the `base-url`
 * attribute on any element — and everything else resolves the same
 * instance, which matters because the session lives inside it.
 */
import { OpenApps, type OpenAppsOptions } from "@openapps/sdk";
/** Configure the shared client. Call once, before the elements render. */
export declare function configure(options: OpenAppsOptions): OpenApps;
/** The shared client, if one has been configured or derived from an attribute. */
export declare function getClient(): OpenApps | null;
/**
 * Resolve the client an element should use: an explicitly assigned one, the
 * shared one, or a new shared one built from a `base-url` attribute.
 */
export declare function resolveClient(explicit?: OpenApps, baseUrl?: string): OpenApps;
/**
 * Subscribe to "something about the session or balance may have changed".
 * Deliberately payload-free: elements re-read what they need, so a login in
 * one element refreshes the balance in another without them knowing about
 * each other.
 */
export declare function onChange(listener: () => void): () => void;
export declare function notify(): void;
/** Tests only: forget the shared client so ordering can be exercised. */
export declare function resetClient(): void;
//# sourceMappingURL=context.d.ts.map