//! Tauri command layer: thin glue over the already-tested `subs-*` crates.
//!
//! Mirrors `apps/cli` exactly (same probe/pre-flight/plan/burn sequence) but
//! reports progress through Tauri events instead of a terminal line, and
//! always runs the "highest quality" pipeline -- x264 `-crf 16 -preset
//! slow`, always-attempted HDR tonemap (a no-op on SDR sources) -- since the
//! desktop app exposes no encoder/quality knobs; see `build_job_spec`.

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::thread;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime};

use subs_whisper::WhisperTranscriber;
use subs_media::{probe_args, MediaInfo, OutputSize, TrimRange, VideoEncoder};
use subs_pipeline::{plan_job, write_ass, ChineseScript, JobSpec, ProgressParser};
use subs_style::{BorderStyle, Rgba, StyleTemplate};
use subs_subtitle::{to_srt, to_txt, to_vtt};
use subs_asr::{AsrOptions, AudioRef, Transcriber};
use subs_translate::{ClaudeTranslator, TranslateRequest, Translator};

use crate::cloud::{
    asr_work_dir, CachedTranscriber, CloudTranslation, PendingTranscripts, PresetTranslator,
    TranscribedDto, TranscriptKey,
};
use crate::settings::{self, DesktopSettings};

// ---------------------------------------------------------------------
// DTOs and pure conversions -- the part of this module worth unit testing.
// ---------------------------------------------------------------------

/// A failure, as the window shows it: a sentence for the person, and the
/// technical text behind a "Details" toggle.
///
/// Before this, the window showed whatever string the failing step
/// produced -- ffprobe's "moov atom not found", ffmpeg's "Stream map ''
/// matches no streams" -- with the full path of the file, the user's name
/// in it, and the command line. That reads as the app being broken when the
/// file is, and it goes wherever a screenshot asking for help goes.
/// `message` never holds a path; `details` has the home directory taken out.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserError {
    /// What went wrong, for the window to act on: `noAudio`, `unreadable`,
    /// `noSpeech`, `englishOnlyModel`, `model`, `ffmpeg`, `clip`, `style`,
    /// `translation` or `failed`.
    pub kind: &'static str,
    pub message: String,
    pub details: Option<String>,
    /// For `englishOnlyModel`: the language the speech sounded like.
    pub language: Option<String>,
}

impl UserError {
    fn new(kind: &'static str, message: impl Into<String>) -> Self {
        Self { kind, message: message.into(), details: None, language: None }
    }

    fn with_details(mut self, details: impl AsRef<str>) -> Self {
        let text = redact(details.as_ref(), dirs::home_dir().as_deref());
        // The end is where a tool says what went wrong; keep that.
        let chars: Vec<char> = text.chars().collect();
        let tail = chars.len().saturating_sub(4000);
        self.details = Some(chars[tail..].iter().collect::<String>().trim().to_string());
        self
    }

    fn unreadable(details: impl AsRef<str>) -> Self {
        Self::new(
            "unreadable",
            "OpenSubs can't read this file. It may be damaged, not fully downloaded, or not a video.",
        )
        .with_details(details)
    }

    fn no_audio() -> Self {
        Self::new("noAudio", "This video has no sound, so there is nothing to subtitle.")
    }

    fn no_speech() -> Self {
        Self::new(
            "noSpeech",
            "No speech was found in this video -- only silence, music or other sounds -- so no subtitles were made and nothing was saved.",
        )
    }

    fn failed(message: impl Into<String>, details: impl AsRef<str>) -> Self {
        Self::new("failed", message).with_details(details)
    }
}

/// Text with the user's home directory written as `~`, and any other
/// user's name in a path written as `…`, so details can be read out or
/// screenshotted without naming anyone.
pub fn redact(text: &str, home: Option<&Path>) -> String {
    let mut out = text.to_string();
    if let Some(home) = home.map(|h| h.to_string_lossy().into_owned()).filter(|h| h.len() > 3) {
        let forms = [home.clone(), home.replace('\\', "/"), home.replace('/', "\\")];
        for form in forms {
            out = replace_ignoring_case(&out, &form, "~");
        }
    }
    for marker in ["\\Users\\", "/Users/", "/home/"] {
        out = hide_after(&out, marker);
    }
    out
}

fn replace_ignoring_case(text: &str, needle: &str, with: &str) -> String {
    let lower = text.to_lowercase();
    let needle_lower = needle.to_lowercase();
    if needle_lower.is_empty() || lower.len() != text.len() {
        return text.replace(needle, with);
    }
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while let Some(found) = lower[at..].find(&needle_lower) {
        out.push_str(&text[at..at + found]);
        out.push_str(with);
        at += found + needle.len();
    }
    out.push_str(&text[at..]);
    out
}

/// Replace the path component after each `marker` with `…`.
fn hide_after(text: &str, marker: &str) -> String {
    let lower = text.to_lowercase();
    let m = marker.to_lowercase();
    let mut out = String::with_capacity(text.len());
    let mut at = 0;
    while let Some(found) = lower[at..].find(&m) {
        let start = at + found + marker.len();
        out.push_str(&text[at..start]);
        let rest = &text[start..];
        let end = rest.find(['\\', '/', ':', '"', '\'', ' ', '\n']).unwrap_or(rest.len());
        if end > 0 && &rest[..end] != "…" && &rest[..end] != "Shared" && &rest[..end] != "Public" {
            out.push('…');
        } else {
            out.push_str(&rest[..end]);
        }
        at = start + end;
    }
    out.push_str(&text[at..]);
    out
}

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
    /// Write `<output>.txt`: the words alone, without timings.
    pub write_txt: bool,
    /// Translations already bought from OpenSubs' cloud translation, for a
    /// transcript `transcribe_for_cloud` made. See `cloud`.
    pub cloud: Option<CloudTranslation>,
    /// `"simplified"` or `"traditional"`: the script untranslated Chinese
    /// speech is written in. A translation into 简体 or 繁體 always comes
    /// out in that script regardless.
    pub chinese_script: Option<String>,
    /// Transcribe with an English-only model even though the speech
    /// sounded like another language -- the person was told and chose to.
    pub allow_english_only: bool,
}

impl BurnOptions {
    fn trim(&self) -> TrimRange {
        TrimRange::new(self.start.unwrap_or(0.0), self.end)
    }

    fn size(&self) -> OutputSize {
        self.height.map_or(OutputSize::Source, OutputSize::Height)
    }

    fn chinese_script(&self) -> Option<ChineseScript> {
        self.chinese_script.as_deref().and_then(ChineseScript::parse)
    }

    fn translate_request(&self) -> Option<TranslateRequest> {
        self.translate_to
            .as_ref()
            .filter(|t| !t.trim().is_empty())
            .map(TranslateRequest::to)
    }

    fn transcript_key(&self, path: &str, model: &str) -> TranscriptKey {
        TranscriptKey {
            path: path.to_string(),
            model: model.to_string(),
            start: self.start,
            end: self.end,
        }
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

/// The text files an export can write beside the video.
const SIDECARS: [&str; 3] = ["srt", "vtt", "txt"];

/// Where an export is written: `<stem>.subbed.mp4` next to the input, or
/// the first `<stem>.subbed (1).mp4`, `(2)`, ... that nothing is using.
///
/// An export never replaces a file. It used to: exporting the same video
/// twice to compare two looks kept only the second, and `a.mp4`, `a.mov`,
/// `a.mkv` and `a.webm` in one folder all wrote `a.subbed.mp4`, each over
/// the one before. Numbering is how Explorer and Finder name a second copy,
/// so the name says what it is, and the success card shows exactly which
/// file was written.
///
/// A name counts as taken when the video *or any* of the text files exists
/// under it -- not just the ones this export writes. Otherwise a new video
/// would sit beside last time's `.vtt` under the same name and the old
/// subtitles would look like this export's.
pub fn unique_output(input: &Path, exists: impl Fn(&Path) -> bool) -> PathBuf {
    let first = default_output(input);
    let stem = first.file_stem().and_then(|s| s.to_str()).unwrap_or("output.subbed").to_string();
    let taken = |video: &Path| exists(video) || SIDECARS.iter().any(|ext| exists(&video.with_extension(ext)));
    if !taken(&first) {
        return first;
    }
    (1..)
        .map(|n| first.with_file_name(format!("{stem} ({n}).mp4")))
        .find(|candidate| !taken(candidate))
        .expect("an unused name exists")
}

/// Where ffmpeg writes before the export is complete: beside the output,
/// renamed into place only once the burn has succeeded, so a failed or
/// cancelled export never leaves a broken file under the real name.
fn partial_path(output: &Path) -> PathBuf {
    let stem = output.file_stem().and_then(|s| s.to_str()).unwrap_or("output");
    output.with_file_name(format!("{stem}.part.mp4"))
}

fn work_dir_for(output: &Path) -> PathBuf {
    let tag = output.file_stem().and_then(|s| s.to_str()).unwrap_or("job");
    std::env::temp_dir().join(format!(
        "opensubs-desktop-work-{}-{tag}",
        std::process::id()
    ))
}

/// Resolve the ffmpeg binary: prefer the one the installer ships, fall back
/// to searching `PATH`. Matches `apps/cli`.
///
/// Two places count as shipped, because the two platforms put bundled files
/// in different places: beside the executable on Windows, and in the app's
/// `Contents/Resources` on macOS (the executable is in `Contents/MacOS`).
fn resolve_ffmpeg() -> PathBuf {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(Path::to_path_buf))
        .unwrap_or_default();
    let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
    let vendor_dir = [exe_dir.join("vendor"), exe_dir.join("../Resources/vendor")]
        .into_iter()
        .find(|d| d.join(name).is_file())
        .unwrap_or_else(|| exe_dir.join("vendor"));
    subs_pipeline::ffmpeg_binary(&vendor_dir)
}

/// The Whisper model the installer ships, if this build shipped one.
pub(crate) fn bundled_model<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let path = app.path().resource_dir().ok()?.join("models").join(BUNDLED_MODEL);
    path.is_file().then_some(path)
}

/// Multilingual Base: the default the installers carry, so a fresh install
/// transcribes with no download. The larger and English-only ones stay in
/// the model picker as downloads.
const BUNDLED_MODEL: &str = "ggml-base.bin";

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

fn probe_media(ffprobe: &Path, input: &Path) -> Result<MediaInfo, String> {
    let out = subs_media::command(ffprobe)
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
        chinese_script: options.chinese_script(),
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
    let out = subs_media::command(ffmpeg_bin)
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
fn run_burn_ffmpeg<R: Runtime>(
    app: &AppHandle<R>,
    ffmpeg_bin: &Path,
    argv: &[String],
    total_duration: f64,
) -> Result<(), String> {
    let mut child = subs_media::command(ffmpeg_bin)
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

fn run_burn_job_in<R: Runtime>(
    app: &AppHandle<R>,
    paths: BurnPaths<'_>,
    style: StyleTemplate,
    info: &MediaInfo,
    options: &BurnOptions,
) -> Result<String, UserError> {
    let BurnPaths {
        input,
        output,
        work_dir,
        ffmpeg_bin,
        model_path,
    } = paths;

    // An export with paid cloud translations reuses the transcript they
    // were priced from: listening again could produce different cues, and
    // the translations would no longer line up.
    let cached = match &options.cloud {
        Some(cloud) => {
            if options.translate_request().is_none() {
                return Err(UserError::failed("The export did not start.", "cloud translations were supplied without a target language"));
            }
            let key = options.transcript_key(
                &input.to_string_lossy(),
                &model_path.to_string_lossy(),
            );
            Some(
                app.state::<PendingTranscripts>()
                    .get(&cloud.job_id, &key)
                    .map_err(|e| UserError::failed("The paid translation no longer matches this video. See the price again.", e))?,
            )
        }
        None => None,
    };
    let preset = options
        .cloud
        .as_ref()
        .map(|c| PresetTranslator::new(c.translations.clone()));

    // Built before the transcription runs: a missing API key must be
    // reported now, not after the user has waited out a full transcribe.
    //
    // Claude when there is a key for it; otherwise the offline model the
    // installer carries, so translating needs neither a key nor a network.
    let translator: Option<Box<dyn Translator>> = match options.translate_request() {
        Some(_) if preset.is_some() => None,
        Some(_) => Some(match ClaudeTranslator::from_env() {
            Ok(claude) => Box::new(claude) as Box<dyn Translator>,
            Err(no_key) => match bundled_translator(app) {
                Some(dir) => Box::new(
                    subs_m2m::M2mTranslator::new(&dir)
                        .map_err(|e| UserError::new("translation", "The offline translator could not start.").with_details(e.to_string()))?,
                ),
                None => {
                    return Err(UserError::new("translation", "Translation is not available in this build.").with_details(no_key.to_string()))
                }
            },
        }),
        None => None,
    };

    // whisper.cpp linked into the app, not ffmpeg's `whisper` filter: that
    // filter exists only in ffmpeg builds no installer can ship on macOS, and
    // needing one was the second install this app asked for.
    let transcriber: Box<dyn Transcriber> = match cached {
        Some(transcript) => Box::new(CachedTranscriber(transcript)),
        None => {
            let wav_path = work_dir.join("asr.wav");
            extract_asr_audio(ffmpeg_bin, input, &wav_path, options.trim())
                .map_err(|e| UserError::unreadable(format!("extracting the audio from {}: {e}", input.display())))?;
            check_model_language(bundled_model(app).as_deref(), model_path, &wav_path, options)?;
            Box::new(WhisperTranscriber::new(model_path.to_path_buf()))
        }
    };

    // ffmpeg writes beside the output and the file is moved into place only
    // once it is complete.
    let partial = partial_path(output);
    let spec = build_job_spec(
        input.to_path_buf(),
        partial.clone(),
        style,
        work_dir.to_path_buf(),
        options,
    );

    let translator: Option<&dyn Translator> = match &preset {
        Some(p) => Some(p),
        None => translator.as_deref(),
    };
    let planned = plan_job(&spec, info, transcriber.as_ref(), translator).map_err(|e| match e {
        subs_pipeline::JobError::Translate(t) => UserError::new("translation", "Translation failed, so nothing was exported.").with_details(t.to_string()),
        other => UserError::failed("Listening to the video failed.", other.to_string()),
    })?;
    if preset.as_ref().is_some_and(|p| p.remaining() > 0) {
        return Err(UserError::failed(
            "The paid translations did not match the subtitles, so nothing was exported.",
            "translations left over after every cue was filled",
        ));
    }
    // Nobody speaks: say so, rather than burn a video with no subtitles or
    // with the ones Whisper writes over silence and music.
    if planned.cues.is_empty() {
        return Err(UserError::no_speech());
    }

    write_ass(&planned).map_err(|e| UserError::failed("The export could not start.", format!("writing {}: {e}", planned.ass_path.display())))?;

    // Progress is a fraction of the exported clip, not of the source: a
    // 20-second cut from an hour-long file would otherwise creep to 1%.
    if let Err(e) = run_burn_ffmpeg(app, ffmpeg_bin, &planned.burn_argv, planned.clip_duration) {
        let _ = std::fs::remove_file(&partial);
        return Err(UserError::failed("Burning the subtitles into the video failed.", e));
    }
    std::fs::rename(&partial, output).map_err(|e| {
        let _ = std::fs::remove_file(&partial);
        UserError::failed("The finished video could not be saved.", format!("moving {} to {}: {e}", partial.display(), output.display()))
    })?;

    // Every text file this export was asked for, written fresh under its
    // own name; `unique_output` chose a name no older one is using.
    let sidecars = [
        (options.write_srt, "srt", to_srt(&planned.cues)),
        (options.write_vtt, "vtt", to_vtt(&planned.cues)),
        (options.write_txt, "txt", to_txt(&planned.cues)),
    ];
    for (wanted, ext, text) in sidecars {
        if wanted {
            let path = output.with_extension(ext);
            std::fs::write(&path, text)
                .map_err(|e| UserError::failed(format!("The video was saved, but its .{ext} file could not be."), format!("writing {}: {e}", path.display())))?;
        }
    }

    Ok(output.to_string_lossy().into_owned())
}

/// Stop before an English-only model writes English over speech that is
/// not English.
///
/// Such a model has no other language to give: Mandarin through
/// `ggml-tiny.en.bin` comes back as English words nobody said, or as
/// "(speaking in foreign language)". The language is judged by the multilingual model the installer carries, on
/// the voice alone, before anything is transcribed. The person can still
/// go ahead (`allow_english_only`), having been told. A build without the
/// multilingual model, or audio with no speech to judge, is not stopped.
fn check_model_language(judge: Option<&Path>, model: &Path, wav: &Path, options: &BurnOptions) -> Result<(), UserError> {
    if options.allow_english_only || subs_whisper::model_is_english_only(model) != Some(true) {
        return Ok(());
    }
    let Some(judge) = judge else {
        return Ok(());
    };
    match subs_whisper::spoken_language(judge, &AudioRef::new(wav)) {
        Ok(Some((language, p))) if language != "en" && p >= 0.5 => {
            let name = subs_whisper::language_name(&language).unwrap_or_else(|| language.clone());
            let file = model.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
            Err(UserError {
                kind: "englishOnlyModel",
                message: format!(
                    "This video sounds like {name}, but the model {file} only understands English. Its subtitles would be English words, not {name}."
                ),
                details: None,
                language: Some(language),
            })
        }
        _ => Ok(()),
    }
}

fn missing_model(model_path: &Path) -> UserError {
    let file = model_path.file_name().map(|f| f.to_string_lossy().into_owned()).unwrap_or_default();
    UserError::new("model", format!("The speech model {file} is missing. Choose another one under Model."))
        .with_details(format!("no file at {}", model_path.display()))
}

fn run_burn_job<R: Runtime>(
    app: &AppHandle<R>,
    path: &str,
    style_name: &str,
    model: &str,
    output: Option<String>,
    options: &BurnOptions,
) -> Result<String, UserError> {
    let input = PathBuf::from(path);
    let model_path = PathBuf::from(model);
    if !model_path.is_file() {
        return Err(missing_model(&model_path));
    }

    let ffmpeg_bin = resolve_ffmpeg();
    let ffprobe_bin = resolve_ffprobe(&ffmpeg_bin);

    // Only libass: transcription is linked in (subs-whisper), so ffmpeg's
    // `whisper` filter is no longer needed -- and the ffmpeg the macOS app
    // ships has none, so asking for it refused every burn.
    match subs_pipeline::missing_filters(&ffmpeg_bin).map(|m| without_whisper(m)) {
        Ok(missing) if missing.is_empty() => {}
        Ok(missing) => {
            return Err(UserError::new("ffmpeg", "The ffmpeg this app found can't burn subtitles into video.")
                .with_details(missing_message(&ffmpeg_bin, &missing)))
        }
        Err(e) => {
            return Err(UserError::new("ffmpeg", "OpenSubs could not run ffmpeg, which it needs to make the video.")
                .with_details(format!("could not check {}: {e}", ffmpeg_bin.display())))
        }
    }

    let info = probe_media(&ffprobe_bin, &input).map_err(|e| UserError::unreadable(format!("probe of {}: {e}", input.display())))?;
    if !info.has_audio {
        return Err(UserError::no_audio());
    }

    options
        .trim()
        .validate(info.duration)
        .map_err(|e| UserError::new("clip", format!("{e} (the video is {:.2}s long)", info.duration)))?;

    // A template file overrides the named preset, which is how a user's own
    // look reaches the burn.
    let style = match &options.style_file {
        Some(file) => {
            let text = std::fs::read_to_string(file)
                .map_err(|e| UserError::new("style", "The style file could not be read.").with_details(format!("{file}: {e}")))?;
            subs_style::from_json_str(&text)
                .map_err(|e| UserError::new("style", "The style file is not a style OpenSubs understands.").with_details(format!("{file}: {e}")))?
        }
        None => subs_style::preset_by_name(style_name)
            .ok_or_else(|| UserError::new("style", format!("There is no style called {style_name}.")))?,
    };

    // An output the caller named is used as named; otherwise a name no
    // earlier export is using.
    let output_path = output
        .map(PathBuf::from)
        .unwrap_or_else(|| unique_output(&input, |p| p.exists()));
    let work_dir = work_dir_for(&output_path);
    std::fs::create_dir_all(&work_dir)
        .map_err(|e| UserError::failed("The export could not start.", format!("could not create work directory {}: {e}", work_dir.display())))?;

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
pub fn probe(path: String) -> Result<MediaInfoDto, UserError> {
    let input = PathBuf::from(&path);
    let ffmpeg_bin = resolve_ffmpeg();
    let ffprobe_bin = resolve_ffprobe(&ffmpeg_bin);
    let info = probe_media(&ffprobe_bin, &input).map_err(|e| UserError::unreadable(format!("probe of {path}: {e}")))?;
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
    /// `subs_tier::Cost` in kebab-case, for the badge's styling.
    pub cost: String,
    pub cost_label: String,
    pub cost_note: String,
    pub why: String,
}

/// What each feature does and what it costs the user. See `subs-tier`.
#[tauri::command]
pub fn list_features() -> Vec<FeatureDto> {
    subs_tier::catalog()
        .into_iter()
        .map(|f| FeatureDto {
            id: f.id.to_string(),
            title: f.title.to_string(),
            cost: serde_json::to_value(f.cost)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default(),
            cost_label: f.cost.label().to_string(),
            cost_note: f.cost.explanation().to_string(),
            why: f.why.to_string(),
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
pub fn translation_ready(app: AppHandle) -> bool {
    subs_translate::claude::api_key_from_env().is_some() || bundled_translator(&app).is_some()
}

/// The offline translation model the installer ships (M2M-100, MIT), if any.
fn bundled_translator<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?.join("models").join("m2m100");
    dir.join("model.bin").is_file().then_some(dir)
}

/// A shipped preset as template JSON, for a user to save and edit.
#[tauri::command]
pub fn export_style(name: String) -> Result<String, String> {
    subs_style::preset_by_name(&name)
        .map(|t| subs_style::to_json_string(&t))
        .ok_or_else(|| format!("no preset named '{name}'"))
}

/// The filters this app still needs from ffmpeg: all of them but `whisper`.
/// Both checks -- the status shown up front and the one before a burn --
/// go through this, so they cannot disagree again.
fn without_whisper(missing: Vec<&'static str>) -> Vec<&'static str> {
    missing.into_iter().filter(|f| *f != "whisper").collect()
}

/// What is wrong with ffmpeg, in a sentence that says what to do about it.
fn missing_message(ffmpeg_bin: &Path, missing: &[&str]) -> String {
    let what: Vec<String> = subs_pipeline::REQUIRED_FILTERS
        .iter()
        .filter(|(name, _)| missing.contains(name))
        .map(|(name, why)| format!("`{name}`, which {why}"))
        .collect();
    let fix = match subs_pipeline::install_method() {
        Some(m) => format!(" Install one that has them: `{}`.", m.command),
        None => " Install an ffmpeg built with libass (the `ass` filter).".to_string(),
    };
    format!(
        "{} has no {}.{fix}",
        ffmpeg_bin.display(),
        what.join(" and no ")
    )
}

/// The UI's pre-flight check, before a burn is attempted.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FfmpegCheck {
    /// Whether an ffmpeg could be run at all.
    found: bool,
    /// Required filters it lacks: `whisper`, `ass`, or both. Empty and
    /// `found` means it can do the whole job.
    missing: Vec<String>,
    /// How to install one that works here, if there is one command for it.
    install: Option<InstallHint>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallHint {
    label: String,
    command: String,
    note: String,
}

/// Never an error: an ffmpeg that is not there is the commonest answer on
/// Windows, and the banner needs to say what to do about it, not relay
/// "program not found".
#[tauri::command]
pub fn check_ffmpeg() -> FfmpegCheck {
    let install = subs_pipeline::install_method().map(|m| InstallHint {
        label: m.label.into(),
        command: m.command.into(),
        note: m.note.into(),
    });
    match subs_pipeline::missing_filters(&resolve_ffmpeg()) {
        Ok(missing) => FfmpegCheck {
            found: true,
            // Transcription is linked in (subs-whisper), so only the burn's
            // libass is asked of ffmpeg here.
            missing: without_whisper(missing).into_iter().map(String::from).collect(),
            install,
        },
        Err(_) => FfmpegCheck {
            found: false,
            missing: subs_pipeline::REQUIRED_FILTERS
                .iter()
                .map(|(n, _)| n.to_string())
                .filter(|n| n != "whisper")
                .collect(),
            install,
        },
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FfmpegInstallOutputPayload {
    line: String,
}

/// Installs ffmpeg the way `check_ffmpeg`'s `install` says -- Homebrew on
/// macOS, winget on Windows -- emitting each line of its output as a
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
    // A model someone chose wins while it is still there; otherwise the one
    // the installer shipped, so nothing has to be picked or downloaded first.
    let chosen = settings::load(&settings_path(&app)?)
        .model_path
        .filter(|p| Path::new(p).is_file());
    Ok(chosen.or_else(|| bundled_model(&app).map(|p| p.to_string_lossy().into_owned())))
}

#[tauri::command]
pub fn set_model_path(app: AppHandle, path: String) -> Result<(), String> {
    let settings_file = settings_path(&app)?;
    let updated = DesktopSettings {
        model_path: Some(path),
    };
    settings::save(&settings_file, &updated).map_err(|e| e.to_string())
}

/// Listen to the video and price its cloud translation, without exporting.
///
/// The first step of a cloud-translated export (see `cloud`): the lines it
/// returns are what the window sends for translation, and `credits` is the
/// price the gateway will charge for them.
#[tauri::command]
pub async fn transcribe_for_cloud(
    app: AppHandle,
    path: String,
    model: String,
    options: Option<BurnOptions>,
) -> Result<TranscribedDto, UserError> {
    let options = options.unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || transcribe_job(&app, &path, &model, &options))
        .await
        .map_err(|e| UserError::failed("Listening to the video failed.", format!("transcription task panicked: {e}")))?
}

fn transcribe_job(
    app: &AppHandle,
    path: &str,
    model: &str,
    options: &BurnOptions,
) -> Result<TranscribedDto, UserError> {
    let target = options
        .translate_request()
        .ok_or_else(|| UserError::new("clip", "Choose a language to translate into first."))?
        .target;
    let heard = listen_for_lines(bundled_model(app).as_deref(), path, model, options)?;
    // Same language in and out is not a translation, and is not charged
    // for: Chinese into 简体 or 繁體 is a choice of script, made for free.
    if same_language(&heard.language, &target) {
        let chinese = heard.language.to_ascii_lowercase().starts_with("zh");
        return Err(UserError::new(
            "clip",
            if chinese {
                "This video is already in Chinese, so there is nothing to translate. Choose \u{201c}Don't translate\u{201d} and pick 简体 or 繁體 under Chinese subtitles -- that is free."
                    .to_string()
            } else {
                "This video is already in that language, so there is nothing to translate.".to_string()
            },
        ));
    }
    let credits = subs_translate::pricing::quote_cloud_translation(&heard.lines, &target);
    let job_id = app
        .state::<PendingTranscripts>()
        .insert(options.transcript_key(path, model), heard.transcript);
    Ok(TranscribedDto {
        job_id,
        lines: heard.lines,
        language: heard.language,
        credits,
    })
}

/// Whether two language codes are one language ("zh" and "zh-Hans").
fn same_language(a: &str, b: &str) -> bool {
    let base = |c: &str| c.split(['-', '_']).next().unwrap_or(c).to_ascii_lowercase();
    base(a) == base(b)
}

/// A transcript and the subtitle lines an export of it will carry.
pub(crate) struct Heard {
    pub transcript: subs_asr::Transcript,
    pub lines: Vec<String>,
    pub language: String,
}

/// Listen to `path` and work out the cues an export with `options` will
/// burn, without exporting.
pub(crate) fn listen_for_lines(
    judge: Option<&Path>,
    path: &str,
    model: &str,
    options: &BurnOptions,
) -> Result<Heard, UserError> {
    let input = PathBuf::from(path);
    let model_path = PathBuf::from(model);
    if !model_path.is_file() {
        return Err(missing_model(&model_path));
    }
    let ffmpeg_bin = resolve_ffmpeg();
    let info = probe_media(&resolve_ffprobe(&ffmpeg_bin), &input)
        .map_err(|e| UserError::unreadable(format!("probe of {}: {e}", input.display())))?;
    if !info.has_audio {
        return Err(UserError::no_audio());
    }
    options
        .trim()
        .validate(info.duration)
        .map_err(|e| UserError::new("clip", format!("{e} (the video is {:.2}s long)", info.duration)))?;

    let work_dir = asr_work_dir();
    std::fs::create_dir_all(&work_dir)
        .map_err(|e| UserError::failed("Listening to the video failed.", format!("could not create {}: {e}", work_dir.display())))?;
    let wav = work_dir.join("asr.wav");
    let heard = extract_asr_audio(&ffmpeg_bin, &input, &wav, options.trim())
        .map_err(|e| UserError::unreadable(format!("extracting the audio from {}: {e}", input.display())))
        .and_then(|()| check_model_language(judge, &model_path, &wav, options))
        .and_then(|()| {
            WhisperTranscriber::new(model_path.clone())
                .transcribe(&AudioRef::new(&wav), &AsrOptions::default())
                .map_err(|e| UserError::failed("Listening to the video failed.", format!("transcription failed: {e}")))
        });
    let _ = std::fs::remove_dir_all(&work_dir);
    let transcript = heard?;

    // The same planning the export does, with nothing to translate yet, so
    // these lines are exactly the cues the export will ask translations for.
    let style = subs_style::all_presets()
        .first()
        .cloned()
        .ok_or_else(|| UserError::failed("Listening to the video failed.", "no subtitle styles are built in"))?;
    let mut untranslated = options.clone();
    untranslated.translate_to = None;
    let spec = build_job_spec(input.clone(), default_output(&input), style, work_dir, &untranslated);
    let planned = plan_job(&spec, &info, &CachedTranscriber(transcript.clone()), None)
        .map_err(|e| UserError::failed("Listening to the video failed.", format!("planning failed: {e}")))?;
    let lines: Vec<String> = planned.source_cues.iter().map(|c| c.text()).collect();
    if lines.is_empty() {
        return Err(UserError::no_speech());
    }
    Ok(Heard {
        language: transcript.language.clone(),
        transcript,
        lines,
    })
}

/// Close the window that asks. For the sign-in window, which cannot close
/// itself reliably from script: a window made at runtime reports the main
/// window's label to the JS API, so `getCurrentWindow().close()` closed the
/// main window. Tauri resolves this `Window` from the webview that sent the
/// call, which is the one identity it cannot get wrong.
#[tauri::command]
pub fn close_window(window: tauri::Window) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn burn(
    app: AppHandle,
    path: String,
    style: String,
    model: String,
    output: Option<String>,
    options: Option<BurnOptions>,
) -> Result<String, UserError> {
    let options = options.unwrap_or_default();
    // Off the async runtime's own worker threads: ffmpeg/whisper.cpp run for
    // minutes on real video, and this keeps both the webview and any other
    // in-flight command responsive.
    tauri::async_runtime::spawn_blocking(move || {
        run_burn_job(&app, &path, &style, &model, output, &options)
    })
    .await
    .map_err(|e| UserError::failed("The export stopped unexpectedly.", format!("burn task panicked: {e}")))?
}

/// Show the finished file in the system's file manager: selected in Finder
/// and Explorer, its folder opened on Linux.
#[tauri::command]
pub fn reveal(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // Explorer wants the quotes around the path alone, not around the
        // whole `/select,` argument as Rust would put them; and it exits 1
        // even when the window opened, so only a failure to start counts.
        subs_media::command("explorer")
            .raw_arg(format!("/select,\"{path}\""))
            .spawn()
            .map_err(|e| format!("failed to run explorer: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let mut cmd = if cfg!(target_os = "macos") {
            let mut open = subs_media::command("open");
            open.arg("-R").arg(&path);
            open
        } else {
            let dir = Path::new(&path).parent().unwrap_or(Path::new("."));
            let mut open = subs_media::command("xdg-open");
            open.arg(dir);
            open
        };
        let status = cmd
            .status()
            .map_err(|e| format!("failed to show {path}: {e}"))?;
        if !status.success() {
            return Err(format!("showing {path} exited with {status}"));
        }
        Ok(())
    }
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

    // Parsing `ffmpeg -filters` is tested where it lives, in
    // subs-pipeline's ffmpeg_install.

    #[test]
    fn a_missing_filter_is_named_with_what_it_is_for() {
        let m = missing_message(Path::new("ffmpeg"), &["whisper"]);
        assert!(m.contains("`whisper`, which transcribes the audio"), "{m}");
        assert!(!m.contains("`ass`"), "{m}");
    }

    #[test]
    fn the_fix_offered_is_this_platforms_own() {
        // Windows was told to use Homebrew.
        let m = missing_message(Path::new("ffmpeg"), &["whisper", "ass"]);
        if cfg!(windows) {
            assert!(m.contains("winget install --id Gyan.FFmpeg"), "{m}");
        }
        if cfg!(target_os = "macos") {
            assert!(m.contains("brew install ffmpeg-full"), "{m}");
        }
        if !cfg!(target_os = "macos") {
            assert!(!m.contains("brew"), "{m}");
        }
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
    fn the_text_file_options_arrive_by_their_front_end_names() {
        let options: BurnOptions =
            serde_json::from_str(r#"{"writeSrt":true,"writeTxt":true}"#).unwrap();
        assert!(options.write_srt && options.write_txt && !options.write_vtt);
        assert!(!BurnOptions::default().write_txt);
    }

    /// Real speech, real model: the lines priced for cloud translation are
    /// exactly the cues the export then asks translations for, so the paid
    /// translations land one-to-one. Needs ffmpeg on PATH, a whisper model
    /// and a video with speech:
    ///   OPENSUBS_TEST_VIDEO=… OPENSUBS_TEST_MODEL=… cargo test -- --ignored priced_lines
    #[test]
    #[ignore]
    fn priced_lines_are_the_cues_the_export_translates() {
        let (Ok(video), Ok(model)) = (
            std::env::var("OPENSUBS_TEST_VIDEO"),
            std::env::var("OPENSUBS_TEST_MODEL"),
        ) else {
            panic!("set OPENSUBS_TEST_VIDEO and OPENSUBS_TEST_MODEL");
        };
        let options = BurnOptions {
            translate_to: Some("zh-Hans".into()),
            ..BurnOptions::default()
        };
        let heard = listen_for_lines(None, &video, &model, &options).unwrap();
        assert!(!heard.lines.is_empty());
        let paid: Vec<String> = heard.lines.iter().map(|l| format!("T:{l}")).collect();

        let input = PathBuf::from(&video);
        let info = probe_media(&resolve_ffprobe(&resolve_ffmpeg()), &input).unwrap();
        let spec = spec_with(&options);
        let preset = PresetTranslator::new(paid.clone());
        let planned = plan_job(&spec, &info, &CachedTranscriber(heard.transcript), Some(&preset)).unwrap();
        assert_eq!(preset.remaining(), 0, "translations left over");
        // Each cue carries its own translation. Compared without whitespace,
        // because a translation is re-wrapped for its script on the way in.
        let squash = |t: &str| t.split_whitespace().collect::<String>();
        let burned: Vec<String> = planned.cues.iter().map(|c| squash(&c.text())).collect();
        let expected: Vec<String> = paid.iter().map(|p| squash(p)).collect();
        assert_eq!(burned, expected);
    }

    /// Real Mandarin, the real Whisper model and the offline translator the
    /// installer carries: untranslated in each script, and "translated" into
    /// 简体 and 繁體, three times each, always in the script asked for.
    ///   OPENSUBS_TEST_ZH=<video> OPENSUBS_TEST_MODEL=<ggml-base.bin> \
    ///     cargo test -p opensubs-desktop -- --ignored chinese_comes_out
    #[test]
    #[ignore]
    fn chinese_comes_out_in_the_script_asked_for_on_real_speech() {
        let (Ok(video), Ok(model)) = (std::env::var("OPENSUBS_TEST_ZH"), std::env::var("OPENSUBS_TEST_MODEL")) else {
            panic!("set OPENSUBS_TEST_ZH and OPENSUBS_TEST_MODEL");
        };
        let m2m = Path::new(env!("CARGO_MANIFEST_DIR")).join("bundled/models/m2m100");
        let translator = subs_m2m::M2mTranslator::new(&m2m).expect("the bundled M2M-100");
        let input = PathBuf::from(&video);
        let ffmpeg = resolve_ffmpeg();
        let info = probe_media(&resolve_ffprobe(&ffmpeg), &input).unwrap();
        let work = std::env::temp_dir().join(format!("opensubs-zh-test-{}", std::process::id()));
        std::fs::create_dir_all(&work).unwrap();
        extract_asr_audio(&ffmpeg, &input, &work.join("asr.wav"), TrimRange::FULL).unwrap();
        let cases: [(Option<&str>, Option<&str>, ChineseScript); 4] = [
            (None, Some("simplified"), ChineseScript::Simplified),
            (None, Some("traditional"), ChineseScript::Traditional),
            (Some("zh-Hans"), Some("traditional"), ChineseScript::Simplified),
            (Some("zh-Hant"), Some("simplified"), ChineseScript::Traditional),
        ];
        for (translate_to, setting, want) in cases {
            let mut first_lines = Vec::new();
            for run in 0..3 {
                let options = BurnOptions {
                    translate_to: translate_to.map(str::to_string),
                    chinese_script: setting.map(str::to_string),
                    ..BurnOptions::default()
                };
                let spec = build_job_spec(input.clone(), work.join("out.mp4"), subs_style::preset_by_name("CJK").unwrap(), work.clone(), &options);
                let t: Option<&dyn Translator> = translate_to.map(|_| &translator as &dyn Translator);
                let planned = plan_job(&spec, &info, &WhisperTranscriber::new(&model), t).unwrap();
                let text: String = planned.cues.iter().map(|c| c.lines.concat()).collect();
                assert!(text.chars().filter(|c| ('\u{4e00}'..='\u{9fff}').contains(c)).count() > 50, "{text}");
                // Simplified conversion is idempotent; Traditional (s2twp)
                // also rewrites vocabulary, so it is checked a character at a
                // time: nothing in the text is a Simplified-only form.
                let other: Vec<char> = text
                    .chars()
                    .filter(|c| want.apply(&c.to_string()) != c.to_string())
                    .collect();
                assert!(other.is_empty(), "run {run}, {translate_to:?}/{setting:?}: not all {want:?}: {other:?} in {text}");
                first_lines.push(planned.cues[0].lines.concat());
            }
            eprintln!("{translate_to:?} {setting:?} -> {want:?}: {:?}", first_lines);
        }
        let _ = std::fs::remove_dir_all(&work);
    }

    /// Real files the probe cannot use, through the real ffprobe: each one
    /// gets a sentence with no path in it, and details without the user's
    /// name. Prints what the window would be sent.
    ///   OPENSUBS_TEST_MEDIA=<dir with no_audio.mp4, fake.mp4, truncated.mp4> \
    ///     cargo test -p opensubs-desktop -- --ignored real_files --nocapture
    #[test]
    #[ignore]
    fn real_files_get_plain_messages() {
        let dir = PathBuf::from(std::env::var("OPENSUBS_TEST_MEDIA").expect("set OPENSUBS_TEST_MEDIA"));
        let silent = probe(dir.join("no_audio.mp4").to_string_lossy().into_owned()).expect("a real video");
        assert!(!silent.has_audio);
        for name in ["fake.mp4", "truncated.mp4"] {
            let e = probe(dir.join(name).to_string_lossy().into_owned()).unwrap_err();
            let json = serde_json::to_string_pretty(&e).unwrap();
            eprintln!("{name}: {json}");
            assert_eq!(e.kind, "unreadable");
            assert!(!e.message.contains('/') && !e.message.contains('\\'));
            let home = dirs::home_dir().unwrap();
            let user = home.file_name().unwrap().to_string_lossy().into_owned();
            assert!(!e.details.as_deref().unwrap_or("").contains(&user), "{json}");
        }
    }

    /// The burn command itself, on real files, through real ffmpeg and
    /// Whisper, in a mock Tauri runtime:
    ///   - a video with no sound stops with `noAudio` before anything runs;
    ///   - silence, room tone and two sine tones stop with `noSpeech`, and
    ///     write nothing;
    ///   - exporting the same video twice, and four containers with one
    ///     name, each get a file of their own, with only the sidecars asked
    ///     for beside it.
    ///   OPENSUBS_TEST_MEDIA=<dir> OPENSUBS_TEST_MODEL=<ggml-base.bin> \
    ///     cargo test --release -p opensubs-desktop -- --ignored burn_command --nocapture
    #[test]
    #[ignore]
    fn burn_command_on_real_files() {
        let media = PathBuf::from(std::env::var("OPENSUBS_TEST_MEDIA").expect("set OPENSUBS_TEST_MEDIA"));
        let model = std::env::var("OPENSUBS_TEST_MODEL").expect("set OPENSUBS_TEST_MODEL");
        let app = tauri::test::mock_builder()
            .manage(PendingTranscripts::default())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let app = app.handle().clone();
        let work = std::env::temp_dir().join(format!("opensubs-burn-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&work);
        std::fs::create_dir_all(&work).unwrap();
        let copy = |name: &str, to: &str| {
            let dest = work.join(to);
            std::fs::copy(media.join(name), &dest).unwrap();
            dest.to_string_lossy().into_owned()
        };
        let quick = |srt: bool, vtt: bool| BurnOptions { height: Some(360), write_srt: srt, write_vtt: vtt, ..BurnOptions::default() };

        let e = run_burn_job(&app, &copy("no_audio.mp4", "no_audio.mp4"), "Clean", &model, None, &quick(false, false)).unwrap_err();
        eprintln!("no_audio.mp4 -> {}", serde_json::to_string(&e).unwrap());
        assert_eq!(e.kind, "noAudio");

        for clip in ["silence20.mp4", "pink40.mp4", "tones30.mp4"] {
            let e = run_burn_job(&app, &copy(clip, clip), "Clean", &model, None, &quick(true, false)).unwrap_err();
            eprintln!("{clip} -> {}", serde_json::to_string(&e).unwrap());
            assert_eq!(e.kind, "noSpeech", "{clip}");
            let stem = clip.trim_end_matches(".mp4");
            for leftover in [format!("{stem}.subbed.mp4"), format!("{stem}.subbed.part.mp4"), format!("{stem}.subbed.srt")] {
                assert!(!work.join(&leftover).exists(), "{leftover} was written");
            }
        }

        let a = copy("samename/a.mp4", "a.mp4");
        let first = run_burn_job(&app, &a, "Clean", &model, None, &quick(true, true)).unwrap();
        let second = run_burn_job(&app, &a, "Shorts", &model, None, &quick(true, false)).unwrap();
        let mut written = vec![first.clone(), second.clone()];
        for ext in ["mov", "mkv", "webm"] {
            let src = copy(&format!("samename/a.{ext}"), &format!("a.{ext}"));
            written.push(run_burn_job(&app, &src, "Clean", &model, None, &quick(false, false)).unwrap());
        }
        let names: Vec<String> = written.iter().map(|p| Path::new(p).file_name().unwrap().to_string_lossy().into_owned()).collect();
        eprintln!("exports: {names:?}");
        assert_eq!(names, ["a.subbed.mp4", "a.subbed (1).mp4", "a.subbed (2).mp4", "a.subbed (3).mp4", "a.subbed (4).mp4"]);
        assert!(work.join("a.subbed.srt").exists() && work.join("a.subbed.vtt").exists());
        assert!(work.join("a.subbed (1).srt").exists() && !work.join("a.subbed (1).vtt").exists());
        // The first export is still the first export.
        let srt = std::fs::read_to_string(work.join("a.subbed.srt")).unwrap();
        assert!(srt.starts_with("1\n00:00:09") || srt.starts_with("1\n00:00:10"), "the first cue starts at the voice: {srt}");
        let _ = std::fs::remove_dir_all(&work);
    }

    /// An English-only model on real Mandarin is stopped, with the language
    /// named; on real English it is not; with the person's go-ahead it is
    /// not. The judge is the multilingual model the installer carries.
    ///   OPENSUBS_TEST_MEDIA=<dir> OPENSUBS_TEST_MODEL=<ggml-base.bin> OPENSUBS_TEST_EN_MODEL=<ggml-tiny.en.bin> \
    ///     cargo test --release -p opensubs-desktop -- --ignored english_only --nocapture
    #[test]
    #[ignore]
    fn english_only_model_on_real_speech() {
        let media = PathBuf::from(std::env::var("OPENSUBS_TEST_MEDIA").expect("set OPENSUBS_TEST_MEDIA"));
        let judge = PathBuf::from(std::env::var("OPENSUBS_TEST_MODEL").expect("set OPENSUBS_TEST_MODEL"));
        let english = PathBuf::from(std::env::var("OPENSUBS_TEST_EN_MODEL").expect("set OPENSUBS_TEST_EN_MODEL"));
        let ffmpeg = resolve_ffmpeg();
        let work = std::env::temp_dir().join(format!("opensubs-en-test-{}", std::process::id()));
        std::fs::create_dir_all(&work).unwrap();
        let wav = |clip: &str| {
            let out = work.join(format!("{clip}.wav"));
            extract_asr_audio(&ffmpeg, &media.join(clip), &out, TrimRange::FULL).unwrap();
            out
        };
        let (zh, en) = (wav("zh_b.mp4"), wav("sil10_en.mp4"));
        let e = check_model_language(Some(&judge), &english, &zh, &BurnOptions::default()).unwrap_err();
        eprintln!("zh_b.mp4 with tiny.en -> {}", serde_json::to_string(&e).unwrap());
        assert_eq!((e.kind, e.language.as_deref()), ("englishOnlyModel", Some("zh")));
        assert!(e.message.contains("Chinese") && e.message.contains("ggml-tiny.en.bin"), "{}", e.message);
        assert!(check_model_language(Some(&judge), &english, &en, &BurnOptions::default()).is_ok());
        let go_ahead = BurnOptions { allow_english_only: true, ..BurnOptions::default() };
        assert!(check_model_language(Some(&judge), &english, &zh, &go_ahead).is_ok());
        // A multilingual model is never stopped.
        assert!(check_model_language(Some(&judge), &judge, &zh, &BurnOptions::default()).is_ok());
        let _ = std::fs::remove_dir_all(&work);
    }

    #[test]
    fn paid_translations_arrive_with_the_job_they_were_priced_for() {
        let options: BurnOptions = serde_json::from_str(
            r#"{"translateTo":"zh-Hans","cloud":{"jobId":"job-1","translations":["你好"]}}"#,
        )
        .unwrap();
        let cloud = options.cloud.unwrap();
        assert_eq!(cloud.job_id, "job-1");
        assert_eq!(cloud.translations, ["你好"]);
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
            write_txt: true,
            cloud: None,
            chinese_script: Some("traditional".into()),
            allow_english_only: false,
        };
        let spec = spec_with(&options);
        assert_eq!(spec.trim, TrimRange::new(3.0, Some(9.0)));
        assert_eq!(spec.size, OutputSize::Height(1080));
        assert_eq!(spec.translate, Some(TranslateRequest::to("ja")));
        assert_eq!(spec.chinese_script, Some(ChineseScript::Traditional));
    }

    #[test]
    fn chinese_into_chinese_is_the_same_language() {
        assert!(same_language("zh", "zh-Hans"));
        assert!(same_language("zh", "zh-Hant"));
        assert!(!same_language("en", "zh-Hans"));
    }

    #[test]
    fn the_new_options_arrive_by_their_front_end_names() {
        let options: BurnOptions =
            serde_json::from_str(r#"{"chineseScript":"simplified","allowEnglishOnly":true}"#).unwrap();
        assert_eq!(options.chinese_script(), Some(ChineseScript::Simplified));
        assert!(options.allow_english_only);
        assert_eq!(BurnOptions::default().chinese_script(), None);
    }

    /// Exporting twice, and four containers with one name, each get a file
    /// of their own.
    #[test]
    fn an_export_never_takes_a_name_already_used() {
        use std::collections::HashSet;
        let mut on_disk: HashSet<PathBuf> = HashSet::new();
        let dir = Path::new("/videos");
        let mut written = Vec::new();
        for source in ["a.mp4", "a.mp4", "a.mov", "a.mkv", "a.webm"] {
            let out = unique_output(&dir.join(source), |p| on_disk.contains(p));
            assert!(on_disk.insert(out.clone()), "{} written twice", out.display());
            written.push(out.file_name().unwrap().to_string_lossy().into_owned());
        }
        assert_eq!(
            written,
            ["a.subbed.mp4", "a.subbed (1).mp4", "a.subbed (2).mp4", "a.subbed (3).mp4", "a.subbed (4).mp4"]
        );
    }

    /// A name whose old subtitles are still there is taken too, so the
    /// new video never sits beside last time's .vtt under one name.
    #[test]
    fn a_name_with_old_subtitles_beside_it_is_taken() {
        let leftover = PathBuf::from("/videos/a.subbed.vtt");
        let out = unique_output(Path::new("/videos/a.mp4"), |p| p == leftover);
        assert_eq!(out, PathBuf::from("/videos/a.subbed (1).mp4"));
        // And the sidecars follow the video's own name.
        assert_eq!(out.with_extension("srt"), PathBuf::from("/videos/a.subbed (1).srt"));
        assert_eq!(partial_path(&out), PathBuf::from("/videos/a.subbed (1).part.mp4"));
    }

    #[test]
    fn details_never_name_the_user() {
        let home = Path::new(r"C:\Users\someone");
        let raw = r"probe of C:\Users\someone\Videos\no_audio.mp4: C:\Program Files\OpenSubs\vendor\ffprobe.exe exited with exit code: 1: [mov,mp4] moov atom not found";
        let out = redact(raw, Some(home));
        assert!(!out.contains("someone"), "{out}");
        assert!(out.contains(r"~\Videos\no_audio.mp4"), "{out}");
        assert!(out.contains("moov atom not found"));
        // Another account's path, and the macOS form.
        assert_eq!(redact("/Users/someone/Movies/x.mov", None), "/Users/…/Movies/x.mov");
        assert_eq!(redact("/Users/me/Movies/x.mov", Some(Path::new("/Users/me"))), "~/Movies/x.mov");
    }

    #[test]
    fn a_failure_reaches_the_window_as_a_sentence_and_details() {
        let e = UserError::unreadable("probe of /Users/someone/a.mp4: moov atom not found");
        let json = serde_json::to_value(&e).unwrap();
        assert_eq!(json["kind"], "unreadable");
        assert!(!json["message"].as_str().unwrap().contains('/'));
        assert!(json["details"].as_str().unwrap().contains("moov atom not found"));
        assert!(!json["details"].as_str().unwrap().contains("someone"));
        assert_eq!(serde_json::to_value(UserError::no_audio()).unwrap()["kind"], "noAudio");
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
    fn the_feature_list_reaches_the_ui_with_its_costs() {
        let features = list_features();
        assert_eq!(features.len(), subs_tier::catalog().len());
        // Everything local is free; only translation offers a paid route.
        let paid: Vec<&str> = features
            .iter()
            .filter(|f| f.cost != "free")
            .map(|f| f.id.as_str())
            .collect();
        assert_eq!(paid, ["translation"]);
        let t = features.iter().find(|f| f.id == "translation").unwrap();
        assert_eq!(t.cost, "free-or-credits");
        assert!(!t.cost_label.is_empty() && !t.cost_note.is_empty());
    }

    #[test]
    fn a_preset_exports_as_a_template_the_style_loader_accepts() {
        let json = export_style("Neon".into()).unwrap();
        let back = subs_style::from_json_str(&json).unwrap();
        assert_eq!(back.name, "Neon");
        assert!(export_style("nope".into()).is_err());
    }

    /// The ffmpeg the installers ship (fetch-bundled.sh) has libass and no
    /// `whisper` filter. A burn with it must not be refused -- it was, by a
    /// pre-burn check that still asked for `whisper`.
    #[test]
    fn the_bundled_ffmpeg_is_enough_to_burn() {
        let name = if cfg!(windows) { "ffmpeg.exe" } else { "ffmpeg" };
        let bin = Path::new(env!("CARGO_MANIFEST_DIR")).join("bundled/vendor").join(name);
        if !bin.is_file() {
            eprintln!("skipped: run apps/desktop/scripts/fetch-bundled.sh first");
            return;
        }
        let missing = subs_pipeline::missing_filters(&bin).expect("runs");
        assert!(missing.contains(&"whisper"), "this test assumes a build without whisper");
        assert!(without_whisper(missing).is_empty());
    }

}
