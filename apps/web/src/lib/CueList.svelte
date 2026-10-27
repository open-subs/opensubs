<script lang="ts">
  // The subtitle list: each cue's start and end, its text, and the edits
  // that change which cues there are.
  //
  // Every edit goes through `cueedit.ts`, which moves the cues, the
  // original of a translation and the per-word loudness together, and comes
  // back here as a whole new track for the parent to keep. Nothing in this
  // file changes a cue in place.
  import { tick } from "svelte";
  import { t } from "./i18n/index.svelte";
  import {
    clearCheck,
    formatClock,
    insertAfter,
    insertAtPlayhead,
    mergeWithNext,
    parseClock,
    removeCue,
    setText,
    setTimes,
    splitAtPlayhead as splitAtTime,
    splitCue,
    timeAtPlayhead,
    type Edit,
    type Track,
  } from "./cueedit";
  import type { Cue } from "./engine";

  let {
    cues,
    source,
    loudness,
    selected = $bindable(),
    duration,
    playhead,
    onseek,
    onedit,
    onsettle,
    canUndo,
    canRedo,
    onundo,
    onredo,
  }: {
    cues: Track["cues"];
    source: Cue[] | null;
    loudness: number[][];
    selected: number | null;
    /** Seconds; 0 when no video is loaded. */
    duration: number;
    /** The video's current time, or null when there is no video to take it from. */
    playhead: () => number | null;
    onseek: (seconds: number) => void;
    /** A finished edit. `key` names a run of typing, kept as one undo step. */
    onedit: (track: Track, select: number | null, key?: string) => void;
    /** Typing in a box has stopped: the next keystroke is a new undo step. */
    onsettle: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onundo: () => void;
    onredo: () => void;
  } = $props();

  /** Why the last edit was refused, said beside its cue (-1: above the list). */
  let problem = $state<{ i: number; text: string } | null>(null);
  /**
   * Where the cursor was in a text box, kept as it leaves the box: pressing
   * "Split at cursor" takes focus to the button, and the cursor with it.
   */
  let caret: { i: number; field: "cue" | "source"; offset: number } | null = null;
  let list: HTMLOListElement | undefined = $state();

  /** One original per cue: the list shows it under the translation. */
  const paired = $derived(!!source && source.length === cues.length);
  const track = (): Track => ({ cues, source, loudness });

  function apply(i: number, edit: Edit, key?: string): boolean {
    if (!edit.ok) {
      problem = { i, text: t(edit.error, edit.params) };
      return false;
    }
    problem = null;
    onedit(edit.track, edit.select, key);
    return true;
  }

  /** Apply an edit that makes a cue, and put the cursor in its text. */
  async function applyAndFocus(i: number, edit: Edit) {
    if (!apply(i, edit) || !edit.ok || edit.select === null) return;
    caret = null;
    await tick();
    const box = list?.children[edit.select]?.querySelector<HTMLTextAreaElement>("textarea.cue-text");
    box?.focus();
    box?.scrollIntoView({ block: "nearest" });
  }

  function keepCaret(i: number, field: "cue" | "source", el: HTMLTextAreaElement) {
    caret = { i, field, offset: el.selectionStart ?? 0 };
    onsettle();
  }

  function splitAtCursor(i: number) {
    if (!caret || caret.i !== i) {
      problem = { i, text: t("Put the cursor where the subtitle should break.") };
      return;
    }
    void applyAndFocus(i, splitCue(track(), i, { kind: "text", field: caret.field, offset: caret.offset }));
  }

  function splitAtPlayhead(i: number) {
    const now = playhead();
    if (now === null) return;
    apply(i, splitAtTime(track(), i, now));
  }

  function addAtPlayhead() {
    const now = playhead();
    if (now === null) return;
    void applyAndFocus(-1, insertAtPlayhead(track(), now, duration));
  }

  function editTime(i: number, edge: "start" | "end", input: HTMLInputElement) {
    const cue = cues[i];
    const was = edge === "start" ? cue.start : cue.end;
    const value = parseClock(input.value);
    selected = i;
    if (value === null) {
      problem = { i, text: t("Type a time like 1:02.5") };
      input.value = formatClock(was);
      return;
    }
    const ok = apply(i, setTimes(track(), i, { [edge]: value }, duration));
    // A typed "1:2" that means the time already set changes no prop, so
    // the field would keep showing what was typed rather than the time.
    input.value = formatClock(ok ? value : was);
  }

  function atPlayhead(i: number, edge: "start" | "end") {
    const now = playhead();
    if (now === null) return;
    apply(i, timeAtPlayhead(track(), i, edge, now, duration));
  }

  /**
   * Grow a text box to its text. A fixed `rows` from the cue's line count
   * cut off every line the box itself wrapped, which on a phone is most of
   * them: a one-line cue in a 240 px box is two or three lines tall.
   */
  function autosize(el: HTMLTextAreaElement, _text: string) {
    let width = 0;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
    };
    // Refitted on the next frame, not inside the observer: a height set
    // there can bring a scrollbar and so a new width before the observer
    // has finished, which WebKit reports as a page error.
    let frame = 0;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w !== width) {
        width = w;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(fit);
      }
    });
    observer.observe(el);
    el.addEventListener("input", fit);
    fit();
    return {
      update: fit,
      destroy() {
        cancelAnimationFrame(frame);
        observer.disconnect();
        el.removeEventListener("input", fit);
      },
    };
  }
</script>

<div class="cue-actions">
  <button type="button" class="btn btn-ghost btn-sm" disabled={duration === 0} onclick={addAtPlayhead}>
    {t("Add at playhead")}
  </button>
  <span class="cue-actions-gap"></span>
  <button type="button" class="btn btn-ghost btn-sm" disabled={!canUndo} onclick={() => { problem = null; onundo(); }}>
    {t("Undo")}
  </button>
  <button type="button" class="btn btn-ghost btn-sm" disabled={!canRedo} onclick={() => { problem = null; onredo(); }}>
    {t("Redo")}
  </button>
</div>
{#if problem && problem.i === -1}
  <p class="field-error cue-problem cue-head-problem" role="alert">{problem.text}</p>
{/if}
<ol class="cue-list" bind:this={list}>
  {#each cues as cue, i (i)}
    <li class="cue" class:selected={selected === i} onfocusin={() => (selected = i)}>
      <div class="cue-side">
        <button
          type="button"
          class="cue-time"
          onclick={() => {
            selected = i;
            onseek(cue.start);
          }}
          title={t("Jump here")}
          aria-label={t("Jump here")}
        >
          <svg viewBox="0 0 10 10" width="10" height="10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>
        </button>
        <div class="cue-clocks">
          <input
            class="cue-clock oa-mono"
            data-edge="start"
            type="text"
            autocomplete="off"
            spellcheck="false"
            value={formatClock(cue.start)}
            aria-label={t("Start time")}
            onchange={(e) => editTime(i, "start", e.currentTarget)}
          />
          <input
            class="cue-clock oa-mono"
            data-edge="end"
            type="text"
            autocomplete="off"
            spellcheck="false"
            value={formatClock(cue.end)}
            aria-label={t("End time")}
            onchange={(e) => editTime(i, "end", e.currentTarget)}
          />
        </div>
      </div>
      <div class="cue-main">
        <textarea
          class="cue-text"
          rows="1"
          value={cue.lines.join("\n")}
          use:autosize={cue.lines.join("\n")}
          oninput={(e) => apply(i, setText(track(), i, "cue", e.currentTarget.value), `text:${i}:cue`)}
          onblur={(e) => keepCaret(i, "cue", e.currentTarget)}
        ></textarea>
        {#if paired && source}
          <textarea
            class="cue-original"
            rows="1"
            aria-label={t("Original")}
            value={source[i].lines.join("\n")}
            use:autosize={source[i].lines.join("\n")}
            oninput={(e) => apply(i, setText(track(), i, "source", e.currentTarget.value), `text:${i}:source`)}
            onblur={(e) => keepCaret(i, "source", e.currentTarget)}
          ></textarea>
        {/if}
        {#if cue.check}
          <p class="cue-check">
            <span>{t("Check the translation")}</span>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => apply(i, clearCheck(track(), i))}>
              {t("Looks right")}
            </button>
          </p>
        {/if}
        {#if problem && problem.i === i}
          <p class="field-error cue-problem" role="alert">{problem.text}</p>
        {/if}
        {#if selected === i}
          {#if duration > 0}
            <!-- The playhead buttons read wherever the video is paused, so
                 say so before one is pressed with the video far away. -->
            <p class="cue-hint">{t("Play the video to near this subtitle first, then press a playhead button.")}</p>
          {/if}
          <div class="cue-tools">
            <button type="button" class="btn btn-ghost btn-sm" disabled={duration === 0} onclick={() => atPlayhead(i, "start")}>
              {t("Start at playhead")}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" disabled={duration === 0} onclick={() => atPlayhead(i, "end")}>
              {t("End at playhead")}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => splitAtCursor(i)}>
              {t("Split at cursor")}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" disabled={duration === 0} onclick={() => splitAtPlayhead(i)}>
              {t("Split at playhead")}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" disabled={i === cues.length - 1} onclick={() => apply(i, mergeWithNext(track(), i))}>
              {t("Merge with next")}
            </button>
            <button type="button" class="btn btn-ghost btn-sm" onclick={() => applyAndFocus(i, insertAfter(track(), i, duration))}>
              {t("Add after")}
            </button>
            <button type="button" class="btn btn-ghost btn-sm cue-delete" onclick={() => apply(i, removeCue(track(), i))}>
              {t("Delete")}
            </button>
          </div>
        {/if}
      </div>
    </li>
  {/each}
</ol>
