<script lang="ts">
  // One badge, used everywhere a capability has a cost, so "free" always
  // looks the same wherever a user meets it. The vocabulary is the
  // engine's (`subs_tier::Cost`), not this component's invention.
  import type { Cost } from "./asr";
  import { t } from "./i18n/index.svelte";

  interface Props {
    cost: Cost;
    /** Overrides the default wording, e.g. "Included" for the style pack. */
    label?: string;
  }

  const { cost, label }: Props = $props();

  // Functions, so each t() re-reads the locale when the language changes.
  const TEXT: Record<Cost, () => string> = {
    free: () => t("Free"),
    "free-or-own-key": () => t("Free · or your key"),
    "own-key": () => t("Your own API key"),
    paid: () => t("Paid"),
  };

  const TITLE: Record<Cost, () => string> = {
    free: () => t("Runs on your machine. No key, no account, nothing uploaded."),
    "free-or-own-key": () =>
      t("Works for free on this device. Bring an API key for better quality."),
    "own-key": () =>
      t("Calls a service with your own key. You pay that provider directly; the key stays in this tab."),
    paid: () => t("Runs on our backend. Free while we are testing."),
  };
</script>

<span class="cost-badge cost-{cost}" title={TITLE[cost]()}>{label ?? TEXT[cost]()}</span>
