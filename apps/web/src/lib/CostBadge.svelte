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
    "free-or-credits": () => t("Free · or credits"),
    "own-key": () => t("Your own API key"),
    paid: () => t("Paid"),
  };

  const TITLE: Record<Cost, () => string> = {
    free: () => t("Runs on your machine. No key, no account, nothing uploaded."),
    "free-or-own-key": () =>
      t("Works for free on this device. Bring an API key for better quality."),
    "free-or-credits": () =>
      t("Free on this device. The cloud option is more fluent and uses credits; you see the price before it runs."),
    "own-key": () =>
      t("Calls a service with your own key. You pay that provider directly; the key stays in this tab."),
    paid: () =>
      t("Runs on our servers and uses credits. You see the price before it runs, and a job that fails costs nothing."),
  };
</script>

<span class="cost-badge cost-{cost}" title={TITLE[cost]()}>{label ?? TEXT[cost]()}</span>
