<script lang="ts">
  // The sign-in sheet that stands in front of exporting a video, when the
  // switch in exportgate.ts says it should.
  //
  // It holds the same `<openapps-login>` the navbar does, so every way of
  // signing in the page already offers is here, and nothing about the
  // account is new. Signing in where it stands (a wallet, Nostr) closes the
  // sheet and the export starts; the parent watches the session for that.
  // Signing in through a provider leaves the page and comes back, and the
  // parent picks the export up from the marker it left before opening this.
  import { t } from "./i18n/index.svelte";

  let { onclose }: { onclose: () => void } = $props();

  let sheet: HTMLDivElement | undefined = $state();

  $effect(() => {
    sheet?.focus();
  });
</script>

<svelte:window on:keydown={(e) => e.key === "Escape" && onclose()} />

<div class="gate-backdrop" role="presentation" onclick={(e) => e.target === e.currentTarget && onclose()}>
  <div
    class="gate-sheet"
    role="dialog"
    aria-modal="true"
    aria-labelledby="export-gate-title"
    tabindex="-1"
    bind:this={sheet}
    data-export-gate
  >
    <h2 id="export-gate-title" class="gate-title">{t("Sign in to export the video")}</h2>
    <p class="oa-caption gate-body">
      {t("Create a free account or sign in to save your video. It is free, and nothing is uploaded: the video is still made here, on your device.")}
    </p>
    <openapps-login></openapps-login>
    <div class="gate-actions">
      <button type="button" class="btn btn-ghost btn-sm" onclick={onclose}>{t("Not now")}</button>
    </div>
  </div>
</div>

<style>
  .gate-backdrop {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: rgb(0 0 0 / 0.45);
  }

  .gate-sheet {
    width: min(26rem, 100%);
    max-height: calc(100vh - 2 * var(--space-4));
    overflow-y: auto;
    padding: var(--space-6, 1.5rem);
    background: var(--surface-card);
    border: var(--border-width) solid var(--border-hairline);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    outline: none;
  }

  .gate-title {
    margin: 0 0 var(--space-2);
    font-size: var(--text-lg, 1.125rem);
    color: var(--text-body);
  }

  .gate-body {
    margin: 0 0 var(--space-4);
  }

  .gate-sheet :global(openapps-login) {
    display: block;
  }

  .gate-actions {
    display: flex;
    justify-content: flex-end;
    margin-top: var(--space-3);
  }
</style>
