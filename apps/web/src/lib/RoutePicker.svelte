<script lang="ts">
  import { t } from "./i18n/index.svelte";
  // Three ways to do one job, side by side.
  //
  // Subtitles and translation each have the same three routes -- run it
  // here for nothing, send it to a service you pay directly, or send it to
  // ours and pay in credits -- and the choice between them is the same
  // choice both times. A dropdown hid that: it made three unlike things
  // look like three flavours of one thing, and it hid the price behind an
  // interaction, so the free option and the paid one read identically until
  // you opened the menu.
  //
  // Laid out as columns, the trade-off is the layout. Cost is visible on
  // all three at once, which is the comparison a user is actually making.

  import CostBadge from "./CostBadge.svelte";
  import type { Cost } from "./asr";

  export interface Route {
    id: string;
    /** Column heading. Short: it sits above a badge and a sentence. */
    label: string;
    cost: Cost;
    /** One line on what this route is for. */
    note: string;
    /**
     * Short badge text. The default vocabulary spells out "Your own API
     * key", which reads as an echo directly under a column headed the same
     * thing -- so a column that already says it passes a shorter form. The
     * full wording survives in the badge's tooltip.
     */
    costLabel?: string;
    /**
     * Shown in place of the price when the route cannot be chosen —
     * "needs the audio", "not in this build". Disables the column.
     */
    unavailable?: string;
    /** The price, already formatted. Only the paid route has one. */
    price?: string;
  }

  interface Props {
    routes: Route[];
    selected: string;
    /** Locked while a job is running: switching mid-run does nothing good. */
    disabled?: boolean;
    onselect: (id: string) => void;
  }

  const { routes, selected, disabled = false, onselect }: Props = $props();
</script>

<div class="routes" role="radiogroup">
  {#each routes as route (route.id)}
    <button
      type="button"
      role="radio"
      aria-checked={selected === route.id}
      class="route"
      class:selected={selected === route.id}
      disabled={disabled || Boolean(route.unavailable)}
      onclick={() => onselect(route.id)}
    >
      <span class="route-head">
        <span class="route-label">{t(route.label)}</span>
        <CostBadge cost={route.cost} label={route.costLabel && t(route.costLabel)} />
      </span>
      <span class="route-note">{t(route.note)}</span>
      {#if route.unavailable}
        <span class="route-price route-unavailable">{t(route.unavailable)}</span>
      {:else if route.price}
        <span class="route-price">{route.price}</span>
      {/if}
    </button>
  {/each}
</div>
