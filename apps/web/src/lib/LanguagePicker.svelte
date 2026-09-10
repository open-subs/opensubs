<!--
  The language picker.

  A plain <select> rather than a styled menu: it is the one control a
  reader who cannot read the current interface has to find and operate, so
  it gets the browser's own widget, its keyboard behaviour and its
  screen-reader semantics without any of that being re-implemented.

  The option labels are endonyms and are never translated -- 日本語 is
  日本語 in every locale. A picker that lists "Japanese" in English is no
  use to the only person who needs it.
-->
<script lang="ts">
  import { LOCALES, getLocale, setLocale, t } from "./i18n/index.svelte";

  function onChange(event: Event) {
    setLocale((event.currentTarget as HTMLSelectElement).value);
  }
</script>

<label class="lang">
  <span class="lang-hidden">{t("Language")}</span>
  <select
    aria-label={t("Language")}
    value={getLocale()}
    onchange={onChange}
  >
    {#each LOCALES as locale (locale.code)}
      <option value={locale.code} lang={locale.code}>{locale.name}</option>
    {/each}
  </select>
</label>

<style>
  .lang {
    display: inline-flex;
    align-items: center;
  }
  select {
    font: inherit;
    font-size: 0.85rem;
    padding: 0.3rem 1.6rem 0.3rem 0.5rem;
    border: 1px solid var(--border-hairline, #dfe3e9);
    border-radius: var(--radius-md, 8px);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  select:hover {
    background: var(--surface-hover, rgba(0, 0, 0, 0.04));
  }
  .lang-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>
