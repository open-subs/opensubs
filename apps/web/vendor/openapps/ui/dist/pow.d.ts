/**
 * The proof of work an email code asks for: find a decimal nonce such that
 * SHA-256(`${salt}:${nonce}`) starts with `bits` zero bits.
 *
 * A small synchronous SHA-256 rather than `crypto.subtle.digest`: the
 * search is a quarter of a million tiny hashes, and an awaited digest per
 * attempt spends most of its time in promise plumbing. It yields to the
 * page every few thousand attempts, so typing stays smooth while it runs.
 */
import type { EmailPowChallenge, EmailPowSolution } from "@openapps/sdk";
/** SHA-256 of an ASCII string. Returns the eight state words. */
export declare function sha256Words(text: string): Uint32Array;
/** Leading zero bits of a digest given as state words. */
export declare function leadingZeroBits(words: Uint32Array): number;
/** Solve a challenge. Rejects with an AbortError if `signal` aborts. */
export declare function solvePow(challenge: EmailPowChallenge, signal?: AbortSignal): Promise<EmailPowSolution>;
//# sourceMappingURL=pow.d.ts.map