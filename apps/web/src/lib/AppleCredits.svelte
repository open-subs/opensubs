<!--
  Buying credits through the App Store.

  This replaces <openapps-buy> inside the iOS shell, and the replacement is
  not a preference: App Store Review Guideline 3.1.1 requires digital
  content used in an app to be sold through in-app purchase, so a card
  checkout here is the one thing that must not be on screen. The swap is in
  App.svelte, on `appleStore()`, so nothing has to remember it.

  The order a purchase goes through -- pay, redeem on the server, and only
  then tell StoreKit the transaction is finished -- lives in ./iap.ts and
  is tested there. This file is the part a person looks at.
-->
<script lang="ts">
  import { iapSession } from "./account";
  import { collect, collectOutstanding } from "./iap";
  import type { NativeProduct, NativeStore } from "./native";
  import { t } from "./i18n/index.svelte";

  interface Props {
    store: NativeStore;
    /** Called after credits land, so the balance on screen re-reads. */
    oncredited: () => void;
  }
  let { store, oncredited }: Props = $props();

  let products = $state<NativeProduct[]>([]);
  let busy = $state<string | null>(null);
  let note = $state<string | null>(null);
  let failure = $state<string | null>(null);

  // Catalogue and recovery, both at startup.
  //
  // The sweep is unprompted on purpose. It exists for a purchase that was
  // paid for and never credited -- a crash or a dead network between the
  // two -- and somebody in that position has no way to describe what
  // happened, so asking them to find a "Restore purchases" button is
  // asking them to know a word for a bug.
  $effect(() => {
    let live = true;
    void (async () => {
      try {
        const { products: list } = await store.products();
        if (live) products = list;
      } catch (e) {
        if (live) failure = e instanceof Error ? e.message : String(e);
      }
      const credited = await collectOutstanding(store, iapSession());
      if (live && credited > 0) {
        note = t("{credits} credits from an earlier purchase have been added.", {
          credits: credited,
        });
        oncredited();
      }
    })();
    return () => {
      live = false;
    };
  });

  // A purchase can also arrive with nobody waiting for it: an Ask to Buy
  // approved by a parent hours later, or one made on another device. It is
  // the same redemption, so it takes the same path.
  $effect(() => {
    let remove: (() => Promise<void>) | null = null;
    void store
      .addListener("transaction", async (purchase) => {
        const result = await collect(purchase, store, iapSession());
        if (result.ok) {
          note = t("{credits} credits added.", { credits: result.credits });
          oncredited();
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
      const outcome = await store.purchase({ productId: product.id });
      if (outcome.status === "cancelled") return; // not an error; say nothing
      if (outcome.status === "pending") {
        note = t("That purchase needs approval. The credits arrive once it is given.");
        return;
      }
      const result = await collect(outcome, store, iapSession());
      if (result.ok) {
        note = t("{credits} credits added.", { credits: result.credits });
        oncredited();
      } else if (result.kind === "offline") {
        // Paid, not yet credited, and the transaction is still alive.
        // Saying "failed" here would be false and would invite a second
        // purchase of something already bought.
        note = t("Paid. The credits will be added as soon as you are back online.");
      } else if (result.kind === "unauthorized") {
        failure = t("Sign in again to finish adding these credits.");
      } else {
        failure = result.message ?? t("The App Store purchase could not be completed.");
      }
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
    } finally {
      busy = null;
    }
  }
</script>

<div class="apple-credits">
  {#each products as product (product.id)}
    <button
      type="button"
      class="btn btn-secondary btn-sm"
      disabled={busy !== null}
      onclick={() => buy(product)}
    >
      {busy === product.id ? t("Purchasing…") : `${product.name} · ${product.price}`}
    </button>
  {/each}
  {#if products.length === 0 && !failure}
    <span class="oa-caption">{t("Loading the credit packs…")}</span>
  {/if}
  {#if note}<span class="oa-caption">{note}</span>{/if}
  {#if failure}<span class="field-error">{failure}</span>{/if}
</div>

<style>
  .apple-credits {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
</style>
