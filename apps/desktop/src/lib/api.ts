// Typed wrappers around the Tauri command surface implemented in
// `src-tauri/src/commands.rs`. Field names are camelCase to match the
// `#[serde(rename_all = "camelCase")]` DTOs on the Rust side.

import { invoke } from "@tauri-apps/api/core";

export interface MediaInfoDto {
  filename: string;
  displayWidth: number;
  displayHeight: number;
  duration: number;
  fps: number;
  hasAudio: boolean;
  isHdr: boolean;
}

export interface StyleDto {
  name: string;
  font: string;
  sizePct: number;
  alignment: number;
  primaryHex: string;
  backHex: string;
  borderStyle: "outline" | "box";
  /** Which pack the preset belongs to. Both ship unlocked. */
  pack: "Core" | "Advanced" | "Custom";
}

export interface FeatureDto {
  id: string;
  title: string;
  tier: "Free" | "Premium";
  why: string;
  unlocked: boolean;
}

export interface LanguageDto {
  code: string;
  name: string;
  endonym: string;
}

/** Everything the burn screen can set beyond file, style and model. */
export interface BurnOptions {
  /** Clip start in seconds. */
  start?: number | null;
  /** Clip end in seconds; omit to run to the end of the source. */
  end?: number | null;
  /** Fit the export to this height, keeping the aspect ratio. */
  height?: number | null;
  /** Language code to translate the subtitles into before burning. */
  translateTo?: string | null;
  /** A style template JSON file, used instead of the named preset. */
  styleFile?: string | null;
  writeSrt?: boolean;
  writeVtt?: boolean;
}

export interface BurnProgressPayload {
  percent: number;
  done: boolean;
}

export function probe(path: string): Promise<MediaInfoDto> {
  return invoke("probe", { path });
}

export function listStyles(): Promise<StyleDto[]> {
  return invoke("list_styles");
}

/** What is free, what is premium, and what this build gates -- which is nothing. */
export function listFeatures(): Promise<FeatureDto[]> {
  return invoke("list_features");
}

export function listLanguages(): Promise<LanguageDto[]> {
  return invoke("list_languages");
}

/**
 * `true` when ANTHROPIC_API_KEY is set, i.e. a translation could actually
 * run. Translation calls the Claude API with the user's own key, so this is
 * checked before offering it rather than failing at the end of an export.
 */
export function translationReady(): Promise<boolean> {
  return invoke("translation_ready");
}

/** A shipped preset as template JSON, for the user to save and edit. */
export function exportStyle(name: string): Promise<string> {
  return invoke("export_style", { name });
}

/** `true` when ffmpeg has libass and can burn subtitles. */
export function checkFfmpeg(): Promise<boolean> {
  return invoke("check_ffmpeg");
}

/**
 * Runs `brew install ffmpeg-full`. Resolves once the install itself
 * finishes (or rejects on failure) -- it does NOT re-check libass, since a
 * successful install and a working ffmpeg are two different questions;
 * call `checkFfmpeg()` again afterwards. Progress streams separately via
 * the `ffmpeg-install-output` event (see `FfmpegInstallOutputPayload`).
 */
export function installFfmpeg(): Promise<void> {
  return invoke("install_ffmpeg");
}

export interface FfmpegInstallOutputPayload {
  line: string;
}

export interface ModelOptionDto {
  name: string;
  filename: string;
  url: string;
  sizeBytes: number;
  description: string;
  alreadyDownloaded: boolean;
  localPath: string | null;
}

/** The 3 curated models, each annotated with whether it's already sitting in ~/.cache/opensubs-models. */
export function listDownloadableModels(): Promise<ModelOptionDto[]> {
  return invoke("list_downloadable_models");
}

/**
 * Downloads `filename` (must be one of `listDownloadableModels()`'s
 * results) and resolves with its final on-disk path. Progress streams
 * separately via the `model-download-progress` event (see
 * `ModelDownloadProgressPayload`) -- this does NOT call `setModelPath`
 * itself, callers do that with the resolved path.
 */
export function downloadModel(filename: string): Promise<string> {
  return invoke("download_model", { filename });
}

export interface ModelDownloadProgressPayload {
  filename: string;
  percent: number;
  downloadedBytes: number;
  totalBytes: number | null;
}

export function getModelPath(): Promise<string | null> {
  return invoke("get_model_path");
}

export function setModelPath(path: string): Promise<void> {
  return invoke("set_model_path", { path });
}

/**
 * Resolves with the written output path on success. `options` may be
 * omitted entirely, which produces the untrimmed, source-resolution,
 * untranslated export.
 */
export function burn(
  path: string,
  style: string,
  model: string,
  output: string | null,
  options?: BurnOptions,
): Promise<string> {
  return invoke("burn", { path, style, model, output, options: options ?? null });
}

export function reveal(path: string): Promise<void> {
  return invoke("reveal", { path });
}
