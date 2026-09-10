//! The one test suite that actually runs ffmpeg. Skips cleanly when ffmpeg,
//! libass or the fixture corpus is missing, so the fast suite stays runnable
//! everywhere.
//!
//! Set `SUBS_REQUIRE_FFMPEG=1` to turn every skip into a hard failure
//! instead of a silent `ok`. `.github/workflows/opensubs.yml` sets it
//! workflow-wide, and installs an ffmpeg carrying libass (and libzimg, for
//! the HDR `zscale`/`tonemap` chain) so the burns genuinely run on both
//! macOS and Linux. Rust's test harness captures both
//! stdout and stderr for a *passing* test and only shows them for a
//! *failing* one, so `eprintln!`/`println!` alone are invisible in the
//! default summary line — a skip and a real pass are byte-identical there
//! except for elapsed time, which nothing checks. `SUBS_REQUIRE_FFMPEG=1`
//! is the actual fix: it converts a would-be skip into a panic, which the
//! harness does report. The `println!`/`eprintln!` markers remain as a
//! best-effort aid for a developer running locally with `--nocapture`.

use std::path::{Path, PathBuf};
use std::process::Command;
use subs_asr::{MockTranscriber, Segment, Transcript, Word};
use subs_media::{probe_args, MediaInfo, OutputSize, TrimRange, VideoEncoder};
use subs_pipeline::{plan_job, write_ass, JobSpec};
use subs_style::preset_by_name;

fn have(bin: &str) -> bool {
    Command::new(bin)
        .arg("-version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// True when the running `ffmpeg` was built with libass, i.e. the `ass`
/// filter is registered. The bare Homebrew `ffmpeg` formula lacks it, which
/// otherwise surfaces as a confusing "No such filter: 'ass'" deep inside a
/// burn instead of naming the real cause up front.
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

/// Gate a test on `condition_met`. Returns `true` when the caller should
/// skip (return early). When `SUBS_REQUIRE_FFMPEG=1` and the condition is
/// not met, panics instead of skipping, so a CI run that expects a real
/// ffmpeg burn cannot pass by silently doing nothing.
fn require_or_skip(condition_met: bool, what_is_missing: &str) -> bool {
    if condition_met {
        return false;
    }
    if require_ffmpeg_env_set() {
        panic!(
            "SUBS_REQUIRE_FFMPEG=1 but {what_is_missing} -- refusing to skip a required burn test"
        );
    }
    // Printed on both streams as a best-effort local signal; neither is
    // visible in the default (non---nocapture) summary for a passing test,
    // which is exactly why SUBS_REQUIRE_FFMPEG exists for CI.
    println!("SKIPPED (SUBS_REQUIRE_FFMPEG not set): {what_is_missing}");
    eprintln!("skipping: {what_is_missing}");
    true
}

fn fixture(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../testdata/fixtures")
        .join(name)
}

fn probe(path: &Path) -> MediaInfo {
    let out = Command::new("ffprobe")
        .args(probe_args(path))
        .output()
        .expect("ffprobe");
    MediaInfo::from_ffprobe_json(&String::from_utf8_lossy(&out.stdout)).expect("probe parse")
}

/// Mean luma of the frame at `at_secs`. On a solid black clip every value
/// above the black floor (16.0 in limited range) can only be drawn subtitle
/// pixels, which makes this a direct measure of "did libass actually render
/// this text".
fn mean_luma_at(video: &Path, at_secs: f64) -> f64 {
    let out = Command::new("ffmpeg")
        .args(["-v", "info", "-ss", &at_secs.to_string(), "-i"])
        .arg(video)
        .args([
            "-frames:v",
            "1",
            "-vf",
            "signalstats,metadata=print:key=lavfi.signalstats.YAVG",
            "-f",
            "null",
            "-",
        ])
        .output()
        .expect("spawn ffmpeg for luma probe");
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    // ffmpeg prefixes each metadata line with a filter tag, e.g.
    // "[Parsed_metadata_1 @ 0x...] lavfi.signalstats.YAVG=16.28", so
    // search for the key rather than anchoring at line start. Some
    // ffmpeg builds print the value twice (once during format
    // negotiation, once for the actual output frame); take the last,
    // which corresponds to the frame that was actually muxed.
    combined
        .lines()
        .filter_map(|l| {
            l.split_once("lavfi.signalstats.YAVG=")
                .map(|(_, v)| v.trim())
        })
        .next_back()
        .unwrap_or_else(|| panic!("YAVG not found in ffmpeg output:\n{combined}"))
        .parse::<f64>()
        .expect("YAVG not a float")
}

/// Number of frames actually present in the video stream. `-count_frames`
/// decodes them rather than trusting a container-level count, which is the
/// only way to see a frame that was duplicated or dropped during a burn.
fn frame_count(path: &Path) -> u64 {
    let out = Command::new("ffprobe")
        .args([
            "-v",
            "error",
            "-select_streams",
            "v:0",
            "-count_frames",
            "-show_entries",
            "stream=nb_read_frames",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
        ])
        .arg(path)
        .output()
        .expect("ffprobe -count_frames");
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .parse()
        .unwrap_or_else(|e| {
            panic!(
                "could not read frame count for {}: {e} (stdout {:?})",
                path.display(),
                String::from_utf8_lossy(&out.stdout)
            )
        })
}

/// Last value reported for `key` in ffmpeg's `-progress` stream.
///
/// `-progress pipe:1` writes plain `key=value` lines to stdout, repeated
/// once per progress tick, so the final occurrence is the run total.
fn progress_value(progress_stdout: &str, key: &str) -> Option<i64> {
    let prefix = format!("{key}=");
    progress_stdout
        .lines()
        .filter_map(|l| l.trim().strip_prefix(&prefix))
        .next_back()
        .and_then(|v| v.trim().parse().ok())
}

fn transcriber() -> MockTranscriber {
    MockTranscriber::from_transcript(Transcript {
        language: "en".into(),
        duration: 8.0,
        words: vec![
            Word {
                start: 0.5,
                end: 1.0,
                text: "Hello".into(),
                confidence: 0.99,
            },
            Word {
                start: 1.1,
                end: 1.8,
                text: "world".into(),
                confidence: 0.98,
            },
            Word {
                start: 4.0,
                end: 4.6,
                text: "again".into(),
                confidence: 0.97,
            },
        ],
        segments: Vec::<Segment>::new(),
    })
}

#[test]
fn burns_subtitles_and_preserves_audio_colour_and_timing() {
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

    let work = std::env::temp_dir().join("subs-e2e");
    std::fs::create_dir_all(&work).unwrap();
    let output = work.join("burned.mp4");

    let info = probe(&input);
    let spec = JobSpec {
        input: input.clone(),
        output: output.clone(),
        style: preset_by_name("Clean").unwrap(),
        work_dir: work.clone(),
        fonts_dir: work.clone(),
        encoder: VideoEncoder::X264,
        // Faster preset: this test gates correctness, not encoder quality.
        crf: 23,
        preset: "ultrafast".into(),
        tonemap: false,
        prefer_gpu_tonemap: false,
        trim: TrimRange::FULL,
        size: OutputSize::Source,
        translate: None,
    };

    let planned = plan_job(&spec, &info, &transcriber(), None).unwrap();
    assert!(!planned.cues.is_empty(), "segmentation produced no cues");
    write_ass(&planned).unwrap();

    let status = Command::new("ffmpeg")
        .args(&planned.burn_argv)
        .status()
        .expect("spawn ffmpeg");
    assert!(status.success(), "burn failed: {:?}", planned.burn_argv);
    assert!(output.exists(), "no output file produced");

    let out_info = probe(&output);

    // Q3: duration and frame rate survive the burn.
    assert!(
        (out_info.duration - info.duration).abs() < 0.1,
        "duration drifted: {} -> {}",
        info.duration,
        out_info.duration
    );
    assert_eq!(out_info.fps, info.fps, "frame rate changed");

    // Q4: dimensions unchanged.
    assert_eq!(out_info.display_dimensions(), info.display_dimensions());

    // Q2: the output carries explicit BT.709 tags. Without them players
    // decode as BT.601 and the video looks washed out.
    assert_eq!(out_info.color.space.as_deref(), Some("bt709"));
    assert_eq!(out_info.color.primaries.as_deref(), Some("bt709"));
    assert_eq!(out_info.color.transfer.as_deref(), Some("bt709"));

    // Q1: audio was stream-copied, not re-encoded.
    let md5 = |p: &Path| -> String {
        let o = Command::new("ffmpeg")
            .args(["-v", "error", "-i"])
            .arg(p)
            .args(["-map", "0:a", "-c", "copy", "-f", "md5", "-"])
            .output()
            .expect("md5");
        String::from_utf8_lossy(&o.stdout).trim().to_string()
    };
    assert_eq!(md5(&input), md5(&output), "audio was re-encoded");
}

#[test]
fn silent_input_does_not_hard_fail() {
    if require_or_skip(have("ffmpeg") && have("ffprobe"), "ffmpeg not installed") {
        return;
    }
    if require_or_skip(
        has_ass_filter(),
        "ffmpeg has no libass (the `ass` filter); install ffmpeg-full",
    ) {
        return;
    }
    let input = fixture("silent.mp4");
    if require_or_skip(
        input.exists(),
        "fixture silent.mp4 missing; run scripts/gen-fixtures.sh",
    ) {
        return;
    }

    let work = std::env::temp_dir().join("subs-e2e-silent");
    std::fs::create_dir_all(&work).unwrap();
    let output = work.join("burned-silent.mp4");

    let info = probe(&input);
    assert!(!info.has_audio, "fixture should have no audio stream");

    let spec = JobSpec {
        input,
        output: output.clone(),
        style: preset_by_name("Clean").unwrap(),
        work_dir: work.clone(),
        fonts_dir: work,
        encoder: VideoEncoder::X264,
        crf: 23,
        preset: "ultrafast".into(),
        tonemap: false,
        prefer_gpu_tonemap: false,
        trim: TrimRange::FULL,
        size: OutputSize::Source,
        translate: None,
    };

    let planned = plan_job(&spec, &info, &transcriber(), None).unwrap();
    write_ass(&planned).unwrap();

    let status = Command::new("ffmpeg")
        .args(&planned.burn_argv)
        .status()
        .expect("spawn ffmpeg");
    // The trailing ? on -map 0:a:0? is what makes this pass.
    assert!(status.success(), "silent input failed to burn");
    assert!(output.exists());
}

#[test]
fn rotated_input_produces_ass_matching_the_display_orientation() {
    if require_or_skip(have("ffprobe"), "ffprobe not installed") {
        return;
    }
    let input = fixture("rotated-90.mp4");
    if require_or_skip(
        input.exists(),
        "fixture rotated-90.mp4 missing; run scripts/gen-fixtures.sh",
    ) {
        return;
    }

    let info = probe(&input);
    let work = std::env::temp_dir().join("subs-e2e-rot");
    let spec = JobSpec {
        input,
        output: work.join("out.mp4"),
        style: preset_by_name("Clean").unwrap(),
        work_dir: work.clone(),
        fonts_dir: work,
        encoder: VideoEncoder::X264,
        crf: 23,
        preset: "ultrafast".into(),
        tonemap: false,
        prefer_gpu_tonemap: false,
        trim: TrimRange::FULL,
        size: OutputSize::Source,
        translate: None,
    };

    let planned = plan_job(&spec, &info, &transcriber(), None).unwrap();
    let (dw, dh) = info.display_dimensions();
    assert!(
        planned.ass_text.contains(&format!("PlayResX: {dw}")),
        "PlayResX must follow display width"
    );
    assert!(
        planned.ass_text.contains(&format!("PlayResY: {dh}")),
        "PlayResY must follow display height"
    );
}

/// Q1-Q4 only inspect the audio bitstream, colour tags, timing and
/// dimensions of the burned output -- all four hold unchanged even if the
/// `ass` filter silently drew nothing (wrong filter order, empty ASS,
/// missing font). This test closes that gap: it burns the *same* planned
/// ASS onto a solid black clip, where any non-black pixel can only be a
/// subtitle, then compares mean luma inside a cue against the gap between
/// cues.
#[test]
fn ass_burn_draws_pixels_during_cues_and_not_in_the_gap() {
    if require_or_skip(have("ffmpeg") && have("ffprobe"), "ffmpeg not installed") {
        return;
    }
    if require_or_skip(
        has_ass_filter(),
        "ffmpeg has no libass (the `ass` filter); install ffmpeg-full",
    ) {
        return;
    }
    // Reused only for its 1280x720@30 MediaInfo, so the solid-colour clip
    // below shares the ASS PlayRes; the fixture's own bytes are not read by
    // this test's burn.
    let dims_source = fixture("720p30.mp4");
    if require_or_skip(
        dims_source.exists(),
        "fixture 720p30.mp4 missing; run scripts/gen-fixtures.sh",
    ) {
        return;
    }

    let work = std::env::temp_dir().join("subs-e2e-pixel");
    std::fs::create_dir_all(&work).unwrap();

    let info = probe(&dims_source);
    let spec = JobSpec {
        input: dims_source,
        output: work.join("unused.mp4"),
        style: preset_by_name("Clean").unwrap(),
        work_dir: work.clone(),
        fonts_dir: work.clone(),
        encoder: VideoEncoder::X264,
        crf: 23,
        preset: "ultrafast".into(),
        tonemap: false,
        prefer_gpu_tonemap: false,
        trim: TrimRange::FULL,
        size: OutputSize::Source,
        translate: None,
    };
    let planned = plan_job(&spec, &info, &transcriber(), None).unwrap();
    write_ass(&planned).unwrap();

    let (w, h) = info.display_dimensions();
    let black_burned = work.join("black-burned.mp4");
    let status = Command::new("ffmpeg")
        .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
        .arg(format!("color=c=black:s={w}x{h}:r=30:d=6"))
        .arg("-vf")
        .arg(format!(
            "ass={}:fontsdir={}",
            planned.ass_path.display(),
            spec.fonts_dir.display()
        ))
        .args(["-c:v", "libx264", "-crf", "18"])
        .arg(&black_burned)
        .status()
        .expect("spawn ffmpeg for black-clip subtitle burn");
    assert!(status.success(), "black-clip subtitle burn failed");

    let luma_at = |at_secs: f64| -> f64 { mean_luma_at(&black_burned, at_secs) };

    // Mock transcript cues land at 0:00:00.50-0:00:01.80 ("Hello world")
    // and 0:00:04.00-0:00:05.00 ("again"), so t=1.0s and t=4.5s are inside a
    // cue and t=3.0s sits in the gap between them.
    let in_cue_a = luma_at(1.0);
    let in_cue_b = luma_at(4.5);
    let in_gap = luma_at(3.0);

    // A margin well above encoder/measurement noise but far below what a
    // rendered line of subtitle text actually contributes to full-frame
    // mean luma -- the relationship matters, not any specific constant.
    const MARGIN: f64 = 0.05;
    assert!(
        in_cue_a > in_gap + MARGIN,
        "no subtitle pixels detected at t=1.0s: in-cue luma {in_cue_a} vs gap luma {in_gap}"
    );
    assert!(
        in_cue_b > in_gap + MARGIN,
        "no subtitle pixels detected at t=4.5s: in-cue luma {in_cue_b} vs gap luma {in_gap}"
    );
}

/// Q3's actual claim: "phone video is VFR; forcing CFR duplicates and drops
/// frames". Until this test existed that was asserted only by the presence
/// of `-fps_mode passthrough` in the argv string, and `vfr-phone.mp4` was
/// generated but used by no test at all.
///
/// ffmpeg counts exactly this for us: `-progress` reports `dup_frames` and
/// `drop_frames`, which are non-zero precisely when the frame timing was
/// rewritten. Both must be zero, and the burned output must keep every one
/// of the input's frames.
#[test]
fn q3_vfr_input_is_burned_without_duplicating_or_dropping_a_frame() {
    if require_or_skip(have("ffmpeg") && have("ffprobe"), "ffmpeg not installed") {
        return;
    }
    if require_or_skip(
        has_ass_filter(),
        "ffmpeg has no libass (the `ass` filter); install ffmpeg-full",
    ) {
        return;
    }
    let input = fixture("vfr-phone.mp4");
    if require_or_skip(
        input.exists(),
        "fixture vfr-phone.mp4 missing; run scripts/gen-fixtures.sh",
    ) {
        return;
    }

    let work = std::env::temp_dir().join("subs-e2e-vfr");
    std::fs::create_dir_all(&work).unwrap();
    let output = work.join("burned-vfr.mp4");

    let info = probe(&input);
    let spec = JobSpec {
        input: input.clone(),
        output: output.clone(),
        style: preset_by_name("Clean").unwrap(),
        work_dir: work.clone(),
        fonts_dir: work,
        encoder: VideoEncoder::X264,
        crf: 23,
        preset: "ultrafast".into(),
        tonemap: false,
        prefer_gpu_tonemap: false,
        trim: TrimRange::FULL,
        size: OutputSize::Source,
        translate: None,
    };

    let planned = plan_job(&spec, &info, &transcriber(), None).unwrap();
    write_ass(&planned).unwrap();

    // `-progress pipe:1` is already in the argv, so stdout carries the
    // counters.
    let out = Command::new("ffmpeg")
        .args(&planned.burn_argv)
        .output()
        .expect("spawn ffmpeg");
    assert!(
        out.status.success(),
        "VFR burn failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );
    let progress = String::from_utf8_lossy(&out.stdout);

    let dup = progress_value(&progress, "dup_frames")
        .unwrap_or_else(|| panic!("no dup_frames in -progress output:\n{progress}"));
    let drop = progress_value(&progress, "drop_frames")
        .unwrap_or_else(|| panic!("no drop_frames in -progress output:\n{progress}"));

    assert_eq!(
        dup, 0,
        "ffmpeg duplicated {dup} frames -- the burn forced CFR, which is \
         exactly the judder -fps_mode passthrough exists to prevent"
    );
    assert_eq!(drop, 0, "ffmpeg dropped {drop} frames during the burn");

    // The counters above are ffmpeg's own bookkeeping; this checks the file
    // that actually came out.
    let before = frame_count(&input);
    let after = frame_count(&output);
    assert_eq!(
        before, after,
        "frame count changed across the burn: {before} -> {after}"
    );
}

/// Q6: rotated phone footage must come out upright. `burn_e2e` previously
/// only checked the ASS `PlayRes` strings for `rotated-90.mp4` -- no rotated
/// file was ever encoded, so nothing verified that the burned *video* is
/// portrait rather than a sideways 1920x1080.
#[test]
fn q6_rotated_input_burns_to_an_upright_portrait_video() {
    if require_or_skip(have("ffmpeg") && have("ffprobe"), "ffmpeg not installed") {
        return;
    }
    if require_or_skip(
        has_ass_filter(),
        "ffmpeg has no libass (the `ass` filter); install ffmpeg-full",
    ) {
        return;
    }
    let input = fixture("rotated-90.mp4");
    if require_or_skip(
        input.exists(),
        "fixture rotated-90.mp4 missing; run scripts/gen-fixtures.sh",
    ) {
        return;
    }

    let work = std::env::temp_dir().join("subs-e2e-rot-burn");
    std::fs::create_dir_all(&work).unwrap();
    let output = work.join("burned-rotated.mp4");

    let info = probe(&input);
    // Stored landscape, flagged for rotation, so it *displays* portrait.
    assert_eq!((info.width, info.height), (1920, 1080));
    assert_eq!(info.display_dimensions(), (1080, 1920));

    let spec = JobSpec {
        input,
        output: output.clone(),
        style: preset_by_name("Clean").unwrap(),
        work_dir: work.clone(),
        fonts_dir: work,
        encoder: VideoEncoder::X264,
        crf: 23,
        preset: "ultrafast".into(),
        tonemap: false,
        prefer_gpu_tonemap: false,
        trim: TrimRange::FULL,
        size: OutputSize::Source,
        translate: None,
    };

    let planned = plan_job(&spec, &info, &transcriber(), None).unwrap();
    write_ass(&planned).unwrap();

    let out = Command::new("ffmpeg")
        .args(&planned.burn_argv)
        .output()
        .expect("spawn ffmpeg");
    assert!(
        out.status.success(),
        "rotated burn failed: {}",
        String::from_utf8_lossy(&out.stderr)
    );

    let out_info = probe(&output);
    assert_eq!(
        out_info.display_dimensions(),
        (1080, 1920),
        "burned video is not upright portrait: stored {}x{}, rotation {}",
        out_info.width,
        out_info.height,
        out_info.rotation
    );
}

/// Q5 (no text is lost) end to end, for the one character that silently
/// deletes it: `{`.
///
/// An unescaped `{` opens an ASS override block, so libass parses the
/// brace-enclosed word as style commands and draws nothing -- no warning, no
/// error, just a missing word in the burned video. This test renders the
/// same sentence twice on a solid black clip: once with a braced word, and
/// once with that word actually removed. If escaping works the braced
/// version draws strictly more pixels; if the brace is swallowed the two are
/// indistinguishable.
#[test]
fn braced_words_are_still_drawn_in_the_burned_video() {
    if require_or_skip(have("ffmpeg") && have("ffprobe"), "ffmpeg not installed") {
        return;
    }
    if require_or_skip(
        has_ass_filter(),
        "ffmpeg has no libass (the `ass` filter); install ffmpeg-full",
    ) {
        return;
    }

    let work = std::env::temp_dir().join("subs-e2e-braces");
    std::fs::create_dir_all(&work).unwrap();
    let style = preset_by_name("Clean").unwrap();

    // Render `text` on a 4-second black clip and report the mean luma of a
    // frame inside the cue.
    let luma_of = |tag: &str, text: &str| -> f64 {
        let cues = vec![subs_subtitle::Cue {
            start: 0.0,
            end: 4.0,
            lines: vec![text.to_string()],
        }];
        let ass_path = work.join(format!("{tag}.ass"));
        std::fs::write(&ass_path, subs_style::to_ass(&cues, &style, (1280, 720))).unwrap();

        let video = work.join(format!("{tag}.mp4"));
        let status = Command::new("ffmpeg")
            .args(["-v", "error", "-y", "-f", "lavfi", "-i"])
            .arg("color=c=black:s=1280x720:r=30:d=4")
            .arg("-vf")
            .arg(format!("ass={}", ass_path.display()))
            .args(["-c:v", "libx264", "-crf", "18"])
            .arg(&video)
            .status()
            .expect("spawn ffmpeg for black-clip burn");
        assert!(status.success(), "black-clip burn failed for {tag}");
        mean_luma_at(&video, 2.0)
    };

    let braced = luma_of("braced", "Hello {world} again");
    // Exactly what the viewer sees when libass swallows the override block.
    let swallowed = luma_of("swallowed", "Hello  again");
    let floor = luma_of("empty", "");

    // Sanity: text is being drawn at all, so a failure below really is
    // about the braces and not a broken render path.
    const MARGIN: f64 = 0.05;
    assert!(
        swallowed > floor + MARGIN,
        "no subtitle pixels at all: {swallowed} vs black floor {floor}"
    );
    assert!(
        braced > swallowed + MARGIN,
        "the braced word was not drawn -- `{{world}}` was parsed as an \
         override block and deleted: braced luma {braced} vs \
         brace-swallowed luma {swallowed} (black floor {floor})"
    );
}

/// The spec's headline HDR decision is that HDR sources are **never
/// refused**. Until this test existed, only the *argv string* was asserted,
/// and the argv named `libplacebo` -- which is Vulkan-only, so on macOS the
/// filter graph fails to initialise and the burn dies with
/// `VK_ERROR_INCOMPATIBLE_DRIVER`. Every iPhone HLG clip hard-failed on the
/// primary platform while the unit tests stayed green, because no HDR burn
/// was ever executed. This test executes one.
#[test]
fn hdr_source_actually_burns_and_lands_on_bt709() {
    if require_or_skip(have("ffmpeg") && have("ffprobe"), "ffmpeg not installed") {
        return;
    }
    if require_or_skip(
        has_ass_filter(),
        "ffmpeg has no libass (the `ass` filter); install ffmpeg-full",
    ) {
        return;
    }
    let input = fixture("hdr-hlg.mp4");
    if require_or_skip(
        input.exists(),
        "fixture hdr-hlg.mp4 missing; run scripts/gen-fixtures.sh",
    ) {
        return;
    }

    let work = std::env::temp_dir().join("subs-e2e-hdr");
    std::fs::create_dir_all(&work).unwrap();
    let output = work.join("burned-hdr.mp4");

    let info = probe(&input);
    assert!(
        info.color.is_hdr(),
        "fixture is not HDR ({:?}); the tonemap path would not be exercised",
        info.color.transfer
    );

    let spec = JobSpec {
        input,
        output: output.clone(),
        style: preset_by_name("Clean").unwrap(),
        work_dir: work.clone(),
        fonts_dir: work,
        encoder: VideoEncoder::X264,
        crf: 23,
        preset: "ultrafast".into(),
        tonemap: true,
        // The default, asserted explicitly: flipping this to true is what
        // reintroduces the macOS failure.
        prefer_gpu_tonemap: false,
        trim: TrimRange::FULL,
        size: OutputSize::Source,
        translate: None,
    };

    let planned = plan_job(&spec, &info, &transcriber(), None).unwrap();
    let joined = planned.burn_argv.join(" ");
    assert!(
        joined.contains("tonemap=hable"),
        "expected the portable CPU tonemapper in the argv: {joined}"
    );
    write_ass(&planned).unwrap();

    let out = Command::new("ffmpeg")
        .args(&planned.burn_argv)
        .output()
        .expect("spawn ffmpeg");
    assert!(
        out.status.success(),
        "HDR burn failed: {}\nargv: {:?}",
        String::from_utf8_lossy(&out.stderr),
        planned.burn_argv
    );
    assert!(output.exists(), "no output file produced");

    // Tonemapped output must be tagged SDR BT.709 throughout. A player that
    // sees arib-std-b67 here would re-apply an HLG curve to already-SDR
    // pixels and wash the picture out.
    let out_info = probe(&output);
    assert_eq!(out_info.color.space.as_deref(), Some("bt709"));
    assert_eq!(out_info.color.primaries.as_deref(), Some("bt709"));
    assert_eq!(out_info.color.transfer.as_deref(), Some("bt709"));
    assert!(
        !out_info.color.is_hdr(),
        "output is still tagged HDR: {:?}",
        out_info.color
    );
}

/// The frame at `at_secs` as raw 8-bit greyscale.
fn gray_frame(video: &Path, at_secs: f64) -> Vec<u8> {
    let out = Command::new("ffmpeg")
        .args(["-v", "error", "-ss", &at_secs.to_string(), "-i"])
        .arg(video)
        .args(["-frames:v", "1", "-pix_fmt", "gray", "-f", "rawvideo", "-"])
        .output()
        .expect("spawn ffmpeg for frame extraction");
    out.stdout
}

/// How many pixels differ noticeably between two frames of the same clip.
///
/// The subtitled and unsubtitled burns of one source differ only where
/// libass drew, so this counts subtitle pixels directly -- and unlike a
/// mean-luma threshold it works on ordinary footage rather than only on a
/// black fixture.
fn differing_pixels(a: &[u8], b: &[u8]) -> usize {
    a.iter()
        .zip(b)
        .filter(|(x, y)| x.abs_diff(**y) > 40)
        .count()
}

/// A trimmed export must be a real clip: starting at zero, running the
/// requested length, with its subtitles on the frames they belong to.
///
/// This is a regression test for two bugs that a passing burn hides
/// completely, both found by running a trim rather than by reading the
/// argv:
///
/// 1. An input-side `-ss` leaves filtered video on source timestamps while
///    the stream-copied audio rebases to zero -- a clip cut from 4s came
///    out with four seconds of A/V desync and a 10s container for a 6s
///    request.
/// 2. With the output-side seek that fixes (1), ffmpeg runs the filter
///    graph *before* discarding the skipped span, so clip-relative cue
///    times get drawn into footage that is then thrown away. The export
///    succeeded, reported success, and contained no subtitles at all.
#[test]
fn a_trimmed_burn_is_a_zero_based_clip_with_its_subtitles_on_it() {
    if require_or_skip(have("ffmpeg") && have("ffprobe"), "ffmpeg not installed") {
        return;
    }
    if require_or_skip(
        has_ass_filter(),
        "ffmpeg has no libass (the `ass` filter); install ffmpeg-full",
    ) {
        return;
    }
    let input = fixture("sample-clip.mp4");
    if require_or_skip(input.exists(), "fixture sample-clip.mp4 missing") {
        return;
    }

    let info = probe(&input);
    const START: f64 = 4.0;
    const LENGTH: f64 = 6.0;
    if require_or_skip(
        info.duration > START + LENGTH,
        "sample-clip.mp4 is too short to cut a 6s clip from 4s",
    ) {
        return;
    }

    let work = std::env::temp_dir().join("subs-e2e-trim");
    std::fs::create_dir_all(&work).unwrap();

    let base = JobSpec {
        fonts_dir: work.clone(),
        encoder: VideoEncoder::X264,
        crf: 28,
        preset: "ultrafast".into(),
        trim: TrimRange::from_duration(START, LENGTH),
        ..JobSpec::new(
            input.clone(),
            work.join("trimmed.mp4"),
            preset_by_name("Clean").unwrap(),
            work.clone(),
        )
    };

    let burn = |spec: &JobSpec, t: &MockTranscriber| {
        let planned = plan_job(spec, &info, t, None).unwrap();
        write_ass(&planned).unwrap();
        let status = Command::new("ffmpeg")
            .args(&planned.burn_argv)
            .status()
            .expect("spawn ffmpeg");
        assert!(status.success(), "burn failed: {:?}", planned.burn_argv);
        planned
    };

    let planned = burn(&base, &transcriber());
    let output = &base.output;
    assert!(output.exists(), "no output file produced");

    // The clip is its own video: it starts at zero and runs the length
    // that was asked for, not the length of the source.
    let out_info = probe(output);
    assert!(
        (out_info.duration - LENGTH).abs() < 0.2,
        "clip is {:.2}s, expected {LENGTH}s (source is {:.2}s)",
        out_info.duration,
        info.duration
    );
    assert!(
        out_info.start_time.abs() < 0.1,
        "clip starts at {:.3}s rather than zero",
        out_info.start_time
    );
    assert_eq!(planned.clip_duration, LENGTH);

    // The cues are clip-relative, so the sidecar describes the clip.
    let first = planned.cues.first().expect("no cues");
    assert!(
        first.start < LENGTH,
        "first cue at {:.2}s is outside a {LENGTH}s clip",
        first.start
    );

    // ...and the burn actually drew them. Compared against the same clip
    // burned from an empty transcript, so the only difference is libass.
    let empty = MockTranscriber::from_transcript(Transcript {
        language: "en".into(),
        duration: LENGTH,
        words: Vec::new(),
        segments: Vec::<Segment>::new(),
    });
    let bare_spec = JobSpec {
        output: work.join("trimmed-bare.mp4"),
        ..base.clone()
    };
    burn(&bare_spec, &empty);

    let inside = first.start + (first.end - first.start) / 2.0;
    let drawn = differing_pixels(
        &gray_frame(output, inside),
        &gray_frame(&bare_spec.output, inside),
    );
    assert!(
        drawn > 100,
        "no subtitle pixels at {inside:.2}s -- the clip burned successfully with no subtitles on it"
    );

    // And nothing is drawn between cues, which proves the shift is a shift
    // rather than an offset that happens to leave text somewhere.
    if let Some(gap) = planned
        .cues
        .windows(2)
        .find(|w| w[1].start - w[0].end > 0.3)
        .map(|w| (w[0].end + w[1].start) / 2.0)
    {
        let stray = differing_pixels(
            &gray_frame(output, gap),
            &gray_frame(&bare_spec.output, gap),
        );
        assert!(
            stray < 100,
            "{stray} subtitle pixels drawn at {gap:.2}s, between cues"
        );
    }
}
