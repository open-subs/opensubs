// Which translations this account has already paid for, and what they were.
//
// The gateway charges a job once per idempotency key, and the key is made
// from the text, the languages and nothing else (`account.jobKey`). Sending
// the same key again is never charged, but it is not a way to get the text
// back either: for fifteen minutes the gateway repeats its earlier answer,
// still reading `charged: 1`, and after that it refuses the key outright as
// already paid. So the page priced a second run as if it were the first,
// and a second run more than fifteen minutes later failed.
//
// The answer is to keep what was paid for. Each translation the gateway
// returns is stored here against its key, for the signed-in account, and
// applying that language again uses it: no request, no charge, the same
// text. A key whose answer is not held here -- paid on another device, or
// pushed out of storage -- is priced as new, which is the safe way to be
// wrong. If the gateway then refuses it as already paid, the key moves to
// its next generation, so the next run is a new job and is charged as one.
//
// No imports, so it can be tested in Node with a stand-in localStorage.

const PREFIX = "opensubs.paid.";
/** Jobs kept per account. A job is one request: up to sixty lines. */
const MAX_JOBS = 120;

interface Ledger {
  /** key -> the translations the gateway returned, oldest first. */
  jobs: [string, string[]][];
  /** base key -> how many times it has been refused as already paid. */
  generations: { [base: string]: number };
}

/** This tab's copy, so storage that throws still leaves the session working. */
const memory = new Map<string, Ledger>();

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function load(user: string): Ledger {
  const held = memory.get(user);
  if (held) return held;
  let record: Ledger = { jobs: [], generations: {} };
  try {
    const raw = storage()?.getItem(PREFIX + user);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && Array.isArray(parsed.jobs) && parsed.generations && typeof parsed.generations === "object") {
      record = {
        jobs: parsed.jobs.filter(
          (j: unknown) => Array.isArray(j) && typeof j[0] === "string" && Array.isArray(j[1]),
        ),
        generations: parsed.generations,
      };
    }
  } catch {
    // Unreadable is the same as empty: every job is priced as new.
  }
  memory.set(user, record);
  return record;
}

function save(user: string, record: Ledger): void {
  memory.set(user, record);
  try {
    storage()?.setItem(PREFIX + user, JSON.stringify(record));
  } catch {
    // Full or forbidden. Drop the older half and try once more, so one
    // long session cannot stop the newest job being kept.
    record.jobs = record.jobs.slice(Math.floor(record.jobs.length / 2));
    try {
      storage()?.setItem(PREFIX + user, JSON.stringify(record));
    } catch {
      // The tab's own copy still works.
    }
  }
}

/** The key a job is sent under now: its base, or the base's next generation. */
export function keyFor(user: string | null, base: string): string {
  if (!user) return base;
  const generation = load(user).generations[base] ?? 0;
  return generation > 0 ? `${base}-g${generation}` : base;
}

/** The translation this account was given for a key, if it is still held. */
export function paidTranslation(user: string | null, key: string): string[] | undefined {
  if (!user) return undefined;
  return load(user).jobs.find(([k]) => k === key)?.[1];
}

/** Keep what the gateway returned for a key. */
export function rememberPaid(user: string | null, key: string, lines: string[]): void {
  if (!user) return;
  const record = load(user);
  record.jobs = record.jobs.filter(([k]) => k !== key);
  record.jobs.push([key, lines]);
  record.jobs = record.jobs.slice(-MAX_JOBS);
  save(user, record);
}

/**
 * The gateway refused a key as already paid and its answer is not held:
 * move the job to a new key, so running it again is a new, charged job.
 */
export function retireKey(user: string | null, base: string): void {
  if (!user) return;
  const record = load(user);
  record.generations[base] = (record.generations[base] ?? 0) + 1;
  save(user, record);
}

/** Tests only. */
export function forgetAll(): void {
  memory.clear();
}
