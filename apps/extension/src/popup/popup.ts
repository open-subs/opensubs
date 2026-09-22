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

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const modelEl = $<HTMLSelectElement>("model");
const modelNote = $<HTMLParagraphElement>("model-note");
const languageEl = $<HTMLSelectElement>("language");
const windowEl = $<HTMLInputElement>("window");
const windowOut = $<HTMLOutputElement>("window-out");
const overlayEl = $<HTMLInputElement>("overlay");
const backendEl = $<HTMLSelectElement>("backend");
const backendNote = $<HTMLParagraphElement>("backend-note");
const statusEl = $<HTMLDivElement>("status");
const deviceEl = $<HTMLParagraphElement>("device");
const goEl = $<HTMLButtonElement>("go");
const saveEl = $<HTMLButtonElement>("save");

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

function fill() {
  for (const m of ASR_MODELS) {
    const o = document.createElement("option");
    o.value = m.id;
    o.textContent = `${m.label} · ${m.size}`;
    modelEl.append(o);
  }
  for (const [code, label] of LANGUAGES) {
    const o = document.createElement("option");
    o.value = code;
    o.textContent = label;
    languageEl.append(o);
  }
}

function readSettings(): Settings {
  return {
    model: modelEl.value,
    language: languageEl.value,
    window: Number(windowEl.value),
    overlay: overlayEl.checked,
    fontScale: DEFAULT_SETTINGS.fontScale,
    backend: backendEl.value as Settings["backend"],
  };
}

function showSettings(s: Settings) {
  modelEl.value = s.model;
  languageEl.value = s.language;
  windowEl.value = String(s.window);
  overlayEl.checked = s.overlay;
  backendEl.value = s.backend ?? DEFAULT_SETTINGS.backend;
  syncNotes();
}

function syncNotes() {
  windowOut.textContent = `${windowEl.value}s`;
  modelNote.textContent = ASR_MODELS.find((m) => m.id === modelEl.value)?.note ?? "";
  backendNote.textContent = BACKEND_NOTES[backendEl.value] ?? "";
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
    deviceEl.textContent =
      status.device === "webgpu"
        ? "Running on the GPU, on this machine."
        : "Running on the processor, on this machine.";
  }
  saveEl.disabled = count === 0;
}

function setRunning(on: boolean) {
  running = on;
  goEl.textContent = on ? "Stop" : "Start";
  for (const el of [modelEl, languageEl, windowEl, backendEl]) el.disabled = on;
}

async function refresh() {
  const state = (await tell({ kind: "state" })) as
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
  // Host access is asked for at the moment it is needed and for this tab
  // only. An extension that demands <all_urls> at install time to subtitle
  // one video is asking for the whole browsing history to do one job.
  try {
    const granted = await api.permissions.request({ origins: [new URL(tab.url ?? "").origin + "/*"] });
    if (!granted) {
      showStatus({ stage: "error", fraction: null, note: "Without access to this site the audio cannot be read." }, 0);
      return;
    }
  } catch {
    // Some pages (a PDF viewer, the store) have no requestable origin.
  }
  setRunning(true);
  await tell({ kind: "start", tabId: tab.id, settings: readSettings() });
});

saveEl.addEventListener("click", async () => {
  const got = (await tell({ kind: "cues" })) as { srt: string; count: number } | undefined;
  if (!got?.count) return;
  const url = URL.createObjectURL(new Blob([got.srt], { type: "text/plain" }));
  await api.downloads.download({ url, filename: "subtitles.srt", saveAs: true });
  // Revoking immediately cancels the download on Chromium; the object is
  // small and the popup is about to close anyway.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
});

for (const el of [modelEl, languageEl, windowEl, overlayEl, backendEl]) {
  el.addEventListener("input", syncNotes);
}

api.runtime.onMessage.addListener((message: { kind: string; status?: Status }) => {
  if (message.kind === "status" && message.status) {
    showStatus(message.status, Number(!saveEl.disabled));
    void refresh();
  }
  return false;
});

fill();
void refresh();
