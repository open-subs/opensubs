//! The one test in this crate that runs real ffmpeg + a real whisper.cpp
//! model against real audio. Skips cleanly when ffmpeg, the whisper filter,
//! the model or the fixture are missing, so the fast suite stays runnable
//! everywhere.
//!
//! Set `SUBS_REQUIRE_FFMPEG=1` to turn every skip into a hard failure
//! instead of a silent `ok` -- see `crates/subs-pipeline/tests/burn_e2e.rs`
//! for the full rationale (Rust's test harness hides stdout/stderr for a
//! *passing* test, so an unconditional skip is byte-identical to a real
//! pass in the default summary).

use std::path::{Path, PathBuf};
use std::process::Command;
use subs_asr::{AsrOptions, AudioRef, FfmpegWhisperTranscriber, Transcriber};

fn have(bin: &str) -> bool {
    Command::new(bin)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// True when the running `ffmpeg` was built with `--enable-whisper`, i.e.
/// the `whisper` audio filter is registered. Homebrew's bare `ffmpeg`
/// formula lacks it; `ffmpeg-full` has it.
fn has_whisper_filter() -> bool {
    Command::new("ffmpeg")
        .arg("-filters")
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .any(|l| l.split_whitespace().nth(1) == Some("whisper"))
        })
        .unwrap_or(false)
}

fn require_ffmpeg_env_set() -> bool {
    matches!(std::env::var("SUBS_REQUIRE_FFMPEG").as_deref(), Ok("1"))
}

/// Gate a test on `condition_met`. Returns `true` when the caller should
/// skip (return early). When `SUBS_REQUIRE_FFMPEG=1` and the condition is
/// not met, panics instead of skipping, so a CI run that expects a real
/// whisper transcription cannot pass by silently doing nothing.
fn require_or_skip(condition_met: bool, what_is_missing: &str) -> bool {
    if condition_met {
        return false;
    }
    if require_ffmpeg_env_set() {
        panic!(
            "SUBS_REQUIRE_FFMPEG=1 but {what_is_missing} -- refusing to skip a required whisper transcription"
        );
    }
    println!("SKIPPED (SUBS_REQUIRE_FFMPEG not set): {what_is_missing}");
    eprintln!("skipping: {what_is_missing}");
    true
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/fixtures")
        .join(name)
}

/// `SUBS_TEST_MODEL` overrides; otherwise
/// `~/.cache/opensubs-models/ggml-tiny.en.bin`, resolved via `$HOME`
/// rather than any tilde-expansion.
fn model_path() -> Option<PathBuf> {
    if let Ok(p) = std::env::var("SUBS_TEST_MODEL") {
        return Some(PathBuf::from(p));
    }
    let home = std::env::var("HOME").ok()?;
    Some(
        Path::new(&home)
            .join(".cache")
            .join("opensubs-models")
            .join("ggml-tiny.en.bin"),
    )
}

/// Lowercase and drop everything but letters/digits/whitespace, so
/// punctuation differences ("fox." vs "fox") never fail the comparison.
fn normalize(s: &str) -> String {
    s.to_lowercase()
        .chars()
        .filter(|c| c.is_alphanumeric() || c.is_whitespace())
        .collect()
}

#[test]
fn transcribes_real_speech_with_the_tiny_model() {
    if require_or_skip(have("ffmpeg"), "ffmpeg not installed") {
        return;
    }
    if require_or_skip(
        has_whisper_filter(),
        "ffmpeg has no whisper filter (af_whisper); install ffmpeg-full",
    ) {
        return;
    }
    let model = model_path();
    if require_or_skip(
        model.as_ref().is_some_and(|p| p.exists()),
        "whisper model missing (~/.cache/opensubs-models/ggml-tiny.en.bin); \
         set SUBS_TEST_MODEL to override",
    ) {
        return;
    }
    let model = model.unwrap();

    let wav = fixture("speech.wav");
    if require_or_skip(
        wav.exists(),
        "fixture speech.wav missing; run scripts/gen-fixtures.sh (macOS only, needs `say`)",
    ) {
        return;
    }

    let reference_path = fixture("speech.reference.txt");
    let reference = std::fs::read_to_string(&reference_path).unwrap_or_default();
    // Sanity on the fixture itself: if this ever stops holding, the
    // assertion below is testing the wrong phrase.
    assert!(
        normalize(&reference).contains("quick brown fox"),
        "speech.reference.txt no longer contains the expected phrase: {reference:?}"
    );

    let transcriber = FfmpegWhisperTranscriber::new("ffmpeg", &model).with_language("en");
    let audio = AudioRef::new(&wav);
    let transcript = transcriber
        .transcribe(&audio, &AsrOptions::default())
        .expect("real whisper transcription failed");

    assert!(
        !transcript.words.is_empty(),
        "transcript has no words -- whisper produced nothing for a real speech clip"
    );
    assert!(
        !transcript.segments.is_empty(),
        "transcript has no segments"
    );

    let full_text: String = transcript
        .segments
        .iter()
        .map(|s| s.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let normalized = normalize(&full_text);
    println!("whisper transcript: {full_text:?}");
    eprintln!("whisper transcript: {full_text:?}");
    assert!(
        normalized.contains("quick brown fox"),
        "transcript did not contain the expected phrase.\nraw: {full_text:?}\nnormalized: {normalized:?}"
    );
}
