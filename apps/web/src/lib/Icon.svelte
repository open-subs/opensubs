<script lang="ts">
  // Small hand-built stroke icon set, drawn in the same visual language the
  // openapps-design system specifies for Lucide (24x24 grid, 2px stroke,
  // round caps/joins, currentColor, no fill) -- vendored locally rather
  // than fetched from the Lucide CDN, since this app should work fully
  // offline like the rest of the OpenApps suite.
  interface Props {
    name: "film" | "folder-open" | "check-circle" | "alert-triangle" | "upload" | "download";
    size?: number;
  }
  let { name, size = 18 }: Props = $props();
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  {#if name === "film"}
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M3 9h18M3 15h18M8 4v16M16 4v16" />
  {:else if name === "folder-open"}
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H6a2 2 0 0 0-1.9 1.4L2 18V7z" />
    <path d="M4.1 11.4 2 18h17l2.4-6.6a1 1 0 0 0-.94-1.4H6a2 2 0 0 0-1.9 1.4Z" />
  {:else if name === "check-circle"}
    <circle cx="12" cy="12" r="9" />
    <path d="m8.5 12.5 2.5 2.5 4.5-5" />
  {:else if name === "alert-triangle"}
    <path d="M12 3.5 21.5 20h-19L12 3.5Z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="17" r="0.5" fill="currentColor" stroke="none" />
  {:else if name === "upload"}
    <path d="M12 15V4M8 8l4-4 4 4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  {:else if name === "download"}
    <path d="M12 4v11M8 11l4 4 4-4" />
    <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
  {/if}
</svg>
