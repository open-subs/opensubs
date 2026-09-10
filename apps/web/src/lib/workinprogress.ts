// Keep the expensive work across a full-page navigation.
//
// # Why this exists
//
// Signing in is a **full-page redirect** — `<openapps-login>` sets
// `window.location.href`, deliberately, because popups are blocked by
// default. The tab is destroyed and rebuilt, so every rune in `App.svelte`
// goes back to its initial value.
//
// That is fine for most of them. It is not fine for the subtitles: reaching
// them cost a model download and minutes of transcription, and the moment a
// user pressed "sign in" to pay for a translation, the thing they were
// about to translate vanished. Worse, it vanished for anyone who abandoned
// the sign-in — they had not even chosen to spend anything, and were
// punished for changing their mind.
//
// So the cues are written to `localStorage` as they change, and restored on
// load. Not a cache in the performance sense: a promise that a user's work
// is not destroyed by an interaction they did not ask for.
//
// # What is deliberately not saved
//
// The **video**. It is a `File` handed over by a picker, and neither a
// `File` nor its object URL survives a navigation — an object URL is a
// pointer into a document that no longer exists. Copying the bytes into
// IndexedDB would technically work and would mean silently writing
// someone's video to disk, which is precisely the thing this product
// promises not to do.
//
// So the subtitles come back and the video does not, and the interface says
// so plainly rather than looking broken.

import type { Cue } from "./engine";

const KEY = "opensubs.work";

/**
 * How long saved work stays interesting.
 *
 * Long enough to survive a sign-in, a crash, or closing the laptop
 * mid-task. Short enough that a stranger's subtitles are not sitting in a
 * shared browser a month later.
 */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface SavedWork {
  at: number;
  /** Only to tell the user which file this belonged to. */
  videoName: string;
  cues: Cue[];
  /** Per-word loudness, so the emphasis effect survives too. */
  loudness: number[][];
  selectedStyle: string;
  wordEffect: "none" | "karaoke" | "loudness";
  translateTo: string;
  /**
   * The pre-translation text, when there is one. Absent in records written
   * before bilingual burning existed, which is why every reader treats it
   * as optional rather than assuming it is there.
   */
  sourceCues?: Cue[];
  bilingual?: boolean;
  bilingualOrder?: "original-first" | "translation-first";
  /** How large the original is set relative to the translation. */
  originalScale?: number;
}

export function saveWork(work: Omit<SavedWork, "at">): void {
  // An empty set is not saved, and — critically — does not *clear* what is
  // already stored.
  //
  // Clearing here looked tidier and destroyed the feature: on every load
  // the app starts with no cues, so the save ran once with an empty list
  // and wiped the record microseconds before the restore could read it.
  // The work was saved perfectly and then deleted by its own safety net.
  //
  // Forgetting is now always explicit — the user presses Discard, or the
  // record ages out.
  if (work.cues.length === 0) return;
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...work, at: Date.now() }));
  } catch {
    // Quota, a private window, or blocked site data. Losing the safety net
    // must never break the thing it is protecting.
  }
}

export function loadWork(): SavedWork | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const work = JSON.parse(raw) as SavedWork;
    if (!Array.isArray(work.cues) || work.cues.length === 0) return null;
    if (!Number.isFinite(work.at) || Date.now() - work.at > MAX_AGE_MS) {
      clearWork();
      return null;
    }
    return work;
  } catch {
    // A record written by an older version with a different shape is not
    // worth migrating; it is one transcription.
    clearWork();
    return null;
  }
}

export function clearWork(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // See saveWork.
  }
}

/** How long ago the work was saved, in words a person would use. */
export function describeAge(at: number): string {
  const minutes = Math.round((Date.now() - at) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} ago`;
}
