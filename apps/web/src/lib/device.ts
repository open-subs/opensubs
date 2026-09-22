/**
 * What kind of GPU this is, as far as choosing a speech model goes.
 *
 * APP-111, measured on an i7-1360P with Intel Iris Xe (WebGPU reports
 * vendor "intel", architecture "gen-12lp"), transcribing a 114-second clip:
 *
 *   WebGPU + Base   250 s
 *   CPU    + Base   186 s
 *   WebGPU + Small  517 s   <- the default this machine was given
 *
 * The default was the slowest of the three because the rule was "WebGPU
 * present, so Small" (APP-32), and on an integrated Intel GPU WebGPU is
 * present and slow. Small is the better recogniser, which is why it is the
 * default where the GPU can carry it -- a discrete card, or Apple silicon,
 * where the same rule measured an order of magnitude faster than the CPU.
 *
 * No benchmark here, deliberately. A meaningful one runs the encoder on both
 * backends, and the CPU backend can only load the full-precision weights, so
 * it would mean downloading a second, four-times-larger copy of the model to
 * learn which one not to use. The adapter already says what it is.
 *
 * Its own module, like ./remote, so the rule can be tested without a GPU.
 */

/** The fields of `GPUAdapterInfo` this reads. All optional: browsers fill them unevenly. */
export interface GpuInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
  description?: string;
}

/**
 * Is this an Intel GPU built into the processor?
 *
 * Chrome takes these names from Dawn, which calls Intel's integrated parts
 * "gen-9", "gen-11", "gen-12lp", "xe-lpg", "xe-2lpg", "xe-3lpg" -- LP for low
 * power -- and its discrete Arc cards "gen-12hp" and "xe-2hpg". So the rule is
 * Intel and not HP. It is Intel only, on purpose: Apple's GPUs are integrated
 * too and fast, which is where Small was measured to pay off, and an AMD or
 * Qualcomm integrated part has not been measured at all -- guessing it slow
 * would take the better model away from machines that may run it well.
 *
 * With no architecture at all -- a browser that withholds it -- an Intel
 * vendor still counts, because every Intel GPU sold before Arc was
 * integrated and most since still are.
 */
export function isIntegratedGpu(info: GpuInfo | null | undefined): boolean {
  if (!info) return false;
  const vendor = (info.vendor ?? "").toLowerCase();
  const hint = `${info.description ?? ""} ${info.device ?? ""}`.toLowerCase();
  if (vendor !== "intel" && !/\bintel\b/.test(hint)) return false;
  const arch = (info.architecture ?? "").toLowerCase();
  if (/hp/.test(arch)) return false;
  if (/\barc\b/.test(hint)) return false;
  return true;
}

/** The part of `AsrSupport` the default depends on. */
export interface DeviceFacts {
  device: "webgpu" | "wasm";
  integrated?: boolean;
}

/**
 * Whether to offer Small, the better and heavier model, by default.
 *
 * Only on a GPU that can carry it. Without WebGPU the CPU backend needs the
 * full-precision weights -- about a gigabyte for Small before a subtitle
 * appears -- and on an integrated Intel GPU WebGPU itself was the slowest
 * way to run it.
 */
export function prefersSmallModel(facts: DeviceFacts): boolean {
  return facts.device === "webgpu" && !facts.integrated;
}

/** "Intel · gen-12lp", for the one line that says which GPU was found. */
export function describeGpu(info: GpuInfo | null | undefined): string | undefined {
  if (!info) return undefined;
  const parts = [info.vendor, info.architecture].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length ? parts.join(" · ") : info.description || undefined;
}
