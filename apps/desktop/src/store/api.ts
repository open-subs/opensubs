// The command surface, in the Mac App Store build.
//
// Stands in for src/lib/api.ts only in the store build (vite.config.ts,
// OPENSUBS_STORE=1). Everything is the real module's except where an export
// is written.
//
// The direct-download app writes `<video>.subbed.mp4` (and any .srt, .vtt,
// .txt) beside the video. A sandboxed app may write only where the person
// was shown a panel -- choosing a video grants that one file, not its folder
// -- so before an export the store build asks which folder to save in,
// starting at the video's own, and the export is named there exactly as it
// would have been beside the video (`output_in`).
//
// A cloud-translated export asks before it is priced, not after: the folder
// is chosen first, so somebody who closes the panel has paid nothing.

import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import * as real from "../lib/api";
import type { BurnOptions, TranscribedDto, UserError } from "../lib/api";

export * from "../lib/api";

/** The folder last chosen for each video this session. */
const chosen = new Map<string, string>();

function folderOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut > 0 ? path.slice(0, cut) : path;
}

function noFolder(): UserError {
  return {
    kind: "other",
    message: "Nothing was exported: no folder was chosen to save it in.",
    details: null,
  };
}

/** Ask where to save the export of `path`. Null when the panel is closed. */
async function askFolder(path: string): Promise<string | null> {
  const dir = await openDialog({
    directory: true,
    multiple: false,
    canCreateDirectories: true,
    defaultPath: chosen.get(path) ?? folderOf(path),
    title: "Choose where to save the subtitled video",
  });
  if (typeof dir !== "string") return null;
  chosen.set(path, dir);
  return dir;
}

export async function transcribeForCloud(
  path: string,
  model: string,
  options: BurnOptions,
): Promise<TranscribedDto> {
  if (!(await askFolder(path))) throw noFolder();
  return real.transcribeForCloud(path, model, options);
}

export async function burn(
  path: string,
  style: string,
  model: string,
  output: string | null,
  options?: BurnOptions,
): Promise<string> {
  if (output) return real.burn(path, style, model, output, options);
  // The paid step already asked, and the person agreed to the price with
  // that folder in mind.
  const dir = options?.cloud && chosen.has(path) ? chosen.get(path)! : await askFolder(path);
  if (!dir) throw noFolder();
  const target = await invoke<string>("output_in", { input: path, dir });
  return real.burn(path, style, model, target, options);
}

/** The store build carries its ffmpeg and may not install another. */
export async function installFfmpeg(): Promise<void> {
  throw new Error("This version of OpenSubs carries its own ffmpeg and cannot install another.");
}

/** The bundled ffmpeg's check, with no install offered (`store_check_ffmpeg`). */
export function checkFfmpeg(): Promise<real.FfmpegCheck> {
  return invoke("store_check_ffmpeg");
}
