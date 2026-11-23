<!--
  Credits and the account behind them, in the Mac App Store build.

  Stands in for src/lib/AccountPanel.svelte only in the store build
  (vite.config.ts, OPENSUBS_STORE=1). That panel sells credits through the
  card checkout in the browser; here they are sold through StoreKit, as in
  the iOS app (App Review Guideline 3.1.1), and the account can be deleted
  from inside the app (5.1.1(v)).

  The order a purchase goes through -- pay, redeem on the server, and only
  then tell StoreKit the transaction is finished -- is apps/web/src/lib/iap.ts,
  the iOS app's own, tested in apps/web/e2e/iap.mjs.
-->
<script lang="ts">
  import { onMount } from "svelte";
  import "@openapps/ui/bundle";
  import { notify } from "@openapps/ui/bundle";
  import { PACK, account, iapSession, onAccountChange, signedIn } from "./account";
  import { openSignIn, onSignedIn } from "../lib/signin";
  import { collect, collectOutstanding } from "../../../web/src/lib/iap";
  import { macStore, type NativeProduct } from "./native";

  let loggedIn = $state(signedIn());
  let products = $state<NativeProduct[]>([]);
  let busy = $state<string | null>(null);
  let note = $state<string | null>(null);
  let failure = $state<string | null>(null);
  let confirmingDelete = $state(false);
  let deleting = $state(false);

  onMount(() => {
    const refresh = () => (loggedIn = signedIn());
    const stop = onAccountChange(refresh);
    const signedInListener = onSignedIn(refresh);
    return () => {
      stop();
      void signedInListener.then((un) => un());
    };
  });

  // The catalogue, and the recovery sweep: a purchase paid for and never
  // credited (a crash or a dead network in between) is redeemed unprompted,
  // because somebody in that position has no word for what happened.
  $effect(() => {
    if (!loggedIn) return;
    let live = true;
    void (async () => {
      try {
        const { products: list } = await macStore.products();
        if (live) products = list;
      } catch (e) {
        if (live) failure = e instanceof Error ? e.message : String(e);
      }
      const credited = await collectOutstanding(macStore, iapSession());
      if (live && credited > 0) {
        note = `${credited} credits from an earlier purchase have been added.`;
        notify();
      }
    })();
    return () => {
      live = false;
    };
  });

  // A purchase can also arrive with nobody waiting for it: Ask to Buy
  // approved later, or one interrupted and completed. Same redemption.
  $effect(() => {
    let remove: (() => Promise<void>) | null = null;
    void macStore
      .addListener("transaction", async (purchase) => {
        const result = await collect(purchase, macStore, iapSession());
        if (result.ok) {
          note = `${result.credits} credits added.`;
          notify();
        }
      })
      .then((handle) => {
        remove = handle.remove;
      });
    return () => {
      void remove?.();
    };
  });

  async function buy(product: NativeProduct) {
    busy = product.id;
    failure = null;
    note = null;
    try {
      const outcome = await macStore.purchase({ productId: product.id });
      if (outcome.status === "cancelled") return; // not an error; say nothing
      if (outcome.status === "pending") {
        note = "That purchase needs approval. The credits arrive once it is given.";
        return;
      }
      const result = await collect(outcome, macStore, iapSession());
      if (result.ok) {
        note = `${result.credits} credits added.`;
        notify();
      } else if (result.kind === "offline") {
        // Paid, not yet credited, and the transaction is still alive.
        note = "Paid. The credits will be added as soon as you are back online.";
      } else if (result.kind === "unauthorized") {
        failure = "Sign in again to finish adding these credits.";
      } else {
        failure = result.message ?? "The App Store purchase could not be completed.";
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }

  async function deleteAccount() {
    deleting = true;
    failure = null;
    try {
      await account().auth.deleteAccount();
      confirmingDelete = false;
      notify();
      loggedIn = signedIn();
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      deleting = false;
    }
  }
</script>

<div class="account-body">
  {#if loggedIn}
    <openapps-credits poll-seconds="30"></openapps-credits>
    <div class="packs">
      {#each products as product (product.id)}
        <button
          type="button"
          class="btn btn-secondary btn-sm"
          disabled={busy !== null}
          onclick={() => void buy(product)}
        >
          {busy === product.id ? "Purchasing…" : `${product.name} · ${product.price}`}
        </button>
      {/each}
      {#if products.length === 0 && !failure}
        <span class="oa-caption">Loading the credit packs…</span>
      {/if}
    </div>
    {#if note}<p class="oa-caption">{note}</p>{/if}
    {#if failure}<p class="oa-caption account-error">{failure}</p>{/if}
    <p class="oa-caption">Credits are bought through the App Store, and they do not expire.</p>
    <openapps-signout></openapps-signout>
    {#if confirmingDelete}
      <p class="oa-caption">
        Delete this account and its credits? This cannot be undone. Your videos stay on this Mac.
      </p>
      <div class="packs">
        <button type="button" class="btn btn-danger btn-sm" disabled={deleting} onclick={() => void deleteAccount()}>
          {deleting ? "Deleting…" : "Delete account"}
        </button>
        <button type="button" class="btn btn-ghost btn-sm" disabled={deleting} onclick={() => (confirmingDelete = false)}>
          Keep it
        </button>
      </div>
    {:else}
      <button type="button" class="link-btn" onclick={() => (confirmingDelete = true)}>Delete account…</button>
    {/if}
  {:else}
    <p class="oa-caption">
      Everything in OpenSubs is free on this Mac. An account is only for cloud translation, which
      runs on our servers and uses credits: {PACK.credits.toLocaleString("en")} credits are sold
      through the App Store.
    </p>
    <button type="button" class="btn btn-primary btn-sm" onclick={() => void openSignIn()}>
      Sign in
    </button>
  {/if}
</div>

<style>
  .account-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    align-items: flex-start;
  }

  .packs {
    display: inline-flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .account-error {
    color: var(--text-danger, #b42318);
  }
</style>
