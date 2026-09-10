/**
 * Browser signing providers, kept separate from the elements so the tricky
 * part — talking to injected wallets — is testable without a DOM.
 *
 * Both providers are injected by extensions the page does not control, so
 * every entry point checks for presence and every failure is reported as a
 * plain message rather than an exception object the UI would have to
 * interpret.
 */
import type { Namespace, Proof } from "@openapps/sdk";
/** EIP-1193, the interface every EVM wallet extension exposes. */
interface Eip1193Provider {
    request(args: {
        method: string;
        params?: unknown[];
    }): Promise<unknown>;
}
/** NIP-07, the Nostr signer interface. */
interface Nip07Provider {
    getPublicKey(): Promise<string>;
    signEvent(event: NostrTemplate): Promise<NostrEvent>;
}
interface NostrTemplate {
    kind: number;
    content: string;
    tags: string[][];
    created_at?: number;
}
interface NostrEvent extends NostrTemplate {
    id: string;
    pubkey: string;
    sig: string;
    created_at: number;
}
declare global {
    interface Window {
        ethereum?: Eip1193Provider;
        nostr?: Nip07Provider;
        /** OKX namespaces every chain under one object rather than the globals. */
        okxwallet?: Eip1193Provider & {
            nostr?: Nip07Provider;
        };
    }
}
export declare class WalletError extends Error {
    constructor(message: string);
}
/** The first usable Nostr signer, or null. */
export declare function findNostrProvider(): Nip07Provider | null;
/**
 * Wait briefly for a signer to appear.
 *
 * Extensions inject at wildly different moments — some before the page
 * script runs, some after `load`, and multi-chain wallets often register
 * their less-used providers last. Checking once and giving up is why a
 * wallet that is plainly installed reports as missing.
 */
export declare function waitForNostrProvider(timeoutMs?: number): Promise<Nip07Provider | null>;
/** Every place checked, for a diagnostic the user can act on. */
export declare function nostrProviderNames(): string[];
/** What a wallet calls itself, for an error a user can act on. */
export declare function ethereumProviderName(provider: Eip1193Provider | null): string;
/** One wallet the user could choose. */
export interface EthereumWallet {
    /** What the wallet calls itself — shown to the user. */
    name: string;
    provider: Eip1193Provider;
}
/**
 * Every injected provider this page can see, deduplicated.
 *
 * Legacy globals only. `discoverEthereumWallets` is the one to use: this
 * is its fallback for wallets that predate EIP-6963.
 */
export declare function ethereumProviders(): EthereumWallet[];
/**
 * Ask every wallet in the browser to announce itself (EIP-6963).
 *
 * This is the fix for the whole class of problem `window.ethereum`
 * creates. That global holds exactly one provider, so two installed
 * wallets fight over it and the winner is whichever injected last — a
 * user with MetaMask and OKX who wants OKX gets prompted by MetaMask,
 * dismisses it, and is told the connection was rejected. EIP-6963 exists
 * precisely because a single global cannot express "the user has more
 * than one wallet and gets to say which".
 *
 * Announcements are synchronous — a wallet's listener responds during the
 * dispatch below — but the spec allows a later announcement, so this
 * yields once before answering rather than reading the array immediately.
 *
 * Falls back to the legacy globals when nothing announces, so wallets
 * that predate the standard still work.
 */
export declare function discoverEthereumWallets(): Promise<EthereumWallet[]>;
export declare function hasEthereum(): boolean;
export declare function hasNostr(): boolean;
/**
 * Which login methods this browser can perform *right now*.
 *
 * Only a hint. Extensions inject their provider at unpredictable times —
 * some at `document_start`, some after `load`, and multi-chain wallets like
 * OKX may register Nostr later than Ethereum — so a snapshot taken when an
 * element first renders will miss them. Nothing gates a button on this;
 * availability is re-checked when the user actually clicks.
 */
export declare function availableNamespaces(): Namespace[];
/**
 * Sign the challenge with a raw Nostr secret key (`nsec1…`).
 *
 * **This is the unsafe option and is offered only as a fallback.** An nsec
 * is the whole identity: it cannot be rotated without abandoning the
 * account, it is not scoped to this site, and anything running on the page
 * can read it while it is in memory. A NIP-07 extension exists precisely so
 * a site never sees the key.
 *
 * What this does guarantee: the key is used here, in the browser, and the
 * only thing that leaves is a signed event. It is never sent to the server,
 * never written to storage, and the caller is expected to drop it
 * immediately afterwards. `nostr-tools` is loaded on demand so pages that
 * never use this do not pay for the crypto library.
 */
export declare function signNostrWithSecretKey(templateJson: string, nsec: string): Promise<Proof>;
/** Prompt for account access and return the first address. */
export declare function connectEthereum(chosen?: Eip1193Provider): Promise<string>;
/**
 * Sign the SIWE message with EIP-191 `personal_sign`.
 *
 * Parameter order is [message, address] — the reverse of `eth_sign`, and a
 * classic source of "invalid signature" bugs.
 */
export declare function signSiwe(message: string, address: string, chosen?: Eip1193Provider): Promise<Proof>;
/**
 * Fill in and sign the server's NIP-98 event template.
 *
 * The server sends a template without `created_at`; NIP-07 signers are
 * expected to stamp it, but not all do, so it is set here when missing —
 * the server rejects events outside its skew window.
 */
export declare function signNostr(templateJson: string): Promise<Proof>;
/**
 * Sign with a remote signer over NIP-46 ("Nostr Connect", "bunker").
 *
 * Works everywhere — a web page, a Chrome extension, a native app — because
 * it needs nothing injected into the page. The key stays in Amber, nsec.app
 * or a self-hosted bunker, and only signing requests travel: over a relay,
 * encrypted, and approved by the user on the signing device.
 *
 * That makes it the answer for mobile, where no extension can exist, *and*
 * a better default than NIP-07 for anyone who would rather not trust an
 * extension with their key. Strictly better than pasting an nsec, which
 * hands the key to this process outright.
 *
 * `input` is a `bunker://…` URL or a NIP-05 name (`alice@example.com`).
 * `onAuthUrl` fires when the bunker needs the user to approve in a browser;
 * a caller should open it.
 */
export declare function signNostrWithBunker(templateJson: string, input: string, options?: {
    onAuthUrl?: (url: string) => void;
    timeoutMs?: number;
}): Promise<Proof>;
export {};
//# sourceMappingURL=wallet.d.ts.map