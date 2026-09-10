//! The one test that runs the real `opensubs` binary end to end: burn
//! `testdata/fixtures/720p30.mp4` with `--mock` and check the result is a
//! real video carrying burned-in subtitles.
//!
//! Follows the skip-guard pattern in `crates/subs-pipeline/tests/burn_e2e.rs`:
//! skip cleanly when ffmpeg (or its libass build) is missing, but panic
//! instead when `SUBS_REQUIRE_FFMPEG=1` is set, so this can never pass by
//! silently doing nothing in CI.

use std::path::{Path, PathBuf};
use std::process::Command;

fn have(bin: &str) -> bool {
    Command::new(bin)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn has_ass_filter() -> bool {
    Command::new("ffmpeg")
        .arg("-filters")
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .any(|l| l.split_whitespace().nth(1) == Some("ass"))
        })
        .unwrap_or(false)
}

fn require_ffmpeg_env_set() -> bool {
    matches!(std::env::var("SUBS_REQUIRE_FFMPEG").as_deref(), Ok("1"))
}

/// Gate on `condition_met`; returns `true` when the caller should skip.
/// Panics instead of skipping when `SUBS_REQUIRE_FFMPEG=1`.
fn require_or_skip(condition_met: bool, what_is_missing: &str) -> bool {
    if condition_met {
        return false;
    }
    if require_ffmpeg_env_set() {
        panic!(
            "SUBS_REQUIRE_FFMPEG=1 but {what_is_missing} -- refusing to skip a required CLI \
             burn test"
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

fn mock_transcript() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../crates/subs-asr/tests/fixtures/hello.transcript.json")
}

#[test]
fn burns_the_fixture_with_a_mock_transcript_end_to_end() {
    if require_or_skip(have("ffmpeg") && have("ffprobe"), "ffmpeg not installed") {
        return;
    }
    if require_or_skip(
        has_ass_filter(),
        "ffmpeg has no libass (the `ass` filter); install ffmpeg-full",
    ) {
        return;
    }
    let input = fixture("720p30.mp4");
    if require_or_skip(
        input.exists(),
        "fixture 720p30.mp4 missing; run scripts/gen-fixtures.sh",
    ) {
        return;
    }
    let transcript = mock_transcript();
    if require_or_skip(
        transcript.exists(),
        "mock transcript fixture missing at crates/subs-asr/tests/fixtures/hello.transcript.json",
    ) {
        return;
    }

    let work = std::env::temp_dir().join("opensubs-cli-e2e");
    std::fs::create_dir_all(&work).expect("create temp work dir");
    let output = work.join("cli-burned.mp4");
    let _ = std::fs::remove_file(&output);

    let srt_output = work.join("cli-burned.srt");
    let _ = std::fs::remove_file(&srt_output);

    let bin = env!("CARGO_BIN_EXE_opensubs");
    let out = Command::new(bin)
        .arg("burn")
        .arg(&input)
        .arg("-o")
        .arg(&output)
        .arg("--mock")
        .arg(&transcript)
        .arg("--srt")
        .arg(&srt_output)
        .arg("--preset")
        .arg("ultrafast")
        .arg("--crf")
        .arg("28")
        .arg("--quiet")
        .output()
        .expect("spawn opensubs");

    assert!(
        out.status.success(),
        "opensubs burn exited with {}\nstdout: {}\nstderr: {}",
        out.status,
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    assert!(output.exists(), "no output file at {}", output.display());

    // Probe the burned output and confirm it is a real, playable video.
    let probe_out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
        ])
        .arg(&output)
        .output()
        .expect("ffprobe the burned output");
    assert!(
        probe_out.status.success(),
        "ffprobe failed on the burned output"
    );
    let probe_json = String::from_utf8_lossy(&probe_out.stdout);
    assert!(
        probe_json.contains("\"codec_type\": \"video\""),
        "burned output has no video stream: {probe_json}"
    );

    // Confirm the mock transcript's own text actually flowed through
    // argument parsing -> plan_job -> segmentation -> the sidecar writer,
    // rather than the CLI silently burning an empty subtitle track. Pixel-
    // level proof that libass draws a non-empty ASS document is already
    // covered exhaustively by `subs-pipeline`'s own e2e suite (see
    // `ass_burn_draws_pixels_during_cues_and_not_in_the_gap`); this test's
    // job is to prove the *binary* wires those already-tested pieces
    // together correctly end to end.
    let srt_text = std::fs::read_to_string(&srt_output)
        .unwrap_or_else(|e| panic!("reading {}: {e}", srt_output.display()));
    assert!(
        srt_text.contains("Hello world"),
        "sidecar .srt does not contain the mock transcript's text: {srt_text:?}"
    );
}
