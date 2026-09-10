<script lang="ts">
  // One badge, used everywhere a capability has a cost, so "free" always
  // looks the same wherever a user meets it. The vocabulary is the
  // engine's (`subs_tier::Cost`), not this component's invention.
  import type { Cost } from "./asr";

  interface Props {
    cost: Cost;
    /** Overrides the default wording, e.g. "Included" for the style pack. */
    label?: string;
  }

  const { cost, label }: Props = $props();

  const TEXT: Record<Cost, string> = {
    free: "Free",
    "free-or-own-key": "Free · or your key",
    "own-key": "Your own API key",
    paid: "Paid",
  };

  const TITLE: Record<Cost, string> = {
    free: "Runs on your machine. No key, no account, nothing uploaded.",
    "free-or-own-key":
      "Works for free on this device. Bring an API key for better quality.",
    "own-key":
      "Calls a service with your own key. You pay that provider directly; the key stays in this tab.",
    paid: "Runs on our backend. Free while we are testing.",
  };
</script>

<span class="cost-badge cost-{cost}" title={TITLE[cost]}>{label ?? TEXT[cost]}</span>
