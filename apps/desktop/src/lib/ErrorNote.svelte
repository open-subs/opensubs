<script lang="ts">
  // A failure as a sentence, with what the tools said behind a toggle.
  // The sentence never holds a path; the details have the home directory
  // taken out on the Rust side (commands.rs, `redact`).
  import type { UserError } from "./api";

  let { error }: { error: UserError } = $props();
</script>

<p class="error-message">{error.message}</p>
{#if error.details}
  <details class="error-details">
    <summary>Details</summary>
    <pre class="oa-mono">{error.details}</pre>
  </details>
{/if}

<style>
  .error-message {
    margin: 0;
  }
  .error-details {
    margin-top: 6px;
  }
  .error-details summary {
    cursor: pointer;
    font-size: 12px;
    color: var(--text-muted);
  }
  .error-details pre {
    margin: 6px 0 0;
    max-height: 160px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-word;
    font-size: 11px;
    padding: 8px;
    border-radius: 6px;
    background: var(--bg-sunken);
  }
</style>
