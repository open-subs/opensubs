use std::path::{Path, PathBuf};
use subs_asr::{AsrError, AsrOptions, AudioRef, Transcriber, Transcript};
use subs_media::{burn_args, BurnJob, MediaInfo, OutputSize, TrimRange, VideoEncoder};
use subs_style::{to_ass, StyleTemplate};
use subs_subtitle::{segment, Cue, SegmentConfig};
use subs_translate::{translate_cues, TranslateError, TranslateRequest, Translator};

#[derive(Debug, thiserror::Error)]
pub enum JobError {
    #[error("transcription failed: {0}")]
    Asr(#[from] AsrError),
    #[error("{0}")]
    Translate(#[from] TranslateError),
}

#[derive(Debug, Clone)]
pub struct JobSpec {
    pub input: PathBuf,
    pub output: PathBuf,
    pub style: StyleTemplate,
    pub work_dir: PathBuf,
    pub fonts_dir: PathBuf,
    pub encoder: VideoEncoder,
    pub crf: u8,
    pub preset: String,
    /// Tonemap HDR sources. Ignored for SDR input.
    pub tonemap: bool,
    /// Opt in to the Vulkan-only `libplacebo` tonemapper. Leave false on
    /// macOS -- see [`subs_media::BurnJob::prefer_gpu_tonemap`].
    pub prefer_gpu_tonemap: bool,
    /// Which span of the source to export. Defaults to the whole thing.
    pub trim: TrimRange,
    /// What resolution to encode at. Defaults to the source's own.
    pub size: OutputSize,
    /// Translate the subtitles before burning them. `None` burns the
    /// language that was spoken.
    pub translate: Option<TranslateRequest>,
}

impl JobSpec {
    /// A spec with the quality defaults: x264 CRF 16, whole clip, source
    /// resolution, no translation.
    pub fn new(
        input: impl Into<PathBuf>,
        output: impl Into<PathBuf>,
        style: StyleTemplate,
        work_dir: impl Into<PathBuf>,
    ) -> Self {
        let work_dir = work_dir.into();
        Self {
            input: input.into(),
            output: output.into(),
            style,
            fonts_dir: work_dir.clone(),
            work_dir,
            encoder: VideoEncoder::X264,
            crf: 16,
            preset: "slow".into(),
            tonemap: true,
            prefer_gpu_tonemap: false,
            trim: TrimRange::FULL,
            size: OutputSize::Source,
            translate: None,
        }
    }
}

/// Everything the loop produces, stopping short of running ffmpeg.
#[derive(Debug, Clone)]
pub struct PlannedJob {
    pub transcript: Transcript,
    /// The cues actually burned -- translated, when a translation was
    /// requested.
    pub cues: Vec<Cue>,
    /// The cues as transcribed, before any translation. Identical to
    /// `cues` when nothing was translated. Kept so a translated export can
    /// still write a sidecar in the spoken language.
    pub source_cues: Vec<Cue>,
    pub ass_text: String,
    pub ass_path: PathBuf,
    pub burn_argv: Vec<String>,
    /// How many seconds the exported clip runs for. Progress is a fraction
    /// of this, not of the source: a 20-second cut from an hour-long file
    /// would otherwise creep to 1% and stop.
    pub clip_duration: f64,
}

/// Run the closed loop up to but not including the encode.
///
/// Deliberately returns the argv rather than spawning, so the whole
/// orchestration is testable with `MockTranscriber` and no ffmpeg installed.
/// The caller writes `ass_text` to `ass_path` and spawns `burn_argv`.
///
/// `translator` is consulted only when `spec.translate` is set; passing
/// `None` for both is the untranslated path.
pub fn plan_job(
    spec: &JobSpec,
    info: &MediaInfo,
    transcriber: &dyn Transcriber,
    translator: Option<&dyn Translator>,
) -> Result<PlannedJob, JobError> {
    let audio = AudioRef::new(spec.work_dir.join("asr.wav"));
    let mut transcript = transcriber.transcribe(&audio, &AsrOptions::default())?;

    // ASR sees a WAV that starts at zero; the container may not.
    //
    // A trim makes this moot and actively wrong: `-ss` before the input
    // rebases the output timeline to zero, and the ASR audio was extracted
    // from the same span, so both clocks already agree. Adding the
    // container's offset on top would push every cue late by exactly that
    // offset.
    if info.start_time != 0.0 && spec.trim.is_full() {
        transcript.shift(info.start_time);
    }

    let source_cues = segment(&transcript, info.fps, &SegmentConfig::default());

    // Translation replaces cue text and nothing else -- see
    // `subs_translate` for why it cannot run before segmentation.
    let cues = match (&spec.translate, translator) {
        (Some(req), Some(t)) => translate_cues(&source_cues, t, req)?,
        (Some(_), None) => {
            return Err(JobError::Translate(TranslateError::Backend(
                "a translation was requested but no translation backend was supplied".into(),
            )))
        }
        (None, _) => source_cues.clone(),
    };

    // PlayRes must follow the dimensions actually encoded: the *display*
    // dimensions (or rotated phone footage renders subtitles sideways),
    // after any resize (or the subtitles are scaled along with the
    // picture).
    let play_res = spec.size.resolve(info.display_dimensions());

    // The ASS document is the one artefact that lives on the *source*
    // timeline rather than the clip's.
    //
    // ffmpeg applies an output-side seek after the filter graph has run,
    // so the `ass` filter sees every frame of the source and matches cue
    // times against source PTS. Clip-relative cues therefore get drawn
    // into the very footage the seek is about to discard: a clip cut from
    // 4s came out with no subtitles at all, which a burn that succeeds
    // and reports success will not tell you. Shifting by the trim start
    // puts each cue back over the frame it belongs to.
    //
    // Only the burn needs this. The sidecar SRT/VTT describe the exported
    // clip, whose clock starts at zero, so they keep the unshifted cues.
    let ass_cues: Vec<Cue> = if spec.trim.start > 0.0 {
        cues.iter().map(|c| c.shifted(spec.trim.start)).collect()
    } else {
        cues.clone()
    };
    let ass_text = to_ass(&ass_cues, &spec.style, play_res);
    let ass_path = spec.work_dir.join("subs.ass");

    let burn_argv = burn_args(
        &BurnJob {
            input: spec.input.clone(),
            ass: ass_path.clone(),
            fonts_dir: spec.fonts_dir.clone(),
            output: spec.output.clone(),
            encoder: spec.encoder,
            crf: spec.crf,
            preset: spec.preset.clone(),
            tonemap: spec.tonemap,
            prefer_gpu_tonemap: spec.prefer_gpu_tonemap,
            trim: spec.trim,
            size: spec.size,
        },
        info,
    );

    let clip_duration = if spec.trim.is_full() {
        info.duration
    } else {
        spec.trim.clip_duration(info.duration)
    };

    Ok(PlannedJob {
        transcript,
        cues,
        source_cues,
        ass_text,
        ass_path,
        burn_argv,
        clip_duration,
    })
}

/// Write the planned ASS file so ffmpeg can read it.
pub fn write_ass(planned: &PlannedJob) -> std::io::Result<()> {
    if let Some(parent) = planned.ass_path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::write(&planned.ass_path, &planned.ass_text)
}

/// Resolve the ffmpeg binary: the bundled sidecar (if any), then Homebrew's
/// two real install prefixes and the Windows package managers' directories,
/// checked directly (see `paths` for why that matters beyond a plain `PATH`
/// search), then `PATH` itself.
pub fn ffmpeg_binary(vendor_dir: &Path) -> PathBuf {
    let name = if cfg!(windows) {
        "ffmpeg.exe"
    } else {
        "ffmpeg"
    };
    let dirs = std::iter::once(vendor_dir.to_path_buf())
        .chain(crate::paths::homebrew_dirs())
        .chain(crate::paths::windows_dirs());
    crate::paths::find_binary(name, dirs).unwrap_or_else(|| PathBuf::from(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use subs_asr::{MockTranscriber, Segment, Transcript, Word};
    use subs_media::{ColorMeta, MediaInfo, Rational};
    use subs_style::preset_by_name;
    use subs_translate::MockTranslator;

    fn info(rotation: u32) -> MediaInfo {
        MediaInfo {
            width: 1920,
            height: 1080,
            fps: Rational { num: 30, den: 1 },
            duration: 10.0,
            pix_fmt: "yuv420p".into(),
            video_codec: Some("h264".into()),
            color: ColorMeta {
                space: Some("bt709".into()),
                primaries: Some("bt709".into()),
                transfer: Some("bt709".into()),
                range: Some("tv".into()),
            },
            rotation,
            has_audio: true,
            audio_codec: Some("aac".into()),
            start_time: 0.0,
        }
    }

    fn transcriber() -> MockTranscriber {
        MockTranscriber::from_transcript(Transcript {
            language: "en".into(),
            duration: 4.0,
            words: vec![
                Word {
                    start: 0.0,
                    end: 0.4,
                    text: "Hello".into(),
                    confidence: 0.99,
                },
                Word {
                    start: 0.5,
                    end: 1.0,
                    text: "world".into(),
                    confidence: 0.98,
                },
            ],
            segments: Vec::<Segment>::new(),
        })
    }

    fn spec() -> JobSpec {
        JobSpec {
            fonts_dir: PathBuf::from("fonts"),
            ..JobSpec::new(
                "in.mp4",
                "out.mp4",
                preset_by_name("Clean").unwrap(),
                "/tmp/work",
            )
        }
    }

    fn plan(spec: &JobSpec, info: &MediaInfo) -> PlannedJob {
        plan_job(spec, info, &transcriber(), None).unwrap()
    }

    #[test]
    fn plans_the_whole_loop_without_spawning_ffmpeg() {
        let p = plan(&spec(), &info(0));
        assert_eq!(p.cues.len(), 1);
        assert_eq!(p.cues[0].text(), "Hello world");
        assert!(p.ass_text.contains("Dialogue: 0,"));
        assert!(!p.burn_argv.is_empty());
    }

    #[test]
    fn ass_play_res_follows_display_dimensions_for_rotated_input() {
        // Stored 1920x1080 with a 90-degree flag displays as 1080x1920.
        let p = plan(&spec(), &info(90));
        assert!(p.ass_text.contains("PlayResX: 1080"));
        assert!(p.ass_text.contains("PlayResY: 1920"));
    }

    #[test]
    fn burn_argv_points_at_the_generated_ass_and_the_requested_output() {
        let p = plan(&spec(), &info(0));
        let joined = p.burn_argv.join(" ");
        assert!(joined.contains(&p.ass_path.to_string_lossy().to_string()));
        assert!(joined.contains("out.mp4"));
        assert!(joined.contains("-c:a copy"));
    }

    #[test]
    fn container_start_time_offset_shifts_every_cue() {
        let mut i = info(0);
        i.start_time = 2.0;
        let p = plan(&spec(), &i);
        assert!(
            p.cues[0].start >= 2.0 - 1e-6,
            "cue started at {}",
            p.cues[0].start
        );
    }

    #[test]
    fn sdr_input_gets_no_tonemapper_even_when_requested() {
        let joined = plan(&spec(), &info(0)).burn_argv.join(" ");
        assert!(!joined.contains("libplacebo"));
        assert!(!joined.contains("tonemap"));
    }

    #[test]
    fn hdr_input_gets_the_portable_cpu_tonemapper_by_default() {
        let mut i = info(0);
        i.color.transfer = Some("arib-std-b67".into());
        let joined = plan(&spec(), &i).burn_argv.join(" ");
        // Default must not be libplacebo: it is Vulkan-only and hard-fails
        // on macOS, the primary platform.
        assert!(joined.contains("tonemap=hable"));
        assert!(!joined.contains("libplacebo"));
    }

    #[test]
    fn the_gpu_tonemapper_opt_in_reaches_the_burn_argv() {
        let mut i = info(0);
        i.color.transfer = Some("arib-std-b67".into());
        let mut s = spec();
        s.prefer_gpu_tonemap = true;
        let joined = plan(&s, &i).burn_argv.join(" ");
        assert!(joined.contains("libplacebo"));
    }

    #[test]
    fn a_trim_reaches_the_burn_and_bounds_the_reported_duration() {
        let mut sp = spec();
        sp.trim = TrimRange::new(2.0, Some(6.0));
        let p = plan(&sp, &info(0));
        let joined = p.burn_argv.join(" ");
        assert!(joined.contains("-ss 2.000"), "{joined}");
        assert!(joined.contains("-t 4.000"), "{joined}");
        // Progress must be a fraction of the clip, not of the source.
        assert_eq!(p.clip_duration, 4.0);
    }

    #[test]
    fn an_untrimmed_job_reports_the_whole_source_duration() {
        assert_eq!(plan(&spec(), &info(0)).clip_duration, info(0).duration);
    }

    #[test]
    fn a_trim_does_not_also_apply_the_containers_start_time() {
        // Both clocks already start at zero: `-ss` rebases the output and
        // the ASR audio came from the same span. Adding start_time on top
        // would push every cue late by exactly that offset.
        let mut i = info(0);
        i.start_time = 2.0;
        let mut sp = spec();
        sp.trim = TrimRange::new(5.0, None);
        let p = plan(&sp, &i);
        assert!(
            p.cues[0].start < 1.0,
            "cue pushed to {} by a double-applied offset",
            p.cues[0].start
        );
    }

    #[test]
    fn a_resize_moves_play_res_to_the_encoded_size() {
        let mut sp = spec();
        sp.size = OutputSize::Height(720);
        let p = plan(&sp, &info(0));
        // 1920x1080 fitted to 720 high is 1280x720.
        assert!(p.ass_text.contains("PlayResX: 1280"), "{}", p.ass_text);
        assert!(p.ass_text.contains("PlayResY: 720"));
        assert!(p.burn_argv.join(" ").contains("scale=1280:720"));
    }

    #[test]
    fn translation_replaces_the_text_and_keeps_every_timing() {
        let mut sp = spec();
        sp.translate = Some(TranslateRequest::to("ja"));
        let t = MockTranslator::new([("Hello world".to_string(), "こんにちは世界".to_string())]);

        let untranslated = plan(&spec(), &info(0));
        let p = plan_job(&sp, &info(0), &transcriber(), Some(&t)).unwrap();

        assert_eq!(p.cues[0].text(), "こんにちは世界");
        assert_eq!(p.cues.len(), untranslated.cues.len());
        assert_eq!(p.cues[0].start, untranslated.cues[0].start);
        assert_eq!(p.cues[0].end, untranslated.cues[0].end);
        assert!(p.ass_text.contains("こんにちは世界"));
    }

    #[test]
    fn the_untranslated_cues_survive_a_translated_export() {
        let mut sp = spec();
        sp.translate = Some(TranslateRequest::to("ja"));
        let t = MockTranslator::new([("Hello world".to_string(), "こんにちは世界".to_string())]);
        let p = plan_job(&sp, &info(0), &transcriber(), Some(&t)).unwrap();

        // So a translated export can still write a sidecar in the language
        // that was actually spoken.
        assert_eq!(p.source_cues[0].text(), "Hello world");
        assert_eq!(p.cues[0].text(), "こんにちは世界");
    }

    #[test]
    fn source_cues_match_the_burned_cues_when_nothing_is_translated() {
        let p = plan(&spec(), &info(0));
        assert_eq!(p.cues, p.source_cues);
    }

    #[test]
    fn asking_for_a_translation_with_no_backend_fails_rather_than_burning_the_original() {
        let mut sp = spec();
        sp.translate = Some(TranslateRequest::to("ja"));
        let err = plan_job(&sp, &info(0), &transcriber(), None).unwrap_err();
        assert!(
            matches!(err, JobError::Translate(_)),
            "silently burning the untranslated text would be worse: {err}"
        );
    }

    #[test]
    fn ffmpeg_binary_prefers_a_bundled_sidecar_over_anything_else() {
        let vendor = std::env::temp_dir().join(format!(
            "subs-pipeline-ffmpeg-binary-test-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::create_dir_all(&vendor).unwrap();
        let name = if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        };
        std::fs::write(vendor.join(name), b"").unwrap();

        assert_eq!(ffmpeg_binary(&vendor), vendor.join(name));

        std::fs::remove_dir_all(&vendor).unwrap();
    }

    #[test]
    fn ffmpeg_binary_falls_back_to_a_bare_name_when_nothing_is_found() {
        // A vendor dir that doesn't exist at all -- distinct from the "sidecar
        // absent from an existing dir" case, and from Homebrew's real
        // /opt/homebrew or /usr/local prefixes, which this test cannot fake.
        let vendor = std::env::temp_dir().join("subs-pipeline-ffmpeg-binary-test-no-such-dir");
        let expected = if cfg!(windows) {
            "ffmpeg.exe"
        } else {
            "ffmpeg"
        };
        // Only assert the fallback name when Homebrew genuinely isn't on
        // this machine at either real prefix -- otherwise this test would
        // spuriously fail on a dev box that has ffmpeg installed there.
        if !PathBuf::from("/opt/homebrew/bin").join(expected).is_file()
            && !PathBuf::from("/usr/local/bin").join(expected).is_file()
        {
            assert_eq!(ffmpeg_binary(&vendor), PathBuf::from(expected));
        }
    }
}
