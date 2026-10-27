/**
 * The controls.
 *
 * The popup is not the app -- it is a remote for the session running in the
 * background, and closing it must not stop anything. So it holds no state
 * of its own: it asks for `state` when it opens, and everything it changes
 * it sends straight down.
 */

import { ASR_MODELS } from "../../../web/src/lib/asr";
import { api, DEFAULT_SETTINGS, tell, type Settings, type Status } from "../lib/protocol";
import { nearestSize } from "../lib/pace";
import { direction, getLocale, LOCALES, t, useLocale } from "../lib/i18n";
import { cannotScript, NOT_A_WEB_PAGE } from "../lib/pages";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const modelEl = $<HTMLSelectElement>("model");
const modelNote = $<HTMLParagraphElement>("model-note");
const languageEl = $<HTMLSelectElement>("language");
const windowEl = $<HTMLInputElement>("window");
const windowOut = $<HTMLOutputElement>("window-out");
const overlayEl = $<HTMLInputElement>("overlay");
const backendEl = $<HTMLSelectElement>("backend");
const sizeEl = $<HTMLSelectElement>("size");
const backendNote = $<HTMLParagraphElement>("backend-note");
const statusEl = $<HTMLDivElement>("status");
const deviceEl = $<HTMLParagraphElement>("device");
const goEl = $<HTMLButtonElement>("go");
const saveEl = $<HTMLButtonElement>("save");
const clearEl = $<HTMLButtonElement>("clear");
const advancedEl = $<HTMLDetailsElement>("advanced");
const changedEl = $<HTMLSpanElement>("changed");
const localeEl = $<HTMLSelectElement>("locale");

/**
 * A short list, chosen rather than exhaustive.
 *
 * Whisper knows ninety-nine languages and "auto" picks correctly almost
 * always; the ones spelled out here are the cases where naming it is
 * strictly better -- accented English misheard as Welsh, or a bilingual
 * stream where detection flips between two scripts mid-sentence.
 */
const LANGUAGES: [string, string][] = [
  ["auto", "Detect automatically"],
  ["en", "English"],
  ["zh", "Chinese"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["es", "Spanish"],
  ["fr", "French"],
  ["de", "German"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["ar", "Arabic"],
  ["hi", "Hindi"],
  ["id", "Indonesian"],
  ["th", "Thai"],
  ["vi", "Vietnamese"],
];

let running = false;

/**
 * A language's name in the reader's own language: 日语 to a Chinese reader,
 * Japanese to an English one. The browser carries CLDR's names for every
 * language, so there is no second list of fifteen names to keep in eight
 * catalogues. English where `Intl.DisplayNames` is missing.
 */
function languageNames(): { of(code: string): string | undefined } | null {
  try {
    return new Intl.DisplayNames([getLocale()], { type: "language" });
  } catch {
    return null;
  }
}

/**
 * The static words in popup.html, each marked `data-t`, in this language.
 * The English is kept on the element the first time, because it is the key:
 * after one pass the text on screen is no longer English.
 */
function translatePage() {
  document.documentElement.lang = getLocale();
  document.documentElement.dir = direction();
  for (const el of document.querySelectorAll<HTMLElement>("[data-t]")) {
    el.dataset.t ||= el.textContent?.trim() ?? "";
    el.textContent = t(el.dataset.t);
  }
}

function fill() {
  const names = languageNames();
  for (const el of [modelEl, languageEl, localeEl]) el.replaceChildren();
  const follow = document.createElement("option");
  follow.value = "auto";
  follow.textContent = t("Follow browser");
  localeEl.append(follow);
  for (const l of LOCALES) {
    const o = document.createElement("option");
    o.value = l.code;
    o.textContent = l.name;
    o.lang = l.code;
    localeEl.append(o);
  }
  const automatic = document.createElement("option");
  automatic.value = "auto";
  automatic.textContent = t("Automatic");
  modelEl.append(automatic);
  for (const m of ASR_MODELS) {
    const o = document.createElement("option");
    o.value = m.id;
    // Base and Small are the models' names and stay as they are; only
    // "(English)" in Tiny's says something a reader needs translated.
    o.textContent = `${t(m.label)} · ${m.size}`;
    modelEl.append(o);
  }
  for (const [code, label] of LANGUAGES) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = code === "auto" ? t(label) : (names?.of(code) ?? label);
    languageEl.append(o);
  }
}

function readSettings(): Settings {
  return {
    model: modelEl.value,
    language: languageEl.value,
    window: Number(windowEl.value),
    overlay: overlayEl.checked,
    fontScale: Number(sizeEl.value) || DEFAULT_SETTINGS.fontScale,
    backend: backendEl.value as Settings["backend"],
    locale: localeEl.value || "auto",
  };
}

function showSettings(s: Settings) {
  modelEl.value = s.model;
  languageEl.value = s.language;
  windowEl.value = String(s.window);
  overlayEl.checked = s.overlay;
  backendEl.value = s.backend ?? DEFAULT_SETTINGS.backend;
  // The sizes moved down a notch and the largest went, so a size
  // saved by an older build may name one that is no longer offered. Without
  // this the select shows nothing and the next change sends the default.
  sizeEl.value = String(nearestSize(s.fontScale ?? DEFAULT_SETTINGS.fontScale));
  localeEl.value = s.locale ?? "auto";
  syncNotes();
}

/**
 * How many folded settings are off their defaults.
 *
 * Shown on the folded header, so a person who once changed the model, or
 * turned the overlay off, can see that from the outside -- otherwise the
 * fold would hide the very setting explaining why things behave differently.
 * The language is not counted: it sits in plain view above.
 */
function changedCount(s: Settings): number {
  const d = DEFAULT_SETTINGS;
  return [
    s.model !== d.model,
    (s.backend ?? d.backend) !== d.backend,
    s.window !== d.window,
    s.overlay !== d.overlay,
    nearestSize(s.fontScale ?? d.fontScale) !== nearestSize(d.fontScale),
    (s.locale ?? "auto") !== "auto",
  ].filter(Boolean).length;
}

function syncChanged() {
  const n = changedCount(readSettings());
  changedEl.hidden = n === 0;
  changedEl.textContent = n === 0 ? "" : n === 1 ? t("1 changed") : t("{n} changed", { n });
}

function syncNotes() {
  windowOut.textContent = t("{n}s", { n: windowEl.value });
  modelNote.textContent = t(
    modelEl.value === "auto"
      ? "Base where this machine can keep up with the video, Tiny where it cannot."
      : (ASR_MODELS.find((m) => m.id === modelEl.value)?.note ?? ""),
  );
  backendNote.textContent = t(BACKEND_NOTES[backendEl.value] ?? "");
  syncChanged();
}

/**
 * What each choice means. "Automatic" is the one to leave alone: it uses the
 * CPU where the GPU was measured to be the slow path (engine.ts startsOnCpu).
 */
const BACKEND_NOTES: Record<string, string> = {
  auto: "Uses the processor on Firefox and on Intel built-in graphics, where it was measured faster; the graphics card elsewhere.",
  gpu: "Fastest on a dedicated graphics card or Apple silicon. Can fall behind on built-in graphics.",
  cpu: "Works everywhere. The first run downloads a model about four times larger.",
};

function showStatus(status: Status, count: number) {
  const idle = status.stage === "idle" || (!status.note && !running);
  statusEl.hidden = idle;
  statusEl.classList.toggle("bad", status.stage === "error");
  statusEl.textContent =
    status.stage === "model" && status.fraction !== null
      ? `${status.note} — ${Math.round(status.fraction * 100)}%`
      : status.note;
  if (status.device) {
    deviceEl.textContent = t(
      status.device === "webgpu"
        ? "Running on the GPU, on this machine."
        : "Running on the processor, on this machine.",
    );
  }
  saveEl.disabled = count === 0;
  clearEl.disabled = count === 0;
}

function setRunning(on: boolean) {
  running = on;
  goEl.textContent = on ? t("Stop") : t("Start");
  for (const el of [modelEl, languageEl, windowEl, backendEl]) el.disabled = on;
}

/** The tab the popup is a remote for. */
async function activeTab(): Promise<number | undefined> {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function refresh() {
  // With the tab, because subtitles kept after Stop belong to the page they
  // were made from: another tab's are not this popup's to offer.
  const state = (await tell({ kind: "state", tabId: await activeTab() })) as
    | { running: boolean; status: Status; count: number; settings: Settings }
    | undefined;
  if (!state) return;
  showSettings(state.settings);
  setRunning(state.running);
  showStatus(state.status, state.count);
}

goEl.addEventListener("click", async () => {
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  if (running) {
    await tell({ kind: "stop", tabId: tab.id });
    setRunning(false);
    return;
  }
  // A store page, a browser page, a PDF: said before anything is asked for,
  // and said as where to go instead. The background says the same if the
  // injection is refused on a page this list did not know.
  if (cannotScript(tab.url)) {
    showStatus({ stage: "error", fraction: null, note: t(NOT_A_WEB_PAGE) }, Number(!saveEl.disabled));
    return;
  }
  // Host access is asked for at the moment it is needed and for this tab
  // only. An extension that demands <all_urls> at install time to subtitle
  // one video is asking for the whole browsing history to do one job.
  try {
    const granted = await api.permissions.request({ origins: [new URL(tab.url ?? "").origin + "/*"] });
    if (!granted) {
      showStatus({
        stage: "error",
        fraction: null,
        note: t("Without access to this site the audio cannot be read. Press Start again and choose Allow."),
      }, 0);
      return;
    }
  } catch {
    // Some pages (a PDF viewer, the store) have no requestable origin.
  }
  setRunning(true);
  await tell({ kind: "start", tabId: tab.id, settings: readSettings() });
});

/**
 * Firefox for Android has no downloads API: `downloads.download` was removed
 * there, and calling it never settled -- Save .srt did nothing and no file
 * appeared. There the popup is a full page of its own rather than a panel, so
 * it does not close under the save, and an ordinary download link works:
 * Firefox asks "Download file?" and puts it in Downloads. Asked once, when the
 * popup opens.
 */
const onAndroid: Promise<boolean> = api.runtime
  .getPlatformInfo()
  .then((info) => info.os === "android")
  .catch(() => false);

/**
 * Save through a download link in this page, for browsers with no downloads API.
 *
 * SubRip's own type, not text/plain: Android names a download after its type,
 * and as text/plain the file landed as "subtitles.srt.txt".
 */
function saveWithLink(srt: string) {
  const url = URL.createObjectURL(new Blob([srt], { type: "application/x-subrip" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "subtitles.srt";
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

saveEl.addEventListener("click", async () => {
  const tabId = await activeTab();
  if (await onAndroid) {
    const got = (await tell({ kind: "cues", tabId })) as { srt: string; count: number } | undefined;
    if (got?.count) saveWithLink(got.srt);
    return;
  }
  // Firefox closes the popup the moment the save dialog opens, and a blob URL
  // made here dies with the page that made it: the download appeared in the
  // panel with a "retry" arrow and no file. Where the background is
  // a document -- which on Firefox it is -- it makes the URL and drives the
  // download itself, and outlives the dialog. On Chromium the background is a
  // service worker, which has no createObjectURL at all, and the popup's own
  // path has always worked there.
  const handled = (await tell({ kind: "save", tabId })) as { ok?: boolean } | undefined;
  if (handled?.ok) return;

  const got = (await tell({ kind: "cues", tabId })) as { srt: string; count: number } | undefined;
  if (!got?.count) return;
  const url = URL.createObjectURL(new Blob([got.srt], { type: "text/plain" }));
  await api.downloads.download({ url, filename: "subtitles.srt" });
  // Revoking immediately cancels the download on Chromium; the object is
  // small and the popup is about to close anyway.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});

clearEl.addEventListener("click", async () => {
  await tell({ kind: "clear", tabId: await activeTab() });
  await refresh();
});

for (const el of [modelEl, languageEl, windowEl, overlayEl, backendEl, sizeEl, localeEl]) {
  el.addEventListener("input", syncNotes);
  el.addEventListener("change", syncNotes);
}

// Whether the folded settings were left open, for the next time the popup
// opens. Storage can throw (a locked-down profile); the fold then simply
// starts closed.
const ADVANCED_KEY = "opensubs.advancedOpen";
try {
  advancedEl.open = localStorage.getItem(ADVANCED_KEY) === "1";
} catch {
  // Closed, which is the default anyway.
}
advancedEl.addEventListener("toggle", () => {
  try {
    localStorage.setItem(ADVANCED_KEY, advancedEl.open ? "1" : "0");
  } catch {
    // Remembered for this popup only.
  }
});

// The size and the overlay switch are judged by looking at the video, so they
// are sent as they change rather than waiting for the next Start.
for (const el of [sizeEl, overlayEl]) {
  el.addEventListener("change", () => void tell({ kind: "settings", settings: readSettings() }));
}

api.runtime.onMessage.addListener((message: { kind: string; status?: Status }) => {
  if (message.kind === "status" && message.status) {
    showStatus(message.status, Number(!saveEl.disabled));
    void refresh();
  }
  return false;
});

/**
 * A new interface language takes effect at once: the panel is redrawn in it,
 * and the choice goes to the background, which stores it and passes it to the
 * page, so the next status line and the note on the video follow too.
 */
localeEl.addEventListener("change", async () => {
  const keep = readSettings();
  useLocale(keep.locale);
  translatePage();
  fill();
  showSettings(keep);
  setRunning(running);
  await tell({ kind: "settings", settings: keep });
  await refresh();
});

// The stored choice first, so the panel opens in it rather than flashing the
// browser's language. The popup can read storage itself; nothing else waits.
try {
  const stored = await api.storage.local.get("settings");
  useLocale((stored.settings as Partial<Settings> | undefined)?.locale);
} catch {
  // The browser's language, which is the default anyway.
}
translatePage();
fill();
void refresh();
