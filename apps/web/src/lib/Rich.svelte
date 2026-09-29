<!--
  A translated sentence that keeps its emphasis.

  A catalogue entry is plain text, so `<strong>` cannot sit inside one --
  and splitting a sentence around the bold word leaves each language
  stuck with English word order. So emphasis travels inside the string as
  `**strong**` and `*em*`, and this draws it. Nothing is parsed as HTML:
  a translation cannot inject markup, only mark a span.
-->
<script lang="ts">
  let { text }: { text: string } = $props();

  const parts = $derived(
    text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).map((s) =>
      s.startsWith("**") && s.endsWith("**") && s.length > 4
        ? { kind: "strong", s: s.slice(2, -2) }
        : s.startsWith("*") && s.endsWith("*") && s.length > 2
          ? { kind: "em", s: s.slice(1, -1) }
          : { kind: "text", s },
    ),
  );
</script>

{#each parts as p, i (i)}{#if p.kind === "strong"}<strong>{p.s}</strong>{:else if p.kind === "em"}<em>{p.s}</em>{:else}{p.s}{/if}{/each}
