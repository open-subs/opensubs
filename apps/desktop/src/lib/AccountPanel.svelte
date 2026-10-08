<script lang="ts">
  // Credits and the account behind them. Only cloud translation uses
  // credits; everything else in the app is free and needs no account.
  import { onMount } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import "@openapps/ui/bundle";
  import { CHECKOUT_RETURN, PACK, onAccountChange, signedIn } from "./account";
  import { openSignIn, onSignedIn } from "./signin";

  let loggedIn = $state(signedIn());
  let buyError = $state<string | null>(null);
  let body: HTMLDivElement | null = null;

  onMount(() => {
    const refresh = () => (loggedIn = signedIn());
    const stop = onAccountChange(refresh);
    const signedInListener = onSignedIn(refresh);
    // Card checkout is a web page. Opened inside this window it would
    // replace the app; it opens in the browser instead, and the balance
    // updates here when the payment lands.
    const onCheckout = (event: Event) => {
      const url = (event as CustomEvent<{ url: string }>).detail?.url;
      if (!url) return;
      event.preventDefault();
      buyError = null;
      openUrl(url).catch((e) => (buyError = `Could not open the checkout page: ${e}`));
    };
    body?.addEventListener("openapps-checkout", onCheckout);
    return () => {
      stop();
      void signedInListener.then((un) => un());
      body?.removeEventListener("openapps-checkout", onCheckout);
    };
  });
</script>

<div class="account-body" bind:this={body}>
  {#if loggedIn}
    <openapps-credits poll-seconds="30"></openapps-credits>
    <openapps-buy return-to={CHECKOUT_RETURN}></openapps-buy>
    {#if buyError}<p class="oa-caption account-error">{buyError}</p>{/if}
    <p class="oa-caption">
      Checkout opens in your browser. Credits appear here once the payment goes through, and
      they do not expire.
    </p>
    <openapps-signout></openapps-signout>
  {:else}
    <p class="oa-caption">
      Everything in OpenSubs is free on this computer. An account is only for cloud translation,
      which runs on our servers and uses credits: {PACK.credits.toLocaleString("en")} credits cost ${PACK.usd}.
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

  .account-error {
    color: var(--text-danger, #b42318);
  }
</style>
