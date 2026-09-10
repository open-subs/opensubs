//! Tauri command layer: thin glue over the already-tested `subs-*` crates.
//!
//! Mirrors `apps/cli` exactly (same probe/pre-flight/plan/burn sequence) but
//! reports progress through Tauri events instead of a terminal line, and
//! always runs the "highest quality" pipeline -- x264 `-crf 16 -preset
//! slow`, always-attempted HDR tonemap (a no-op on SDR sources) -- since the
//! desktop app exposes no encoder/quality knobs; see `build_job_spec`.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command as Process, Stdio};
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};

use subs_asr::FfmpegWhisperTranscriber;
use subs_media::{probe_args, MediaInfo, OutputSize, TrimRange, VideoEncoder};
use subs_pipeline::{plan_job, write_ass, JobSpec, ProgressParser};
use subs_style::{BorderStyle, Rgba, StyleTemplate};
use subs_subtitle::{to_srt, to_vtt};
use subs_translate::{ClaudeTranslator, TranslateRequest, Translator};

use crate::settings::{self, DesktopSettings};

// ---------------------------------------------------------------------
// DTOs and pure conversions -- the part of this module worth unit testing.
// ---------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaInfoDto {
    pub filename: String,
    /// Display (post-rotation) dimensions -- see `MediaInfo::display_dimensions`.
    pub display_width: u32,
    pub display_height: u32,
    pub duration: f64,
    pub fps: f64,
    pub has_audio: bool,
    pub is_hdr: bool,
}

pub fn media_info_to_dto(filename: &str, info: &MediaInfo) -> MediaInfoDto {
    let (display_width, display_height) = info.display_dimensions();
    MediaInfoDto {
        filename: filename.to_string(),
        display_width,
        display_height,
        duration: info.duration,
        fps: info.fps.as_f64(),
        has_audio: info.has_audio,
        is_hdr: info.color.is_hdr(),
    }
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StyleDto {
    pub name: String,
    pub font: String,
    pub size_pct: f64,
    pub alignment: u8,
    /// `#rrggbb` swatch colours for an optional preview chip.
    pub primary_hex: String,
    pub back_hex: String,
    pub border_style: String,
    /// "Core" or "Advanced". Both ship unlocked; the UI groups by it.
    pub pack: String,
}

fn hex_of(c: Rgba) -> String {
    format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)
}

pub fn style_to_dto(s: &StyleTemplate) -> StyleDto {
    StyleDto {
        name: s.name.clone(),
        font: s.font.clone(),
        size_pct: s.size_pct,
        alignment: s.alignment,
        primary_hex: hex_of(s.primary),
        back_hex: hex_of(s.back_color),
        border_style: match s.border_style {
            BorderStyle::OutlineShadow => "outline".to_string(),
            BorderStyle::OpaqueBox => "box".to_string(),
        },
        pack: subs_style::pack_of(&s.name)
            .map_or("Custom", subs_style::Pack::label)
            .to_string(),
    }
}

/// Everything the burn screen can set beyond the file, style and model.
///
/// All optional and all defaulted, so a front end that sends `{}` gets the
/// same untrimmed, source-resolution, untranslated export the app produced
/// before any of these existed.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BurnOptions {
    /// Clip start in seconds.
    pub start: Option<f64>,
    /// Clip end in seconds. `None` runs to the end of the source.
    pub end: Option<f64>,
    /// Fit the export to this height, keeping the aspect ratio.
    pub height: Option<u32>,
    /// Translate the subtitles into this language code before burning.
    pub translate_to: Option<String>,
    /// A style template JSON file, used instead of the named preset.
    pub style_file: Option<String>,
    /// Write `<output>.srt` / `.vtt` alongside the video.
    pub write_srt: bool,
    pub write_vtt: bool,
}

impl BurnOptions {
    fn trim(&self) -> TrimRange {
        TrimRange::new(self.start.unwrap_or(0.0), self.end)
    }

    fn size(&self) -> OutputSize {
        self.height.map_or(OutputSize::Source, OutputSize::Height)
    }

    fn translate_request(&self) -> Option<TranslateRequest> {
        self.translate_to
            .as_ref()
            .filter(|t| !t.trim().is_empty())
            .map(TranslateRequest::to)
    }
}

/// The default output path: `<input-stem>.subbed.mp4`, next to the input.
/// Matches `apps/cli`'s `default_output` exactly.
pub fn default_output(input: &Path) -> PathBuf {
    let stem = input
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("output");
    input.with_file_name(format!("{stem}.subbed.mp4"))
}

fn work_dir_for(output: &Path) -> PathBuf {
    let tag = output.file_stem().and_then(|s| s.to_str()).unwrap_or("job");
    std::env::temp_dir().join(format!(
        "opensubs-desktop-work-{}-{tag}",
        std::process::id()
    ))
}

/// Resolve the ffmpeg binary: prefer a bundled sidecar next to the running
/// executable, fall back to searching `PATH`. Matches `apps/cli`.
fn resolve_ffmpeg() -> PathBuf {
    let vendor_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("vendor")))
        .unwrap_or_else(|| PathBuf::from("vendor"));
    subs_pipeline::ffmpeg_binary(&vendor_dir)
}

/// `ffprobe` is assumed to be a sibling of the resolved `ffmpeg` binary.
/// Falls back to searching `PATH` when `ffmpeg` itself was resolved from
/// `PATH` (a bare, parent-less name). Matches `apps/cli`.
fn resolve_ffprobe(ffmpeg_bin: &Path) -> PathBuf {
    let name = if cfg!(windows) {
        "ffprobe.exe"
    } else {
        "ffprobe"
    };
    match ffmpeg_bin.parent() {
        Some(dir) if !dir.as_os_str().is_empty() => dir.join(name),
        _ => PathBuf::from(name),
    }
}

/// True when `ffmpeg -filters` output lists the `ass` filter. Split out from
/// [`has_ass_filter`] so the parsing itself is unit-testable without
/// spawning a process.
fn parse_filters_output(text: &str) -> bool {
    text.lines()
        .any(|l| l.split_whitespace().nth(1) == Some("ass"))
}

fn has_ass_filter(ffmpeg_bin: &Path) -> Result<bool, String> {
    let out = Process::new(ffmpeg_bin)
        .arg("-filters")
        .output()
        .map_err(|e| format!("failed to run {} -filters: {e}", ffmpeg_bin.display()))?;
    Ok(parse_filters_output(&String::from_utf8_lossy(&out.stdout)))
}

fn probe_media(ffprobe: &Path, input: &Path) -> Result<MediaInfo, String> {
    let out = Process::new(ffprobe)
        .args(probe_args(input))
        .output()
        .map_err(|e| format!("failed to run {}: {e}", ffprobe.display()))?;
    if !out.status.success() {
        return Err(format!(
            "{} exited with {}: {}",
            ffprobe.display(),
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    MediaInfo::from_ffprobe_json(&String::from_utf8_lossy(&out.stdout))
        .map_err(|e| format!("could not parse ffprobe output: {e}"))
}

/// The desktop app has one quality tier: `libx264 -crf 16 -preset slow`,
/// matching the CLI's own defaults and the project's stated "highest
/// quality output possible" goal. HDR is always requested for tonemap --
/// harmless on SDR sources, which `plan_job` leaves untouched (see
/// `subs-pipeline`'s `sdr_input_gets_no_tonemapper_even_when_requested`).
/// `prefer_gpu_tonemap` stays false: `libplacebo` is Vulkan-only and macOS,
/// the primary platform, has no Vulkan driver.
pub fn build_job_spec(
    input: PathBuf,
    output: PathBuf,
    style: StyleTemplate,
    work_dir: PathBuf,
    options: &BurnOptions,
) -> JobSpec {
    JobSpec {
        input,
        output,
        style,
        fonts_dir: work_dir.clone(),
        work_dir,
        encoder: VideoEncoder::X264,
        crf: 16,
        preset: "slow".to_string(),
        tonemap: true,
        prefer_gpu_tonemap: false,
        trim: options.trim(),
        size: options.size(),
        translate: options.translate_request(),
    }
}

fn extract_asr_audio(
    ffmpeg_bin: &Path,
    input: &Path,
    out_wav: &Path,
    trim: TrimRange,
) -> Result<(), String> {
    // The same span the burn will export, so the transcript's clock and
    // the clip's clock are the same clock.
    let argv = subs_media::extract_audio_args(input, out_wav, trim);
    let out = Process::new(ffmpeg_bin)
        .args(&argv)
        .output()
        .map_err(|e| format!("failed to spawn {}: {e}", ffmpeg_bin.display()))?;
    if !out.status.success() {
        return Err(format!(
            "ffmpeg exited with {}: {}",
            out.status,
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    let meta = std::fs::metadata(out_wav)
        .map_err(|e| format!("no output at {}: {e}", out_wav.display()))?;
    if meta.len() <= 44 {
        return Err(format!(
            "{} is empty (only a WAV header, {} bytes) -- does the input have an audio stream?",
            out_wav.display(),
            meta.len()
        ));
    }
    Ok(())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BurnProgressPayload {
    percent: f64,
    done: bool,
}

/// Spawn the burn, streaming `-progress pipe:1` into `burn-progress` events
/// (real ffmpeg progress -- see `subs_pipeline::ProgressParser` -- never a
/// synthetic timer). Returns an error carrying stderr on failure, matching
/// `apps/cli`'s `run_burn`.
fn run_burn_ffmpeg(
    app: &AppHandle,
    ffmpeg_bin: &Path,
    argv: &[String],
    total_duration: f64,
) -> Result<(), String> {
    let mut child = Process::new(ffmpeg_bin)
        .args(argv)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", ffmpeg_bin.display()))?;

    // Read stderr on its own thread so a full pipe buffer there can never
    // block the stdout progress reader (or vice versa).
    let stderr = child.stderr.take().expect("stderr was piped");
    let stderr_thread = thread::spawn(move || {
        let mut buf = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut buf);
        buf
    });

    let stdout = child.stdout.take().expect("stdout was piped");
    let mut parser = ProgressParser::new();
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if let Some(event) = parser.feed_line(&line) {
            let payload = BurnProgressPayload {
                percent: event.percent_of(total_duration),
                done: event.done,
            };
            // A dropped/closed window is not a burn failure -- ignore.
            let _ = app.emit("burn-progress", payload);
        }
    }

    let status = child
        .wait()
        .map_err(|e| format!("failed to wait on ffmpeg: {e}"))?;
    let stderr_text = stderr_thread.join().unwrap_or_default();

    if !status.success() {
        return Err(format!(
            "ffmpeg exited with {status}: {}",
            stderr_text.trim()
        ));
    }
    Ok(())
}

/// Groups the filesystem locations a burn job touches -- pulled out of
/// [`run_burn_job_in`]'s argument list, which clippy's `too_many_arguments`
/// otherwise flags.
struct BurnPaths<'a> {
    input: &'a Path,
    output: &'a Path,
    work_dir: &'a Path,
    ffmpeg_bin: &'a Path,
    model_path: &'a Path,
}

fn run_burn_job_in(
    app: &AppHandle,
    paths: BurnPaths<'_>,
    style: StyleTemplate,
    info: &MediaInfo,
    options: &BurnOptions,
) -> Result<String, String> {
    let BurnPaths {
        input,
        output,
        work_dir,
        ffmpeg_bin,
        model_path,
    } = paths;

    // Built before the transcription runs: a missing API key must be
    // reported now, not after the user has waited out a full transcribe.
    let translator: Option<Box<dyn Translator>> = match options.translate_request() {
        Some(_) => Some(Box::new(
            ClaudeTranslator::from_env().map_err(|e| e.to_string())?,
        )),
        None => None,
    };

    let wav_path = work_dir.join("asr.wav");
    extract_asr_audio(ffmpeg_bin, input, &wav_path, options.trim())
        .map_err(|e| format!("extracting ASR audio from {}: {e}", input.display()))?;

    let transcriber =
        FfmpegWhisperTranscriber::new(ffmpeg_bin.to_path_buf(), model_path.to_path_buf());

    let spec = build_job_spec(
        input.to_path_buf(),
        output.to_path_buf(),
        style,
        work_dir.to_path_buf(),
        options,
    );

    let planned = plan_job(&spec, info, &transcriber, translator.as_deref())
        .map_err(|e| format!("transcription/planning failed: {e}"))?;

    write_ass(&planned).map_err(|e| format!("writing {}: {e}", planned.ass_path.display()))?;

    // Progress is a fraction of the exported clip, not of the source: a
    // 20-second cut from an hour-long file would otherwise creep to 1%.
    run_burn_ffmpeg(app, ffmpeg_bin, &planned.burn_argv, planned.clip_duration)
        .map_err(|e| format!("burning {}: {e}", output.display()))?;

    if options.write_srt {
        let path = output.with_extension("srt");
        std::fs::write(&path, to_srt(&planned.cues))
            .map_err(|e| format!("writing {}: {e}", path.display()))?;
    }
    if options.write_vtt {
        let path = output.with_extension("vtt");
        std::fs::write(&path, to_vtt(&planned.cues))
            .map_err(|e| format!("writing {}: {e}", path.display()))?;
    }

    Ok(output.to_string_lossy().into_owned())
}

fn run_burn_job(
    app: &AppHandle,
    path: &str,
    style_name: &str,
    model: &str,
    output: Option<String>,
    options: &BurnOptions,
) -> Result<String, String> {
    let input = PathBuf::from(path);
    let model_path = PathBuf::from(model);
    if !model_path.is_file() {
        return Err(format!(
            "whisper model not found at {} -- pick a .ggml/.bin model in the model picker",
            model_path.display()
        ));
    }

    let ffmpeg_bin = resolve_ffmpeg();
    let ffprobe_bin = resolve_ffprobe(&ffmpeg_bin);

    match has_ass_filter(&ffmpeg_bin) {
        Ok(true) => {}
        Ok(false) => {
            return Err(format!(
                "{} has no libass (the `ass` filter is not registered in its `-filters` \
                 output) and cannot burn subtitles. Install an ffmpeg build with \
                 --enable-libass, e.g. Homebrew's `ffmpeg-full` (`brew install ffmpeg-full`).",
                ffmpeg_bin.display()
            ))
        }
        Err(e) => {
            return Err(format!(
                "could not check {} for libass: {e}",
                ffmpeg_bin.display()
            ))
        }
    }

    let info = probe_media(&ffprobe_bin, &input)
        .map_err(|e| format!("probe of {}: {e}", input.display()))?;

    options
        .trim()
        .validate(info.duration)
        .map_err(|e| format!("{e} (the video is {:.2}s long)", info.duration))?;

    // A template file overrides the named preset, which is how a user's own
    // look reaches the burn.
    let style = match &options.style_file {
        Some(file) => {
            let text = std::fs::read_to_string(file)
                .map_err(|e| format!("reading style file {file}: {e}"))?;
            subs_style::from_json_str(&text).map_err(|e| format!("{file}: {e}"))?
        }
        None => subs_style::preset_by_name(style_name)
            .ok_or_else(|| format!("unknown style '{style_name}'"))?,
    };

    let output_path = output
        .map(PathBuf::from)
        .unwrap_or_else(|| default_output(&input));
    let work_dir = work_dir_for(&output_path);
    std::fs::create_dir_all(&work_dir).map_err(|e| {
        format!(
            "could not create work directory {}: {e}",
            work_dir.display()
        )
    })?;

    let result = run_burn_job_in(
        app,
        BurnPaths {
            input: &input,
            output: &output_path,
            work_dir: &work_dir,
            ffmpeg_bin: &ffmpeg_bin,
            model_path: &model_path,
        },
        style,
        &info,
        options,
    );
    let _ = std::fs::remove_dir_all(&work_dir);
    result
}

// ---------------------------------------------------------------------
// Tauri commands.
// ---------------------------------------------------------------------

#[tauri::command]
pub fn probe(path: String) -> Result<MediaInfoDto, String> {
    let input = PathBuf::from(&path);
    let ffmpeg_bin = resolve_ffmpeg();
    let ffprobe_bin = resolve_ffprobe(&ffmpeg_bin);
    let info = probe_media(&ffprobe_bin, &input).map_err(|e| format!("probe of {path}: {e}"))?;
    let filename = input
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or(&path)
        .to_string();
    Ok(media_info_to_dto(&filename, &info))
}

#[tauri::command]
pub fn list_styles() -> Vec<StyleDto> {
    subs_style::all_presets().iter().map(style_to_dto).collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureDto {
    pub id: String,
    pub title: String,
    pub tier: String,
    pub why: String,
    pub unlocked: bool,
}

/// What is free, what is premium, and what this build actually gates --
/// which is nothing. See `subs-tier`.
#[tauri::command]
pub fn list_features() -> Vec<FeatureDto> {
    subs_tier::catalog()
        .into_iter()
        .map(|f| FeatureDto {
            id: f.id.to_string(),
            title: f.title.to_string(),
            tier: f.tier.label().to_string(),
            why: f.why.to_string(),
            unlocked: f.unlocked,
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LanguageDto {
    pub code: String,
    pub name: String,
    pub endonym: String,
}

#[tauri::command]
pub fn list_languages() -> Vec<LanguageDto> {
    subs_translate::languages()
        .iter()
        .map(|l| LanguageDto {
            code: l.code.to_string(),
            name: l.name.to_string(),
            endonym: l.endonym.to_string(),
        })
        .collect()
}

/// Whether a translation could run right now.
///
/// Translation calls the Claude API with the user's own key, so the UI
/// checks this before offering it rather than letting the user set up a
/// translated export and fail at the end of it.
#[tauri::command]
pub fn translation_ready() -> bool {
    subs_translate::claude::api_key_from_env().is_some()
}

/// A shipped preset as template JSON, for a user to save and edit.
#[tauri::command]
pub fn export_style(name: String) -> Result<String, String> {
    subs_style::preset_by_name(&name)
        .map(|t| subs_style::to_json_string(&t))
        .ok_or_else(|| format!("no preset named '{name}'"))
}

/// Pre-flight check surfaced by the UI before a burn is attempted: `Ok(true)`
/// means ffmpeg has libass and can burn subtitles, `Ok(false)` means it was
/// found but lacks the `ass` filter (plain Homebrew `ffmpeg`, most likely).
#[tauri::command]
pub fn check_ffmpeg() -> Result<bool, String> {
    has_ass_filter(&resolve_ffmpeg())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FfmpegInstallOutputPayload {
    line: String,
}

/// Runs `brew install ffmpeg-full`, emitting each line of its output as a
/// `ffmpeg-install-output` event so the UI can show live progress instead of
/// a frozen button for the several minutes a real install takes. The
/// frontend re-runs `check_ffmpeg` after this resolves to learn whether it
/// actually fixed things -- this command only reports whether the install
/// itself succeeded, not whether libass ended up present.
#[tauri::command]
pub async fn install_ffmpeg(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        subs_pipeline::install_ffmpeg_full(|line| {
            let _ = app.emit(
                "ffmpeg-install-output",
                FfmpegInstallOutputPayload {
                    line: line.to_string(),
                },
            );
        })
    })
    .await
    .map_err(|e| format!("install task panicked: {e}"))?
}

fn settings_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|d| d.join("settings.json"))
        .map_err(|e| format!("could not resolve app config directory: {e}"))
}

#[tauri::command]
pub fn get_model_path(app: AppHandle) -> Result<Option<String>, String> {
    Ok(settings::load(&settings_path(&app)?).model_path)
}

#[tauri::command]
pub fn set_model_path(app: AppHandle, path: String) -> Result<(), String> {
    let settings_file = settings_path(&app)?;
    let updated = DesktopSettings {
        model_path: Some(path),
    };
    settings::save(&settings_file, &updated).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn burn(
    app: AppHandle,
    path: String,
    style: String,
    model: String,
    output: Option<String>,
    options: Option<BurnOptions>,
) -> Result<String, String> {
    let options = options.unwrap_or_default();
    // Off the async runtime's own worker threads: ffmpeg/whisper.cpp run for
    // minutes on real video, and this keeps both the webview and any other
    // in-flight command responsive.
    tauri::async_runtime::spawn_blocking(move || {
        run_burn_job(&app, &path, &style, &model, output, &options)
    })
    .await
    .map_err(|e| format!("burn task panicked: {e}"))?
}

#[tauri::command]
pub fn reveal(path: String) -> Result<(), String> {
    let status = Process::new("open")
        .arg("-R")
        .arg(&path)
        .status()
        .map_err(|e| format!("failed to run 'open -R {path}': {e}"))?;
    if !status.success() {
        return Err(format!("'open -R {path}' exited with {status}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use subs_media::{ColorMeta, Rational};

    fn media_info(rotation: u32, transfer: Option<&str>) -> MediaInfo {
        MediaInfo {
            width: 1920,
            height: 1080,
            fps: Rational { num: 30, den: 1 },
            duration: 12.5,
            pix_fmt: "yuv420p".into(),
            video_codec: Some("h264".into()),
            color: ColorMeta {
                space: Some("bt709".into()),
                primaries: Some("bt709".into()),
                transfer: transfer.map(str::to_string),
                range: Some("tv".into()),
            },
            rotation,
            has_audio: true,
            audio_codec: Some("aac".into()),
            start_time: 0.0,
        }
    }

    #[test]
    fn media_info_dto_uses_display_dimensions_not_stored_dimensions() {
        let info = media_info(90, Some("bt709"));
        let dto = media_info_to_dto("clip.mov", &info);
        // Stored 1920x1080 rotated 90 degrees displays as 1080x1920.
        assert_eq!(dto.display_width, 1080);
        assert_eq!(dto.display_height, 1920);
        assert_eq!(dto.filename, "clip.mov");
        assert!((dto.fps - 30.0).abs() < 1e-9);
        assert!((dto.duration - 12.5).abs() < 1e-9);
        assert!(dto.has_audio);
        assert!(!dto.is_hdr);
    }

    #[test]
    fn media_info_dto_detects_hdr_transfer() {
        let info = media_info(0, Some("smpte2084"));
        assert!(media_info_to_dto("clip.mp4", &info).is_hdr);
        let info = media_info(0, Some("arib-std-b67"));
        assert!(media_info_to_dto("clip.mp4", &info).is_hdr);
    }

    #[test]
    fn media_info_dto_unrotated_display_dims_match_storage() {
        let info = media_info(0, None);
        let dto = media_info_to_dto("clip.mp4", &info);
        assert_eq!((dto.display_width, dto.display_height), (1920, 1080));
    }

    #[test]
    fn style_to_dto_produces_six_valid_swatches_with_lowercase_hex() {
        let dtos: Vec<StyleDto> = subs_style::presets().iter().map(style_to_dto).collect();
        assert_eq!(dtos.len(), 6);
        for dto in &dtos {
            assert!(!dto.name.is_empty());
            assert_eq!(dto.primary_hex.len(), 7, "{}", dto.name);
            assert!(dto.primary_hex.starts_with('#'), "{}", dto.name);
            assert_eq!(
                dto.primary_hex,
                dto.primary_hex.to_lowercase(),
                "{}",
                dto.name
            );
            assert!(
                matches!(dto.border_style.as_str(), "outline" | "box"),
                "{}: {}",
                dto.name,
                dto.border_style
            );
        }
    }

    #[test]
    fn style_to_dto_boxed_preset_is_the_opaque_box_style() {
        let boxed = subs_style::preset_by_name("Boxed").unwrap();
        assert_eq!(style_to_dto(&boxed).border_style, "box");
        let clean = subs_style::preset_by_name("Clean").unwrap();
        assert_eq!(style_to_dto(&clean).border_style, "outline");
    }

    #[test]
    fn hex_of_round_trips_known_colours() {
        assert_eq!(
            hex_of(Rgba {
                r: 255,
                g: 214,
                b: 10,
                a: 255
            }),
            "#ffd60a"
        );
        assert_eq!(
            hex_of(Rgba {
                r: 0,
                g: 0,
                b: 0,
                a: 255
            }),
            "#000000"
        );
    }

    #[test]
    fn default_output_appends_subbed_suffix_next_to_input() {
        assert_eq!(
            default_output(Path::new("clip.mp4")),
            PathBuf::from("clip.subbed.mp4")
        );
        assert_eq!(
            default_output(Path::new("/videos/clip.mov")),
            PathBuf::from("/videos/clip.subbed.mp4")
        );
    }

    #[test]
    fn default_output_handles_missing_extension_without_panicking() {
        assert_eq!(
            default_output(Path::new("noext")),
            PathBuf::from("noext.subbed.mp4")
        );
    }

    #[test]
    fn work_dir_for_is_derived_from_the_output_stem() {
        let dir = work_dir_for(Path::new("/out/clip.subbed.mp4"));
        let name = dir.file_name().unwrap().to_str().unwrap();
        assert!(name.starts_with("opensubs-desktop-work-"));
        assert!(name.ends_with("-clip.subbed"));
    }

    #[test]
    fn resolve_ffprobe_uses_sibling_of_ffmpeg_when_a_parent_dir_is_present() {
        let ffprobe = resolve_ffprobe(Path::new("/opt/homebrew/bin/ffmpeg"));
        assert_eq!(ffprobe, PathBuf::from("/opt/homebrew/bin/ffprobe"));
    }

    #[test]
    fn resolve_ffprobe_falls_back_to_path_search_for_a_bare_name() {
        let ffprobe = resolve_ffprobe(Path::new("ffmpeg"));
        assert_eq!(ffprobe, PathBuf::from("ffprobe"));
    }

    #[test]
    fn parse_filters_output_detects_the_ass_filter_line() {
        // Real `ffmpeg -filters` shape: a flags column, then the filter name.
        let sample = " ..C atadenoise      A->A       Apply an Adaptive Temporal Averaging Denoiser.\n \
                       ..C ass              V->V       Render subtitles onto input video using the libass library.\n";
        assert!(parse_filters_output(sample));
    }

    #[test]
    fn parse_filters_output_is_false_when_ass_is_absent() {
        let sample =
            " ... T.. atadenoise      A->A       Apply an Adaptive Temporal Averaging Denoiser.\n";
        assert!(!parse_filters_output(sample));
    }

    #[test]
    fn parse_filters_output_handles_empty_input() {
        assert!(!parse_filters_output(""));
    }

    #[test]
    fn build_job_spec_uses_the_highest_quality_defaults() {
        let style = subs_style::preset_by_name("Clean").unwrap();
        let spec = build_job_spec(
            PathBuf::from("in.mp4"),
            PathBuf::from("out.mp4"),
            style,
            PathBuf::from("/tmp/work"),
            &BurnOptions::default(),
        );
        assert_eq!(spec.encoder, VideoEncoder::X264);
        assert_eq!(spec.crf, 16);
        assert_eq!(spec.preset, "slow");
        assert!(spec.tonemap);
        // libplacebo is Vulkan-only; macOS (the primary platform) has no
        // Vulkan driver and would hard-fail every burn.
        assert!(!spec.prefer_gpu_tonemap);
        assert_eq!(spec.fonts_dir, spec.work_dir);
    }

    fn spec_with(options: &BurnOptions) -> JobSpec {
        build_job_spec(
            PathBuf::from("in.mp4"),
            PathBuf::from("out.mp4"),
            subs_style::preset_by_name("Clean").unwrap(),
            PathBuf::from("/tmp/work"),
            options,
        )
    }

    #[test]
    fn default_options_are_the_export_the_app_produced_before_they_existed() {
        let spec = spec_with(&BurnOptions::default());
        assert!(spec.trim.is_full());
        assert_eq!(spec.size, OutputSize::Source);
        assert!(spec.translate.is_none());
    }

    #[test]
    fn an_absent_options_object_deserialises_to_the_defaults() {
        // The front end may send `{}` or omit the field entirely; both must
        // mean "unchanged", not "fail".
        let from_empty: BurnOptions = serde_json::from_str("{}").unwrap();
        assert_eq!(from_empty, BurnOptions::default());
    }

    #[test]
    fn options_reach_the_spec() {
        let options = BurnOptions {
            start: Some(3.0),
            end: Some(9.0),
            height: Some(1080),
            translate_to: Some("ja".into()),
            style_file: None,
            write_srt: true,
            write_vtt: false,
        };
        let spec = spec_with(&options);
        assert_eq!(spec.trim, TrimRange::new(3.0, Some(9.0)));
        assert_eq!(spec.size, OutputSize::Height(1080));
        assert_eq!(spec.translate, Some(TranslateRequest::to("ja")));
    }

    #[test]
    fn a_blank_translation_target_is_not_a_translation_request() {
        // An empty <select> value must not start a translated export that
        // then fails for want of a language.
        let options = BurnOptions {
            translate_to: Some("   ".into()),
            ..BurnOptions::default()
        };
        assert!(spec_with(&options).translate.is_none());
    }

    #[test]
    fn every_shipped_preset_reaches_the_ui_with_its_pack() {
        let dtos = list_styles();
        assert_eq!(dtos.len(), subs_style::all_presets().len());
        assert!(dtos.iter().any(|d| d.name == "Clean" && d.pack == "Core"));
        assert!(dtos
            .iter()
            .any(|d| d.name == "Neon" && d.pack == "Advanced"));
    }

    #[test]
    fn the_feature_list_reaches_the_ui_fully_unlocked() {
        let features = list_features();
        assert_eq!(features.len(), subs_tier::catalog().len());
        assert!(features.iter().all(|f| f.unlocked));
        assert!(features.iter().any(|f| f.tier == "Premium"));
        assert!(features.iter().any(|f| f.tier == "Free"));
    }

    #[test]
    fn a_preset_exports_as_a_template_the_style_loader_accepts() {
        let json = export_style("Neon".into()).unwrap();
        let back = subs_style::from_json_str(&json).unwrap();
        assert_eq!(back.name, "Neon");
        assert!(export_style("nope".into()).is_err());
    }
}
