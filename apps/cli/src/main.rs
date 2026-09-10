//! `opensubs` — the end-user CLI: point it at a video, get subtitles
//! burned in. Thin glue over the already-tested `subs-*` crates; the only
//! logic that lives here is argument parsing (`cli.rs`), process
//! orchestration and progress rendering.

mod cli;

use cli::{AsrChoice, BurnArgs, Command, ProbeArgs, StyleSource, StylesArgs, UsageError};
use std::io::{BufRead, BufReader, IsTerminal, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command as Process, Stdio};
use std::time::Instant;
use subs_asr::{FfmpegWhisperTranscriber, MockTranscriber, Transcriber};
use subs_media::{probe_args, MediaInfo, VideoEncoder};
use subs_pipeline::{plan_job, write_ass, JobSpec, ProgressParser};
use subs_style::StyleTemplate;
use subs_subtitle::{to_srt, to_vtt};
use subs_translate::{ClaudeTranslator, TranslateRequest, Translator};

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let command = match cli::parse_args(&args) {
        Ok(c) => c,
        Err(e) => exit_usage(&e),
    };

    let code = match command {
        Command::Version => {
            println!("opensubs {}", env!("CARGO_PKG_VERSION"));
            0
        }
        Command::Styles(a) => cmd_styles(&a),
        Command::Languages => {
            cmd_languages();
            0
        }
        Command::Features => {
            cmd_features();
            0
        }
        Command::Probe(p) => cmd_probe(&p),
        Command::Burn(b) => cmd_burn(&b),
    };
    std::process::exit(code);
}

fn exit_usage(e: &UsageError) -> ! {
    eprintln!("{}", cli::USAGE);
    if let Some(msg) = &e.0 {
        eprintln!("\nerror: {msg}");
    }
    std::process::exit(2);
}

fn cmd_styles(a: &StylesArgs) -> i32 {
    if let Some(name) = &a.export {
        return match subs_style::preset_by_name(name) {
            Some(t) => {
                println!("{}", subs_style::to_json_string(&t));
                0
            }
            None => {
                eprintln!("opensubs: no preset named '{name}'");
                1
            }
        };
    }

    for (pack, list) in [
        (subs_style::Pack::Core, subs_style::presets()),
        (subs_style::Pack::Advanced, subs_style::advanced_presets()),
    ] {
        println!("{} pack:", pack.label());
        for s in list {
            println!(
                "  {:<10} font={:<20} size={:>4.1}% align={}",
                s.name, s.font, s.size_pct, s.alignment
            );
        }
    }
    println!(
        "\nEvery preset is unlocked. `--export <NAME>` prints one as JSON to edit \n\
         and load back with `--style-file`."
    );
    0
}

/// Resolve a shipped preset name, or read and validate a template file.
fn load_style(source: &StyleSource) -> Result<StyleTemplate, String> {
    match source {
        // Unreachable in practice -- the parser validates names against the
        // same list -- but a real error beats an unwrap if that ever drifts.
        StyleSource::Preset(name) => {
            subs_style::preset_by_name(name).ok_or_else(|| format!("unknown style '{name}'"))
        }
        StyleSource::File(path) => {
            let text = std::fs::read_to_string(path)
                .map_err(|e| format!("reading style file {}: {e}", path.display()))?;
            subs_style::from_json_str(&text).map_err(|e| format!("{}: {e}", path.display()))
        }
    }
}

fn cmd_languages() {
    println!("Translation targets for --translate-to:\n");
    for l in subs_translate::languages() {
        println!("  {:<8} {:<22} {}", l.code, l.name, l.endonym);
    }
    println!(
        "\nAny other language code is passed through as well. Translation calls the\n\
         Claude API with your own ANTHROPIC_API_KEY, at your own cost."
    );
}

fn cmd_features() {
    for line in subs_tier::summary_lines() {
        println!("{line}");
    }
    if subs_tier::PREMIUM_UNLOCKED {
        println!("\nPremium features are unlocked in this build. Nothing is gated, there is\nno account, and no export is watermarked or length-limited.");
    }
}

fn media_info_to_json(info: &MediaInfo) -> serde_json::Value {
    let (display_width, display_height) = info.display_dimensions();
    serde_json::json!({
        "width": info.width,
        "height": info.height,
        "display_width": display_width,
        "display_height": display_height,
        "fps": { "num": info.fps.num, "den": info.fps.den, "value": info.fps.as_f64() },
        "duration": info.duration,
        "pix_fmt": info.pix_fmt,
        "video_codec": info.video_codec,
        "color": {
            "space": info.color.space,
            "primaries": info.color.primaries,
            "transfer": info.color.transfer,
            "range": info.color.range,
            "is_hdr": info.color.is_hdr(),
        },
        "rotation": info.rotation,
        "has_audio": info.has_audio,
        "audio_codec": info.audio_codec,
        "start_time": info.start_time,
    })
}

fn cmd_probe(p: &ProbeArgs) -> i32 {
    let ffprobe = resolve_ffprobe(&resolve_ffmpeg(None));
    match probe_media(&ffprobe, &p.input) {
        Ok(info) => {
            let json = media_info_to_json(&info);
            println!("{}", serde_json::to_string_pretty(&json).unwrap());
            0
        }
        Err(e) => {
            eprintln!("opensubs: probe of {}: {e}", p.input.display());
            1
        }
    }
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

/// Resolve the ffmpeg binary: an explicit `--ffmpeg` wins; otherwise fall
/// back to `subs_pipeline::ffmpeg_binary`, which prefers a bundled sidecar
/// next to the running executable and falls back to searching `PATH`. No
/// sidecar is bundled yet, so in practice this always searches `PATH`.
fn resolve_ffmpeg(explicit: Option<&Path>) -> PathBuf {
    if let Some(p) = explicit {
        return p.to_path_buf();
    }
    let vendor_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.join("vendor")))
        .unwrap_or_else(|| PathBuf::from("vendor"));
    subs_pipeline::ffmpeg_binary(&vendor_dir)
}

/// `ffprobe` is assumed to be a sibling of the resolved `ffmpeg` binary
/// (true for every real ffmpeg distribution, including Homebrew). Falls
/// back to searching `PATH` when `ffmpeg` itself was resolved from `PATH`
/// (a bare, parent-less name).
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

/// True when `ffmpeg -filters` lists the `ass` filter, i.e. this build has
/// libass and can burn subtitles at all. The plain Homebrew `ffmpeg`
/// formula lacks it, which otherwise surfaces many stages later as an
/// opaque "No such filter: 'ass'" from deep inside the burn.
fn has_ass_filter(ffmpeg_bin: &Path) -> Result<bool, String> {
    let out = Process::new(ffmpeg_bin)
        .arg("-filters")
        .output()
        .map_err(|e| format!("failed to run {} -filters: {e}", ffmpeg_bin.display()))?;
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .any(|l| l.split_whitespace().nth(1) == Some("ass")))
}

fn encoder_for(fast: bool) -> VideoEncoder {
    if !fast {
        return VideoEncoder::X264;
    }
    if cfg!(target_os = "macos") {
        VideoEncoder::VideoToolbox
    } else if cfg!(target_os = "windows") {
        VideoEncoder::Nvenc
    } else {
        VideoEncoder::Qsv
    }
}

fn work_dir_for(output: &Path) -> PathBuf {
    let tag = output.file_stem().and_then(|s| s.to_str()).unwrap_or("job");
    std::env::temp_dir().join(format!("opensubs-work-{}-{tag}", std::process::id()))
}

/// Checks `ffmpeg_bin` (resolved from `explicit`, or auto-detected when
/// `None`) for libass, and offers an interactive `brew install ffmpeg-full`
/// when it's missing entirely or lacks the filter -- but only when stdin is
/// a real terminal (never prompts a script/pipe, see `IsTerminal`) and no
/// `--ffmpeg` override was given (installing ffmpeg-full via Homebrew can't
/// fix a specific pinned path the user chose themselves). Returns the
/// ffmpeg binary to actually use, or the process exit code to return.
fn ensure_ffmpeg_ready(explicit: Option<&Path>) -> Result<PathBuf, i32> {
    let ffmpeg_bin = resolve_ffmpeg(explicit);
    match has_ass_filter(&ffmpeg_bin) {
        Ok(true) => return Ok(ffmpeg_bin),
        Ok(false) => eprintln!(
            "opensubs: {} has no libass (the `ass` filter is not registered in its \
             `-filters` output) and cannot burn subtitles.",
            ffmpeg_bin.display()
        ),
        Err(e) => eprintln!(
            "opensubs: could not check {} for libass: {e}",
            ffmpeg_bin.display()
        ),
    }

    if explicit.is_none() && std::io::stdin().is_terminal() {
        eprint!("Install ffmpeg-full via Homebrew now? [y/N] ");
        let _ = std::io::stderr().flush();
        let mut answer = String::new();
        let agreed = std::io::stdin().read_line(&mut answer).is_ok()
            && matches!(answer.trim().to_lowercase().as_str(), "y" | "yes");

        if agreed {
            eprintln!("Running `brew install ffmpeg-full`\u{2026} this can take several minutes.");
            match subs_pipeline::install_ffmpeg_full(|line| eprintln!("  {line}")) {
                Ok(()) => {
                    // Re-resolve rather than reusing the earlier `ffmpeg_bin`:
                    // if nothing was found before, that was a bare "ffmpeg"
                    // fallback name, not the freshly-installed binary's path.
                    let ffmpeg_bin = resolve_ffmpeg(None);
                    return match has_ass_filter(&ffmpeg_bin) {
                        Ok(true) => {
                            eprintln!("opensubs: ffmpeg-full installed, libass confirmed.");
                            Ok(ffmpeg_bin)
                        }
                        Ok(false) => {
                            eprintln!(
                                "opensubs: installed, but {} still has no libass.",
                                ffmpeg_bin.display()
                            );
                            Err(1)
                        }
                        Err(e) => {
                            eprintln!(
                                "opensubs: could not re-check {} for libass: {e}",
                                ffmpeg_bin.display()
                            );
                            Err(1)
                        }
                    };
                }
                Err(e) => {
                    eprintln!("opensubs: install failed: {e}");
                    return Err(1);
                }
            }
        }
    }

    eprintln!(
        "opensubs: install an ffmpeg build with --enable-libass yourself (e.g. Homebrew's \
         `brew install ffmpeg-full`) or pass --ffmpeg <path> to one."
    );
    Err(1)
}

fn cmd_burn(b: &BurnArgs) -> i32 {
    let start = Instant::now();

    let ffmpeg_bin = match ensure_ffmpeg_ready(b.ffmpeg.as_deref()) {
        Ok(bin) => bin,
        Err(code) => return code,
    };
    let ffprobe_bin = resolve_ffprobe(&ffmpeg_bin);

    let info = match probe_media(&ffprobe_bin, &b.input) {
        Ok(i) => i,
        Err(e) => {
            eprintln!("opensubs: probe of {}: {e}", b.input.display());
            return 1;
        }
    };

    if let Err(e) = b.trim.validate(info.duration) {
        eprintln!("opensubs: {e} (the video is {:.2}s long)", info.duration);
        return 1;
    }

    // Built before anything expensive runs: a missing API key must be
    // reported now, not after a full transcription has been paid for.
    let translator: Option<Box<dyn Translator>> = if b.translate_to.is_some() {
        match ClaudeTranslator::from_env() {
            Ok(t) => Some(Box::new(t)),
            Err(e) => {
                eprintln!("opensubs: {e}");
                return 1;
            }
        }
    } else {
        None
    };

    let work_dir = work_dir_for(&b.output);
    if let Err(e) = std::fs::create_dir_all(&work_dir) {
        eprintln!(
            "opensubs: could not create work directory {}: {e}",
            work_dir.display()
        );
        return 1;
    }

    let wav_path = work_dir.join("asr.wav");
    if let Err(e) = extract_asr_audio(&ffmpeg_bin, &b.input, &wav_path, b.trim) {
        eprintln!(
            "opensubs: extracting ASR audio from {}: {e}",
            b.input.display()
        );
        cleanup(&work_dir, b.keep_work);
        return 1;
    }

    let transcriber: Box<dyn Transcriber> = match &b.asr {
        AsrChoice::Mock(path) => match MockTranscriber::from_file(path) {
            Ok(t) => Box::new(t),
            Err(e) => {
                eprintln!("opensubs: loading mock transcript {}: {e}", path.display());
                cleanup(&work_dir, b.keep_work);
                return 1;
            }
        },
        AsrChoice::Model(path) => {
            let mut t = FfmpegWhisperTranscriber::new(ffmpeg_bin.clone(), path.clone());
            if let Some(lang) = &b.language {
                t = t.with_language(lang.clone());
            }
            Box::new(t)
        }
    };

    // plan_job builds its own AudioRef at `<work_dir>/asr.wav`, matching
    // `wav_path` above exactly, so nothing further needs to reference it
    // here.

    let style = match load_style(&b.style) {
        Ok(s) => s,
        Err(e) => {
            eprintln!("opensubs: {e}");
            cleanup(&work_dir, b.keep_work);
            return 1;
        }
    };

    let spec = JobSpec {
        input: b.input.clone(),
        output: b.output.clone(),
        style,
        work_dir: work_dir.clone(),
        fonts_dir: work_dir.clone(),
        encoder: encoder_for(b.fast),
        crf: b.crf,
        preset: b.preset.clone(),
        tonemap: b.tonemap,
        // libplacebo is Vulkan-only; macOS has no Vulkan driver and would
        // hard-fail every burn. Never opt into it from the CLI.
        prefer_gpu_tonemap: false,
        trim: b.trim,
        size: b.size,
        translate: b.translate_to.as_ref().map(|target| match &b.language {
            Some(src) => TranslateRequest::to(target).from_language(src),
            None => TranslateRequest::to(target),
        }),
    };

    let planned = match plan_job(&spec, &info, transcriber.as_ref(), translator.as_deref()) {
        Ok(p) => p,
        Err(e) => {
            eprintln!("opensubs: transcription/planning failed: {e}");
            cleanup(&work_dir, b.keep_work);
            return 1;
        }
    };

    if let Err(e) = write_ass(&planned) {
        eprintln!("opensubs: writing {}: {e}", planned.ass_path.display());
        cleanup(&work_dir, b.keep_work);
        return 1;
    }

    let show_progress = !b.quiet && std::io::stdout().is_terminal();
    if let Err(e) = run_burn(
        &ffmpeg_bin,
        &planned.burn_argv,
        planned.clip_duration,
        show_progress,
    ) {
        eprintln!("opensubs: burning {}: {e}", b.output.display());
        cleanup(&work_dir, b.keep_work);
        return 1;
    }

    if let Some(srt_path) = &b.srt {
        if let Err(e) = std::fs::write(srt_path, to_srt(&planned.cues)) {
            eprintln!("opensubs: writing {}: {e}", srt_path.display());
            cleanup(&work_dir, b.keep_work);
            return 1;
        }
    }
    if let Some(vtt_path) = &b.vtt {
        if let Err(e) = std::fs::write(vtt_path, to_vtt(&planned.cues)) {
            eprintln!("opensubs: writing {}: {e}", vtt_path.display());
            cleanup(&work_dir, b.keep_work);
            return 1;
        }
    }
    // The spoken-language sidecar, when the burned subtitles are a
    // translation. `source_cues` is what the ASR actually heard.
    if let Some(path) = &b.source_srt {
        if let Err(e) = std::fs::write(path, to_srt(&planned.source_cues)) {
            eprintln!("opensubs: writing {}: {e}", path.display());
            cleanup(&work_dir, b.keep_work);
            return 1;
        }
    }

    cleanup(&work_dir, b.keep_work);

    println!(
        "opensubs: wrote {} in {:.1}s",
        b.output.display(),
        start.elapsed().as_secs_f64()
    );
    0
}

fn cleanup(work_dir: &Path, keep_work: bool) {
    if keep_work {
        return;
    }
    let _ = std::fs::remove_dir_all(work_dir);
}

/// Extract the ASR-only WAV and sanity-check that it is not empty. Nothing
/// in the codebase spawned `extract_audio_args`' argv before this CLI, so
/// this is its first real run: a WAV header alone is 44 bytes, so anything
/// at or under that means ffmpeg produced no audio.
fn extract_asr_audio(
    ffmpeg_bin: &Path,
    input: &Path,
    out_wav: &Path,
    trim: subs_media::TrimRange,
) -> Result<(), String> {
    // Same trim the burn will use, so the transcript's clock and the
    // exported clip's clock are the same clock.
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

/// Spawn the burn, streaming `-progress pipe:1` into a single-line
/// indicator, and return an error carrying stderr on failure.
fn run_burn(
    ffmpeg_bin: &Path,
    argv: &[String],
    total_duration: f64,
    show_progress: bool,
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
    let stderr_thread = std::thread::spawn(move || {
        let mut buf = String::new();
        let _ = BufReader::new(stderr).read_to_string(&mut buf);
        buf
    });

    let stdout = child.stdout.take().expect("stdout was piped");
    let mut parser = ProgressParser::new();
    for line in BufReader::new(stdout).lines() {
        let Ok(line) = line else { break };
        if let Some(event) = parser.feed_line(&line) {
            if show_progress {
                let pct = event.percent_of(total_duration);
                print!("\r\x1b[K  burning: {pct:5.1}%");
                let _ = std::io::stdout().flush();
            }
        }
    }
    if show_progress {
        println!();
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
