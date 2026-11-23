// Where the browser downloads the Whisper weights from.
//
// transformers.js fetches them from huggingface.co, which does not resolve
// from mainland China: there, every local transcription failed at the
// download. Hugging Face's China mirror, hf-mirror.com, was tried first and
// did not help. It serves the small JSON files itself but answers the large
// weight files with a redirect back to Hugging Face's own storage
// (cas-bridge.xethub.hf.co), which is blocked in China as well.
//
// ModelScope (modelscope.cn, run by Alibaba) carries the same onnx-community
// repositories with the same SHA-256 for every weight file, serves them from
// CDN nodes inside China, and answers with `Access-Control-Allow-Origin: *`,
// so the browser can fetch them directly. Outside China it is the slow one:
// its API resolves to a server in the United States, and the tiny model took
// 67 s from there against 5 s from Hugging Face. So neither host is right
// for everyone, and the choice is made per visitor:
//
//   auto  mainland China by its time zone gets ModelScope, everyone else
//         Hugging Face (the default);
//   cn    ModelScope;
//   us    Hugging Face.
//
// Whichever is chosen goes first and the other is the fallback, so a wrong
// guess costs a detour rather than a failed transcription.

export type ModelSource = "cn" | "us";
export type ModelSourcePref = "auto" | ModelSource;

const HUGGING_FACE = "https://huggingface.co/";
const MODELSCOPE = "https://modelscope.cn/models/";

/**
 * transformers.js builds a file's address as host + template + file name.
 * The trailing slashes matter: the pieces are concatenated.
 *
 * ModelScope's branch is `master`, not Hugging Face's `main`. It answers to
 * `main` as well, but that alias is undocumented, so the branch is named
 * outright rather than relying on it.
 */
export const MODEL_SOURCES: Record<ModelSource, { host: string; template: string }> = {
  us: { host: HUGGING_FACE, template: "{model}/resolve/{revision}/" },
  cn: { host: MODELSCOPE, template: "{model}/resolve/master/" },
};

/**
 * Mainland China's IANA zones, current and legacy. Hong Kong, Macau and
 * Taiwan are deliberately absent: Hugging Face is reachable from all three,
 * and it is the faster host there.
 */
const MAINLAND_ZONES = new Set([
  "Asia/Shanghai",
  "Asia/Urumqi",
  "Asia/Chongqing",
  "Asia/Chungking",
  "Asia/Harbin",
  "Asia/Kashgar",
  "PRC",
]);

/** Whether a time zone is mainland China's. */
export function inMainlandZone(zone: string | null | undefined): boolean {
  return !!zone && MAINLAND_ZONES.has(zone);
}

/** The source "auto" picks, from the browser's time zone. */
export function guessSource(zone: string | null | undefined = currentZone()): ModelSource {
  return inMainlandZone(zone) ? "cn" : "us";
}

function currentZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone ?? null;
  } catch {
    return null;
  }
}

/** The order to try sources in: the preferred one, then the other. */
export function sourceOrder(pref: ModelSourcePref, zone?: string | null): ModelSource[] {
  const first = pref === "auto" ? guessSource(zone === undefined ? currentZone() : zone) : pref;
  return first === "cn" ? ["cn", "us"] : ["us", "cn"];
}

/**
 * The one address a file is cached under, whichever host served it: its
 * Hugging Face address.
 *
 * transformers.js keys its browser cache on the full download URL, so the
 * same file fetched from two hosts would be stored, and downloaded, twice.
 * Mapping every host onto Hugging Face's address means a model already
 * downloaded before this change is still found, switching source never
 * downloads again, and a visitor who took a model through hf-mirror.com
 * while that was the China route keeps it too.
 */
export function cacheKey(url: string): string {
  if (url.startsWith(MODELSCOPE)) {
    return HUGGING_FACE + url.slice(MODELSCOPE.length).replace("/resolve/master/", "/resolve/main/");
  }
  const mirror = "https://hf-mirror.com/";
  if (url.startsWith(mirror)) return HUGGING_FACE + url.slice(mirror.length);
  return url;
}

/**
 * How long a file may take to *start* answering before its host counts as
 * unreachable. A blocked host in mainland China does not refuse the
 * connection; it hangs, for fifteen seconds or more, so a fallback that
 * waited for an error would leave the progress bar frozen first. Once the
 * response headers arrive the timer stops: a slow download that is moving is
 * never cut off, however large the file.
 */
export const FIRST_BYTE_MS = 8000;

/**
 * Whether a model load failed at the fetch, so the other host is worth a try:
 * a blocked or down host, a host that never answered, a missing file, a
 * transient 5xx. A failure after the weights are in hand (session creation,
 * an unsupported dtype) fails the same way on either host and is not retried.
 */
export function isModelDownloadFailure(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null;
  const text = `${typeof e?.name === "string" ? e.name : ""} ${
    typeof e?.message === "string" ? e.message : String(err ?? "")
  }`;
  return /failed to fetch|networkerror|load failed|fetch failed|net::|err_|timeouterror|timed? ?out|no response|econn|enotfound|getaddrinfo|could not locate|unexpected (?:end|token)|\b40[34]\b|\b5\d\d\b/i.test(
    text,
  );
}

/** The subset of transformers.js's `env` this module touches. */
export interface ModelEnv {
  remoteHost: string;
  remotePathTemplate: string;
  cacheKey?: string;
  useCustomCache?: boolean;
  customCache?: unknown;
  // transformers.js types this as (string | URL, any) => Promise<any>.
  fetch?: (input: string | URL, init?: any) => Promise<any>;
}

type CacheRequest = RequestInfo | URL;
const urlOf = (r: CacheRequest): string =>
  typeof r === "string" ? r : r instanceof URL ? r.href : r.url;

let hooked: ModelEnv | null = null;

/**
 * Give transformers.js the host-independent cache and the first-byte timeout.
 * Once per `env`; later calls do nothing.
 */
export async function installModelHooks(env: ModelEnv): Promise<void> {
  if (hooked === env) return;
  hooked = env;

  // The same Cache Storage bucket transformers.js would open itself, so
  // nothing already downloaded is lost. Where the browser refuses it (some
  // private windows), transformers.js's own fallback applies, as before.
  try {
    if (typeof caches !== "undefined") {
      const store = await caches.open(env.cacheKey ?? "transformers-cache");
      env.useCustomCache = true;
      env.customCache = {
        match: (r: CacheRequest) => store.match(cacheKey(urlOf(r))),
        put: (r: CacheRequest, response: Response) => store.put(cacheKey(urlOf(r)), response),
        delete: (r: CacheRequest) => store.delete(cacheKey(urlOf(r))),
      };
    }
  } catch {
    // Left on the default cache.
  }

  const base = env.fetch ?? globalThis.fetch.bind(globalThis);
  env.fetch = (input: string | URL, init: RequestInit = {}) => {
    const controller = new AbortController();
    const outer = init.signal;
    if (outer) {
      if (outer.aborted) controller.abort(outer.reason);
      else outer.addEventListener("abort", () => controller.abort(outer.reason), { once: true });
    }
    const timer = setTimeout(
      () => controller.abort(new DOMException("no response from the model host", "TimeoutError")),
      FIRST_BYTE_MS,
    );
    return base(input, { ...init, signal: controller.signal }).finally(() => clearTimeout(timer));
  };
}

/** Point transformers.js at one source. */
export function useModelSource(env: ModelEnv, source: ModelSource): void {
  env.remoteHost = MODEL_SOURCES[source].host;
  env.remotePathTemplate = MODEL_SOURCES[source].template;
}

const PREF_KEY = "opensubs-model-source";

/** The visitor's choice, kept on this device. "auto" when none was made. */
export function readModelSourcePref(): ModelSourcePref {
  try {
    const v = globalThis.localStorage?.getItem(PREF_KEY);
    return v === "cn" || v === "us" ? v : "auto";
  } catch {
    return "auto";
  }
}

export function writeModelSourcePref(pref: ModelSourcePref): void {
  try {
    if (pref === "auto") globalThis.localStorage?.removeItem(PREF_KEY);
    else globalThis.localStorage?.setItem(PREF_KEY, pref);
  } catch {
    // Private browsing or storage full: the choice lasts this page only.
  }
}
