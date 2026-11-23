// Whether exporting a video asks for an account first, and the export that
// was waiting when it did.
//
// # The switch
//
// One JSON file at the site root, `/export-gate.json`, held on the server
// and never built or deployed with the app: `{"exportGate": true}` turns
// the requirement on, and taking the file away turns it off again, with no
// rebuild and no redeploy. Anything other than a literal `true` -- no file,
// a 404, the HTML a fallback route answers with, a parse error -- is off.
// Failing open is deliberate: a broken switch must leave the page doing
// what it did before the switch existed. No network is the exception: the
// server could not be asked, so the last answer it gave this browser
// stands (see fetchSwitches), and only a session confirmed recently
// (offlinesession.ts) exports without signing in.
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
// The same file carries a second, independent key, `funnelEvents`, read by
// funnel.ts: one fetch per page load answers both.
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
export const PENDING_MAX_AGE = 60 * 60 * 1000;
/** How long a press waits for the switch before treating it as off. */
const SWITCH_TIMEOUT_MS = 3000;

const WEB_HOSTS = new Set(["opensubs.app", "www.opensubs.app", "localhost", "127.0.0.1"]);

export function onWeb(): boolean {
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
let switchRead: Promise<SwitchRead> | null = null;

interface SwitchRead {
  switches: Record<string, unknown>;
  /** The server answered at all. False only when the request itself failed. */
  reached: boolean;
}

/**
 * Read the switch file now, and say whether the server could be reached.
 *
 * Any answer from the server -- a 404, the HTML a fallback route sends, a
 * body that is not JSON -- is a read, and reads as off. Only a request that
 * fails outright (no network, a refused or dropped connection) is
 * "unreached", and then the switch is the last answer this browser read
 * (`exportGateLastKnown`), not off: "I could not ask" is not "the answer is
 * no".
 */
async function fetchSwitches(): Promise<SwitchRead> {
  if (!onWeb()) return { switches: {}, reached: false };
  let res: Response;
  try {
    // A query that changes on every load keeps any cache between here and
    // the server from answering for the file: flipping it back must reach
    // the next page load, not the next expiry.
    res = await fetch(`${SWITCH_URL}?t=${Date.now()}`, { cache: "no-store" });
  } catch {
    return { switches: {}, reached: false };
  }
  try {
    const body = res.ok ? await res.json() : null;
    return { switches: body && typeof body === "object" ? (body as Record<string, unknown>) : {}, reached: true };
  } catch {
    return { switches: {}, reached: true };
  }
}

function rememberSwitch(read: SwitchRead): void {
  if (!read.reached) return;
  try {
    localStorage.setItem(LAST_KEY, read.switches.exportGate === true ? "1" : "0");
  } catch {
    // Only the first frame of the copy, and a press offline, depend on it.
  }
}

/**
 * The switch file as an object, `{}` for anything that is not one. Never
 * fetched off the website. Read once per page load.
 */
export function siteSwitches(): Promise<Record<string, unknown>> {
  switchRead ??= fetchSwitches();
  return switchRead.then((r) => r.switches);
}

function readSwitch(): Promise<boolean> {
  switchRead ??= fetchSwitches();
  switchState ??= switchRead.then((read) => {
    rememberSwitch(read);
    return read.reached ? read.switches.exportGate === true : exportGateLastKnown();
  });
  return switchState;
}

const LAST_KEY = "opensubs.exportGate.last";

/**
 * Whether the copy should say that burning takes a sign-in, before the
 * switch has answered: the answer this browser got last time, so the page
 * does not open on one sentence and change to the other. Never true off
 * the website.
 */
export function exportGateLastKnown(): boolean {
  if (!onWeb()) return false;
  if (forcedOn()) return true;
  try {
    return localStorage.getItem(LAST_KEY) === "1";
  } catch {
    return false;
  }
}

/** Start reading the switch, so a press does not wait for it. */
export function primeExportGate(): void {
  if (!onWeb()) return;
  forcedOn();
  void readSwitch();
}

/** Does exporting a video need an account, on this page? For the copy. */
export async function exportGateOn(): Promise<boolean> {
  if (!onWeb()) return false;
  if (forcedOn()) return true;
  const late = new Promise<boolean>((ok) => setTimeout(() => ok(false), SWITCH_TIMEOUT_MS));
  return Promise.race([readSwitch(), late]);
}

/**
 * For a press of the export button: is the switch on, and is there a
 * connection to sign in over, *now*?
 *
 * Read afresh rather than reusing the page load's answer, because what
 * matters is the connection at this moment, and navigator.onLine stays true
 * on a network that refuses every connection. Only a request that fails,
 * or the browser saying it is offline, is offline. A request that is merely
 * slow (7 s was seen on a phone) is not: after SWITCH_TIMEOUT_MS the press
 * goes on with the last answer this browser read, as an online one, and the
 * sign-in sheet does not claim there is no connection.
 */
export async function exportGateNow(): Promise<{ on: boolean; offline: boolean }> {
  if (!onWeb()) return { on: false, offline: false };
  const late = new Promise<null>((ok) => setTimeout(() => ok(null), SWITCH_TIMEOUT_MS));
  const read = await Promise.race([fetchSwitches(), late]);
  if (read) rememberSwitch(read);
  const failed = read ? !read.reached : false;
  const offline = failed || (typeof navigator !== "undefined" && navigator.onLine === false);
  const on = forcedOn() || (read?.reached ? read.switches.exportGate === true : exportGateLastKnown());
  return { on, offline };
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
    if (!Number.isFinite(p?.at) || Date.now() - p.at > PENDING_MAX_AGE) {
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
