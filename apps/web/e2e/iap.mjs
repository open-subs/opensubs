// Turning an App Store purchase into credits, and the order it happens in.
//
// The rule these tests exist for: a transaction is finished only after the
// server has granted its credits. StoreKit re-delivers an unfinished
// transaction on every launch, which is what makes a purchase survive a
// crash or a dead network between paying and being credited; finishing
// early throws that away and leaves somebody charged for credits nobody
// granted, with no record left to retry from.
//
// The server and StoreKit are both faked here, deliberately. What is being
// tested is the order and the failure handling -- neither of which can be
// produced on demand from a real sandbox account, and both of which are
// exactly what a real sandbox purchase would not exercise: it succeeds.
//
//   node --experimental-strip-types e2e/iap.mjs

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

let pass = 0;
const fails = [];
const ok = (name, cond, detail = "") => {
  if (cond) { pass += 1; return; }
  fails.push(`${name}${detail ? ` -- ${detail}` : ""}`);
};

// --- the fakes -----------------------------------------------------------

/** A StoreKit that records what it was told, in order. */
function fakeStore(receipts = []) {
  const calls = [];
  return {
    calls,
    async products() { calls.push("products"); return { products: [] }; },
    async purchase({ productId }) { calls.push(`purchase:${productId}`); return receipts[0]; },
    async outstanding() { calls.push("outstanding"); return { receipts }; },
    async finish({ transactionId }) { calls.push(`finish:${transactionId}`); return { finished: true }; },
    async addListener() { return { remove: async () => {} }; },
  };
}

const RECEIPT = {
  status: "purchased",
  transactionId: "2000000123456789",
  productId: "opensubs_credits_1000",
  receipt: "eyJ...signed-jws...",
  verifiedLocally: true,
};

/** Stand in for the server, recording every redeem it is asked for. */
function fakeServer(replies) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    const reply = replies.shift() ?? { status: 500, body: {} };
    if (reply.throw) throw new Error("offline");
    return {
      ok: reply.status >= 200 && reply.status < 300,
      status: reply.status,
      json: async () => reply.body,
    };
  };
  return seen;
}

/** The signed-in account, as iap.ts asks for it. */
function fakeSession({ token = "token-1", signedIn = true, refreshes = true } = {}) {
  const state = { token, refreshed: 0 };
  return {
    state,
    authUrl: "https://auth.opensubs.app",
    token: () => state.token,
    signedIn: () => signedIn,
    refresh: async () => {
      state.refreshed += 1;
      if (refreshes) state.token = "token-2";
      return refreshes;
    },
  };
}

// iap.ts imports nothing at runtime -- only a type -- so it loads here as
// it ships, with no source rewriting and nothing stubbed by name.
const iap = await import("../src/lib/iap.ts");

// --- the order -----------------------------------------------------------


{
  const session = fakeSession();
  const store = fakeStore([RECEIPT]);
  const seen = fakeServer([{ status: 200, body: { credits: 1000, status: "credited" } }]);
  const result = await iap.collect(RECEIPT, store, session);
  ok("a granted purchase is finished", store.calls.includes(`finish:${RECEIPT.transactionId}`), JSON.stringify(store.calls));
  ok("and the server was asked first", seen.length === 1 && store.calls.length === 1, JSON.stringify(store.calls));
  ok("the receipt sent is the signed transaction", seen[0].body.signed_transaction === RECEIPT.receipt, JSON.stringify(seen[0].body));
  ok("it goes to the redeem endpoint", seen[0].url.endsWith("/v1/payments/apple/redeem"), seen[0].url);
  ok("and the credits are reported", result.ok && result.credits === 1000, JSON.stringify(result));
}


{
  const session = fakeSession();
  // The expensive case: the server refused. The transaction must stay
  // alive so StoreKit offers it again.
  const store = fakeStore([RECEIPT]);
  fakeServer([{ status: 400, body: { error: "no credit package is mapped to product x" } }]);
  const result = await iap.collect(RECEIPT, store, session);
  ok("a refused receipt is NOT finished", !store.calls.some((c) => c.startsWith("finish")), JSON.stringify(store.calls));
  ok("and the refusal is reported", !result.ok && result.kind === "rejected", JSON.stringify(result));
}


{
  const session = fakeSession();
  const store = fakeStore([RECEIPT]);
  fakeServer([{ throw: true }]);
  const result = await iap.collect(RECEIPT, store, session);
  ok("an offline redemption is NOT finished", !store.calls.some((c) => c.startsWith("finish")), JSON.stringify(store.calls));
  ok("and reads as offline, not as a failed purchase", !result.ok && result.kind === "offline", JSON.stringify(result));
}


{
  const session = fakeSession();
  // A token that aged out: refresh through the SDK and ask once more,
  // rather than telling somebody who has just paid to sign in again.
  const store = fakeStore([RECEIPT]);
  const seen = fakeServer([
    { status: 401, body: {} },
    { status: 200, body: { credits: 1000, status: "credited" } },
  ]);
  const result = await iap.collect(RECEIPT, store, session);
  ok("a stale token is retried once", seen.length === 2, `${seen.length} calls`);
  ok("and the purchase still lands", result.ok && store.calls.includes(`finish:${RECEIPT.transactionId}`), JSON.stringify(store.calls));
}


{
  const session = fakeSession();
  // Replaying a receipt the server has already settled is a duplicate,
  // not a fault: it still has to be finished, or it returns for ever.
  const store = fakeStore([RECEIPT]);
  fakeServer([{ status: 200, body: { credits: 1000, status: "already_processed" } }]);
  const result = await iap.collect(RECEIPT, store, session);
  ok("an already-credited receipt is finished too", store.calls.includes(`finish:${RECEIPT.transactionId}`), JSON.stringify(store.calls));
  ok("and is not counted twice", result.ok && result.alreadyCredited === true, JSON.stringify(result));
}

// --- the startup sweep ---------------------------------------------------


{
  const session = fakeSession();
  const second = { ...RECEIPT, transactionId: "2000000987654321" };
  const store = fakeStore([RECEIPT, second]);
  fakeServer([
    { status: 200, body: { credits: 1000, status: "credited" } },
    { status: 200, body: { credits: 5000, status: "credited" } },
  ]);
  const credited = await iap.collectOutstanding(store, session);
  ok("every owed transaction is swept", credited === 6000, `${credited}`);
  ok("and each one finished", store.calls.filter((c) => c.startsWith("finish")).length === 2, JSON.stringify(store.calls));
}


{
  const session = fakeSession();
  const store = fakeStore([RECEIPT]);
  fakeServer([{ status: 200, body: { credits: 1000, status: "already_processed" } }]);
  const credited = await iap.collectOutstanding(store, session);
  ok("a sweep of already-credited receipts reports nothing new", credited === 0, `${credited}`);
}

{
  // Signed out: nothing is asked of the server, and nothing is finished.
  // StoreKit keeps the transaction, so it is swept after the next sign-in.
  const session = fakeSession({ signedIn: false });
  const store = fakeStore([RECEIPT]);
  const seen = fakeServer([]);
  const credited = await iap.collectOutstanding(store, session);
  ok("a signed-out sweep does nothing at all", credited === 0 && seen.length === 0 && store.calls.length === 0,
    JSON.stringify(store.calls));
}

{
  // The token is stale and the refresh fails too. One retry, no finish,
  // and it reads as unauthorized rather than as a rejected purchase.
  const session = fakeSession({ refreshes: false });
  const store = fakeStore([RECEIPT]);
  const seen = fakeServer([{ status: 401, body: {} }]);
  const result = await iap.collect(RECEIPT, store, session);
  ok("a dead session asks the server once", seen.length === 1, `${seen.length} calls`);
  ok("and does not finish the transaction", !store.calls.some((c) => c.startsWith("finish")), JSON.stringify(store.calls));
  ok("and says unauthorized", !result.ok && result.kind === "unauthorized", JSON.stringify(result));
}

// --- the card checkout must not exist inside the shell -------------------
//
// Guideline 3.1.1 rejects an app that sells digital content used in it by
// any route but Apple's. The guard is one `{#if}` in App.svelte, and the
// way it breaks is somebody adding a second <openapps-buy> somewhere else
// on the page -- which looks harmless, reviews fine, and takes the app
// down. Asserted on the source because the branch it protects cannot be
// reached in a browser: it needs a signed-in session inside an iOS shell.
{
  const app = await readFile(new URL("../src/App.svelte", import.meta.url), "utf8");
  const occurrences = [...app.matchAll(/<openapps-buy\b/g)].map((m) => m.index ?? 0);
  ok("there is exactly one card checkout in the page", occurrences.length === 1, `${occurrences.length} found`);
  for (const at of occurrences) {
    // The guard opens within the few lines above it.
    const before = app.slice(Math.max(0, at - 600), at);
    ok(
      "and it is behind the in-app-purchase guard",
      /\{#if !mustUseInAppPurchase\(\)\}/.test(before),
      before.slice(-160),
    );
  }
  ok(
    "the StoreKit panel is what replaces it",
    /\{:else if appleStore\(\)\}[\s\S]{0,200}<AppleCredits/.test(app),
    "the else-branch does not render AppleCredits",
  );
}

console.log(`\n${pass} passed, ${fails.length} failed`);
for (const f of fails) console.log(`  FAIL ${f}`);
process.exit(fails.length ? 1 : 0);
