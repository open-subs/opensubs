/**
 * `@openapps/sdk` — zero-dependency client for a OpenApps server.
 *
 * ```ts
 * const openapps = new OpenApps({ baseUrl: "https://accounts.example.com" });
 * const { challenge_id, message } = await openapps.auth.challenge("eip155", address);
 * const signature = await wallet.signMessage(message);
 * await openapps.auth.verify(challenge_id, { type: "signature", signature });
 * console.log(await openapps.credits.balance());
 * ```
 *
 * The session is stored and refreshed for you; every call after `verify`
 * is authenticated automatically.
 */
export { OpenApps, type OpenAppsOptions } from "./client.js";
export { OpenAppsError, type ErrorCode } from "./errors.js";
export { asyncBackedStore, localStorageStore, memoryStore, type AsyncTokenBackend, type HydratingTokenStore, type Session, type TokenStore, } from "./storage.js";
export type * from "./types.js";
//# sourceMappingURL=index.d.ts.map