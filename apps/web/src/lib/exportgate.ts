// Whether exporting a video asks for an account first, and the export that
// was waiting when it did.
//
// # The switch
//
// One JSON file at the site root, `/export-gate.json`, held on the server
// and never built or deployed with the app: `{"exportGate": true}` turns
// the requirement on, and taking the file away turns it off again, with no
// rebuild and no redeploy. Anything other than a literal `true` -- no file,
// a 404, the HTML a fallback route answers with, a parse error, no network
// -- is off. Failing open is deliberate: a broken switch must leave the
// page doing what it did before the switch existed.
//
// `?gate=1` turns it on for one tab, whatever the file says, so the flow
// can be tried on the live site before it is on for everybody. Remembered
// for the tab in sessionStorage, which is what carries it across a sign-in
// that leaves the page for a provider and comes back. Nothing turns it off
// for one tab: the override can only ask for more, never for less.
//
// Only the web page reads any of this. The phone apps run this same code
// inside a native shell, and the requirement is not theirs.
//
// # The waiting export
//
// Signing in with Google, Apple or GitHub is a full-page redirect, which
// throws the page away. The subtitles survive it already (see
// workinprogress.ts); what is added here is the intent -- "this person
// pressed export" -- so that once they are back, signed in, with the video
// open again, the export starts without being asked for twice.

import { inNativeShell } from "./native";

const FORCE_KEY = "opensubs.exportGate.force";
const PENDING_KEY = "opensubs.pendingExport";
const SWITCH_URL = "/export-gate.json";
/** How long a waiting export stays waiting. Long enough for a sign-in. */
const PENDING_MAX_AGE_MS = 60 * 60 * 1000;
/** How long a press waits for the switch before treating it as off. */
const SWITCH_TIMEOUT_MS = 3000;

const WEB_HOSTS = new Set(["opensubs.app", "www.opensubs.app", "app.opensubs.app", "localhost", "127.0.0.1"]);

function onWeb(): boolean {
  try {
    return typeof location !== "undefined" && WEB_HOSTS.has(location.hostname) && !inNativeShell();
  } catch {
    return false;
  }
}

function forcedOn(): boolean {
  let asked = false;
  try {
    asked = new URLSearchParams(location.search).get("gate") === "1";
  } catch {
    return false;
  }
  try {
    if (asked) sessionStorage.setItem(FORCE_KEY, "1");
    return asked || sessionStorage.getItem(FORCE_KEY) === "1";
  } catch {
    return asked;
  }
}

let switchState: Promise<boolean> | null = null;

function readSwitch(): Promise<boolean> {
  // A query that changes on every load keeps any cache between here and
  // the server from answering for the file: flipping it back must reach
  // the next page load, not the next expiry.
  switchState ??= fetch(`${SWITCH_URL}?t=${Date.now()}`, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .then((body) => body?.exportGate === true)
    .catch(() => false);
  return switchState;
}

/** Start reading the switch, so a press does not wait for it. */
export function primeExportGate(): void {
  if (!onWeb()) return;
  forcedOn();
  void readSwitch();
}

/** Does exporting a video need an account, on this page, right now? */
export async function exportGateOn(): Promise<boolean> {
  if (!onWeb()) return false;
  if (forcedOn()) return true;
  const late = new Promise<boolean>((ok) => setTimeout(() => ok(false), SWITCH_TIMEOUT_MS));
  return Promise.race([readSwitch(), late]);
}

export interface PendingExport {
  at: number;
  videoName: string;
}

export function markPendingExport(videoName: string): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ at: Date.now(), videoName }));
  } catch {
    // Without storage a redirect sign-in loses the intent, not the work:
    // the subtitles are kept regardless, and the button is still there.
  }
}

export function pendingExport(): PendingExport | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as PendingExport;
    if (!Number.isFinite(p?.at) || Date.now() - p.at > PENDING_MAX_AGE_MS) {
      clearPendingExport();
      return null;
    }
    return p;
  } catch {
    clearPendingExport();
    return null;
  }
}

export function clearPendingExport(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // See markPendingExport.
  }
}
