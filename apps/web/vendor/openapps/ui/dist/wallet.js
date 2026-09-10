export class WalletError extends Error {
    constructor(message) {
        super(message);
        this.name = "WalletError";
    }
}
/**
 * Where a NIP-07 signer might live.
 *
 * `window.nostr` is the standard and what Alby, nos2x and friends use. OKX
 * does not take that global — it hangs every chain off `window.okxwallet`,
 * so a page that only checks `window.nostr` concludes the user has no
 * signer while one is sitting right there.
 */
function nostrProviders() {
    if (typeof window === "undefined")
        return [];
    return [
        { where: "window.nostr", provider: window.nostr },
        { where: "window.okxwallet.nostr", provider: window.okxwallet?.nostr },
    ];
}
function isNip07(candidate) {
    const p = candidate;
    return !!p && typeof p.getPublicKey === "function" && typeof p.signEvent === "function";
}
/** The first usable Nostr signer, or null. */
export function findNostrProvider() {
    for (const { provider } of nostrProviders()) {
        if (isNip07(provider))
            return provider;
    }
    return null;
}
/**
 * Wait briefly for a signer to appear.
 *
 * Extensions inject at wildly different moments — some before the page
 * script runs, some after `load`, and multi-chain wallets often register
 * their less-used providers last. Checking once and giving up is why a
 * wallet that is plainly installed reports as missing.
 */
export async function waitForNostrProvider(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
        const provider = findNostrProvider();
        if (provider)
            return provider;
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            return null;
        // Never sleep past the deadline: a fixed interval would make a short
        // timeout take a full interval to give up.
        await new Promise((resolve) => setTimeout(resolve, Math.min(100, remaining)));
    }
}
/** Every place checked, for a diagnostic the user can act on. */
export function nostrProviderNames() {
    return nostrProviders().map((p) => p.where);
}
/** What a wallet calls itself, for an error a user can act on. */
export function ethereumProviderName(provider) {
    if (!provider)
        return "wallet";
    const flags = provider;
    // Only reached without EIP-6963, which carries a real name. These flags
    // are all a legacy injected object offers.
    if (flags.isOkxWallet)
        return "OKX Wallet";
    if (flags.isCoinbaseWallet)
        return "Coinbase Wallet";
    if (flags.isMetaMask)
        return "MetaMask";
    return "wallet";
}
/**
 * EIP-1193 providers, same story: OKX also answers on its own object.
 *
 * The order matters more than it looks. `window.ethereum` is a single
 * global that every wallet extension writes to, so with two installed the
 * winner is whichever injected last — not whichever the user meant. OKX
 * is the common case here because it always mirrors itself onto
 * `window.okxwallet`, so it stays reachable even when it lost that race;
 * the reverse is not true of most others.
 */
function findEthereumProvider() {
    if (typeof window === "undefined")
        return null;
    for (const candidate of [window.ethereum, window.okxwallet]) {
        if (candidate && typeof candidate.request === "function")
            return candidate;
    }
    return null;
}
/**
 * Every injected provider this page can see, deduplicated.
 *
 * Legacy globals only. `discoverEthereumWallets` is the one to use: this
 * is its fallback for wallets that predate EIP-6963.
 */
export function ethereumProviders() {
    if (typeof window === "undefined")
        return [];
    const seen = new Set();
    const out = [];
    for (const candidate of [window.ethereum, window.okxwallet]) {
        if (!candidate || typeof candidate.request !== "function")
            continue;
        if (seen.has(candidate))
            continue;
        seen.add(candidate);
        out.push({ name: ethereumProviderName(candidate), provider: candidate });
    }
    return out;
}
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
export async function discoverEthereumWallets() {
    if (typeof window === "undefined")
        return [];
    const found = new Map();
    const onAnnounce = (event) => {
        const detail = event.detail;
        const provider = detail?.provider;
        const info = detail?.info;
        if (!provider || typeof provider.request !== "function")
            return;
        // Keyed by uuid so a wallet announcing twice — which happens when a
        // page requests more than once — is still one entry.
        const key = info?.uuid ?? info?.name ?? String(found.size);
        if (found.has(key))
            return;
        found.set(key, { name: info?.name ?? ethereumProviderName(provider), provider });
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    window.removeEventListener("eip6963:announceProvider", onAnnounce);
    return found.size > 0 ? [...found.values()] : ethereumProviders();
}
export function hasEthereum() {
    return findEthereumProvider() !== null;
}
export function hasNostr() {
    return findNostrProvider() !== null;
}
/**
 * Which login methods this browser can perform *right now*.
 *
 * Only a hint. Extensions inject their provider at unpredictable times —
 * some at `document_start`, some after `load`, and multi-chain wallets like
 * OKX may register Nostr later than Ethereum — so a snapshot taken when an
 * element first renders will miss them. Nothing gates a button on this;
 * availability is re-checked when the user actually clicks.
 */
export function availableNamespaces() {
    const available = [];
    if (hasEthereum())
        available.push("eip155");
    if (hasNostr())
        available.push("nostr");
    return available;
}
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
export async function signNostrWithSecretKey(templateJson, nsec) {
    let template;
    try {
        template = JSON.parse(templateJson);
    }
    catch {
        throw new WalletError("server sent an unreadable Nostr challenge");
    }
    const { nip19, finalizeEvent } = await import("nostr-tools");
    let secret;
    try {
        const decoded = nip19.decode(nsec.trim());
        if (decoded.type !== "nsec") {
            throw new WalletError(`that is an ${decoded.type} key — sign-in needs the secret key, which starts with nsec1`);
        }
        secret = decoded.data;
    }
    catch (cause) {
        if (cause instanceof WalletError)
            throw cause;
        throw new WalletError("that does not look like a valid nsec1… key");
    }
    try {
        const event = finalizeEvent({
            kind: template.kind,
            content: template.content,
            tags: template.tags,
            created_at: template.created_at ?? Math.floor(Date.now() / 1000),
        }, secret);
        return { type: "nostr_event", event: JSON.stringify(event) };
    }
    finally {
        // Not a real guarantee — JS strings are immutable and the decoded copy
        // may already have been copied by the engine — but it removes the most
        // obvious lingering reference.
        secret.fill(0);
    }
}
/** Prompt for account access and return the first address. */
export async function connectEthereum(chosen) {
    const provider = chosen ?? findEthereumProvider();
    if (!provider)
        throw new WalletError("no Ethereum wallet found in this browser");
    const name = ethereumProviderName(provider);
    // Ask what we already have before asking for more. `eth_accounts` is
    // silent — no prompt, no permission request — and returns the accounts
    // this origin has already been granted. Going straight to
    // `eth_requestAccounts` raises a fresh permission request every time,
    // which is both a needless prompt for anyone who has connected before
    // and the thing that collides with an approval still sitting unanswered
    // in the wallet ("already pending for origin …"). One of those can be
    // left behind by a window that closed before the user got to it, and it
    // then blocks every later attempt until they go and clear it.
    try {
        const existing = await provider.request({ method: "eth_accounts" });
        const already = Array.isArray(existing) ? existing[0] : undefined;
        if (typeof already === "string" && already)
            return already;
    }
    catch {
        // A wallet that doesn't answer this still gets the full request below.
    }
    let accounts;
    try {
        accounts = await provider.request({ method: "eth_requestAccounts" });
    }
    catch (cause) {
        // Named, because "wallet connection was rejected" is unactionable when
        // more than one wallet is installed: `window.ethereum` is a single
        // global and the wallet that answers is whichever injected last, so
        // the prompt a user dismissed may well have been from a wallet they
        // were not trying to use. Saying which one turns "it didn't work"
        // into something they can see is wrong.
        throw new WalletError(rejectionMessage(cause, `${name} rejected the connection`));
    }
    const address = Array.isArray(accounts) ? accounts[0] : undefined;
    if (typeof address !== "string" || !address) {
        throw new WalletError("wallet returned no accounts");
    }
    return address;
}
/**
 * Sign the SIWE message with EIP-191 `personal_sign`.
 *
 * Parameter order is [message, address] — the reverse of `eth_sign`, and a
 * classic source of "invalid signature" bugs.
 */
export async function signSiwe(message, address, chosen) {
    // The same provider that connected, or the signature request goes to a
    // different wallet than the address came from — which fails, confusingly,
    // as a signature mismatch rather than as the wrong wallet.
    const provider = chosen ?? findEthereumProvider();
    if (!provider)
        throw new WalletError("no Ethereum wallet found in this browser");
    try {
        const signature = await provider.request({
            method: "personal_sign",
            params: [message, address],
        });
        if (typeof signature !== "string")
            throw new WalletError("wallet returned no signature");
        return { type: "signature", signature };
    }
    catch (cause) {
        if (cause instanceof WalletError)
            throw cause;
        throw new WalletError(rejectionMessage(cause, "signature was rejected"));
    }
}
/**
 * Fill in and sign the server's NIP-98 event template.
 *
 * The server sends a template without `created_at`; NIP-07 signers are
 * expected to stamp it, but not all do, so it is set here when missing —
 * the server rejects events outside its skew window.
 */
export async function signNostr(templateJson) {
    // Wait rather than check once: the click may land before a slow
    // extension has finished registering its provider.
    const provider = await waitForNostrProvider();
    if (!provider) {
        throw new WalletError(`no Nostr signer answered (looked at ${nostrProviderNames().join(", ")})`);
    }
    let template;
    try {
        template = JSON.parse(templateJson);
    }
    catch {
        throw new WalletError("server sent an unreadable Nostr challenge");
    }
    template.created_at ??= Math.floor(Date.now() / 1000);
    try {
        const event = await provider.signEvent(template);
        return { type: "nostr_event", event: JSON.stringify(event) };
    }
    catch (cause) {
        throw new WalletError(rejectionMessage(cause, "signing was rejected"));
    }
}
/**
 * How long to wait on a remote signer before giving up.
 *
 * NIP-46 signing is a round trip through a relay to an app that may be
 * asleep on someone's phone, and a request that never returns would leave
 * the UI stuck on "signing…" forever. Generous, because the user may have
 * to unlock the device and tap approve.
 */
const BUNKER_TIMEOUT_MS = 60_000;
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
export async function signNostrWithBunker(templateJson, input, options = {}) {
    let template;
    try {
        template = JSON.parse(templateJson);
    }
    catch {
        throw new WalletError("server sent an unreadable Nostr challenge");
    }
    const [{ BunkerSigner, parseBunkerInput }, { generateSecretKey }] = await Promise.all([
        import("nostr-tools/nip46"),
        import("nostr-tools/pure"),
    ]);
    const pointer = await parseBunkerInput(input.trim()).catch(() => null);
    if (!pointer) {
        throw new WalletError("that is not a bunker:// address or a NIP-05 name — copy the connection " +
            "string from your signer app");
    }
    // A fresh client key per attempt: it identifies this app to the bunker
    // and is worth nothing on its own, so there is no reason to keep it.
    const signer = BunkerSigner.fromBunker(generateSecretKey(), pointer, {
        onauth: (url) => options.onAuthUrl?.(url),
    });
    try {
        const event = await withTimeout((async () => {
            await signer.connect();
            return signer.signEvent({
                kind: template.kind,
                content: template.content,
                tags: template.tags,
                created_at: template.created_at ?? Math.floor(Date.now() / 1000),
            });
        })(), options.timeoutMs ?? BUNKER_TIMEOUT_MS, "the signer did not respond — check it is running and try again");
        return { type: "nostr_event", event: JSON.stringify(event) };
    }
    catch (cause) {
        if (cause instanceof WalletError)
            throw cause;
        throw new WalletError(cause instanceof Error ? cause.message : "the remote signer refused");
    }
    finally {
        // Always drop the relay subscription, successful or not.
        await signer.close().catch(() => { });
    }
}
function withTimeout(work, ms, message) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new WalletError(message)), ms);
        work.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, (error) => {
            clearTimeout(timer);
            reject(error);
        });
    });
}
/**
 * Turn whatever a wallet threw into something a person can act on.
 *
 * The previous version collapsed too much into `fallback`. A thrown
 * value with no `code` and no `message` — a bare string, an object of a
 * shape this code did not expect — came back as "rejected", which
 * asserts a specific thing (the user said no) about a failure nobody had
 * identified. Two reports arrived saying exactly that: a wallet
 * connection and a Nostr signature both "rejected", from providers that
 * do not even share an error convention, which is the shape of a message
 * that is guessing.
 *
 * So: 4001 is EIP-1193's "user rejected", and a message that says as
 * much is taken at its word. Everything else keeps whatever detail it
 * came with — a message, a code, or the value itself — because a strange
 * string a user can quote beats a confident sentence that is wrong.
 */
function rejectionMessage(cause, fallback) {
    if (cause === null || cause === undefined)
        return fallback;
    if (typeof cause === "string") {
        return looksLikeRejection(cause) ? fallback : cause;
    }
    if (typeof cause === "object") {
        const error = cause;
        // EIP-1193's user-rejection code. Nostr signers have no such
        // convention, which is why the message check below matters more
        // there.
        if (error.code === 4001)
            return fallback;
        // -32002 is "a request is already open". The wallet's own wording
        // ends "Please wait", which is misleading: the pending request is
        // usually one nobody is looking at — left by a window that closed
        // before it was answered — and waiting never clears it.
        if (error.code === -32002) {
            return "Your wallet already has a request waiting. Open the wallet, finish or dismiss it, then try again.";
        }
        const detail = error.message ?? error.reason;
        if (detail)
            return looksLikeRejection(detail) ? fallback : detail;
        if (error.code !== undefined)
            return `${fallback} (code ${error.code})`;
    }
    // Nothing recognisable. Say so, rather than naming a cause.
    const shown = String(cause);
    return shown && shown !== "[object Object]" ? shown : fallback;
}
/** Whether a provider's own words already say the user declined. */
function looksLikeRejection(text) {
    return /\b(reject|denied|declin|cancel)/i.test(text);
}
//# sourceMappingURL=wallet.js.map