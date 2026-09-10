<script lang="ts">
  // The account controls, in the page's navbar.
  //
  // Mounted separately from `App` and into static HTML, so the marketing
  // copy around it stays in the document rather than being assembled by
  // script. It owns no state: `App` wires the SDK up and writes to the
  // shared session, and this reads it.
  import { session } from "./lib/session.svelte";

  // `<openapps-login>` renders a *stack* of providers -- Google, a wallet,
  // Nostr, a remote signer -- about 160px tall. That is right inside a
  // card, which is where it was before this page had a navbar, and wrong
  // in a 4rem bar: it overflowed the header and printed itself across the
  // headline. So the bar gets a button, and the stack gets a panel under
  // it.
  let open = $state(false);

  function closeOnOutside(event: MouseEvent) {
    if (!(event.target as HTMLElement)?.closest(".nav-account")) open = false;
  }
</script>

<svelte:window on:click={closeOnOutside} on:keydown={(e) => e.key === "Escape" && (open = false)} />

<div class="nav-account">
  {#if session.signedIn}
    <span class="nav-balance" title="Credits, shared across your account">
      <strong>{session.balance}</strong>
      {session.balance === 1 ? "credit" : "credits"}
    </span>
    <openapps-signout></openapps-signout>
  {:else}
    <button
      type="button"
      class="nav-signin"
      aria-expanded={open}
      aria-haspopup="menu"
      onclick={() => (open = !open)}
    >
      Sign in
    </button>
    <!-- Kept in the DOM rather than created on open: the element sets up
         its SDK client on connect, and mounting it at the moment of the
         click puts that work between the press and anything happening. -->
    <div class="nav-panel" class:open role="menu">
      <openapps-login></openapps-login>
    </div>
  {/if}
</div>

<style>
  .nav-account {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-3);
  }

  .nav-balance {
    font-size: var(--text-sm);
    color: var(--text-muted);
    white-space: nowrap;
  }

  .nav-balance strong {
    color: var(--text-body);
  }

  .nav-signin {
    font: inherit;
    font-size: var(--text-sm);
    color: var(--text-body);
    background: transparent;
    border: var(--border-width) solid var(--border-strong);
    border-radius: var(--radius-full);
    padding: var(--space-2) var(--space-4);
    cursor: pointer;
    white-space: nowrap;
  }

  .nav-signin:hover {
    background: var(--surface-hover);
  }

  .nav-panel {
    position: absolute;
    top: calc(100% + var(--space-3));
    right: 0;
    z-index: 20;
    min-width: 15rem;
    padding: var(--space-4);
    background: var(--surface-card);
    border: var(--border-width) solid var(--border-hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    display: none;
  }

  .nav-panel.open {
    display: block;
  }
</style>
