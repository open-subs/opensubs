use crate::scale::{scale_filter, OutputSize};
use crate::trim::TrimRange;
use crate::MediaInfo;
use std::path::PathBuf;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum VideoEncoder {
    /// Default. Best quality per bitrate; GPL.
    X264,
    X265,
    VideoToolbox,
    Nvenc,
    Qsv,
    Amf,
}

impl VideoEncoder {
    pub fn ffmpeg_name(self) -> &'static str {
        match self {
            Self::X264 => "libx264",
            Self::X265 => "libx265",
            Self::VideoToolbox => "h264_videotoolbox",
            Self::Nvenc => "h264_nvenc",
            Self::Qsv => "h264_qsv",
            Self::Amf => "h264_amf",
        }
    }

    pub fn is_hardware(self) -> bool {
        !matches!(self, Self::X264 | Self::X265)
    }

    /// Hardware encoders reject `-crf`/`-preset` and need their own
    /// rate-control flags. These are the quality-biased settings from the
    /// spec's hardware table.
    fn rate_control_args(self) -> Vec<String> {
        match self {
            Self::VideoToolbox => vec!["-q:v".into(), "55".into()],
            Self::Nvenc => vec![
                "-preset".into(),
                "p7".into(),
                "-tune".into(),
                "hq".into(),
                "-rc".into(),
                "vbr".into(),
                "-cq".into(),
                "19".into(),
            ],
            Self::Qsv => vec![
                "-global_quality".into(),
                "20".into(),
                "-preset".into(),
                "veryslow".into(),
            ],
            Self::Amf => vec![
                "-quality".into(),
                "quality".into(),
                "-rc".into(),
                "cqp".into(),
                "-qp_i".into(),
                "20".into(),
                "-qp_p".into(),
                "22".into(),
            ],
            Self::X264 | Self::X265 => Vec::new(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct BurnJob {
    pub input: PathBuf,
    pub ass: PathBuf,
    pub fonts_dir: PathBuf,
    pub output: PathBuf,
    pub encoder: VideoEncoder,
    pub crf: u8,
    pub preset: String,
    /// Tonemap HDR to SDR. Ignored when the source is already SDR.
    pub tonemap: bool,
    /// Opt in to the `libplacebo` GPU tonemapper instead of the default
    /// CPU `zscale`/`tonemap` chain.
    ///
    /// **Defaults to false, and must stay that way.** `libplacebo` is
    /// Vulkan-only and macOS ships no Vulkan driver, so on the primary
    /// platform this filter does not degrade -- it hard-fails the whole
    /// burn:
    ///
    /// ```text
    /// [libplacebo] Failed creating instance: VK_ERROR_INCOMPATIBLE_DRIVER
    /// [libplacebo] Failed initializing vulkan instance
    /// ```
    ///
    /// Since the spec's headline HDR decision is that HDR sources are
    /// *never refused*, the default tonemapper has to be the one that
    /// works everywhere. The spec's own §3.6 fallback chain does, so that
    /// is the default; `libplacebo` stays reachable behind this flag for
    /// Linux/Windows hosts with a real Vulkan driver, where it is the
    /// better tonemapper (BT.2390 with dynamic peak detection).
    pub prefer_gpu_tonemap: bool,
    /// Which span of the source to export. [`TrimRange::FULL`] emits no
    /// seek flags, so an untrimmed burn is the exact command it was before
    /// trimming existed.
    pub trim: TrimRange,
    /// What resolution to encode at. [`OutputSize::Source`] adds no filter.
    pub size: OutputSize,
}

impl BurnJob {
    /// A job with the quality defaults: x264 CRF 16, no trim, source
    /// resolution, CPU tonemapping.
    pub fn new(
        input: impl Into<PathBuf>,
        ass: impl Into<PathBuf>,
        fonts_dir: impl Into<PathBuf>,
        output: impl Into<PathBuf>,
    ) -> Self {
        Self {
            input: input.into(),
            ass: ass.into(),
            fonts_dir: fonts_dir.into(),
            output: output.into(),
            encoder: VideoEncoder::X264,
            crf: 16,
            preset: "slow".into(),
            tonemap: true,
            prefer_gpu_tonemap: false,
            trim: TrimRange::FULL,
            size: OutputSize::Source,
        }
    }
}

/// GPU tonemapper: BT.2390 with dynamic peak detection. Better quality, but
/// Vulkan-only -- see [`BurnJob::prefer_gpu_tonemap`].
const TONEMAP_GPU: &str = "libplacebo=tonemapping=bt.2390:colorspace=bt709\
     :color_primaries=bt709:color_trc=bt709:range=tv:format=yuv420p";

/// CPU tonemapper (spec §3.6 fallback chain), the default because it runs
/// on every platform including macOS.
///
/// Linearise with a 100-nit reference white, convert to float so the tonemap
/// operator has headroom, move the primaries to BT.709, apply Hable, then
/// re-encode as BT.709/TV 8-bit. `desat=0` keeps highlights from washing to
/// grey.
const TONEMAP_CPU: &str = "zscale=t=linear:npl=100,format=gbrpf32le,\
     zscale=p=bt709,tonemap=hable:desat=0,\
     zscale=t=bt709:m=bt709:r=tv,format=yuv420p";

/// Build the burn command.
///
/// Carries quality claims Q1 (audio stream-copied), Q2 (explicit colour
/// tagging) and Q3 (VFR preserved) from the spec. Every flag here is
/// asserted in this module's tests and again by `subs-qa` on real output.
pub fn burn_args(job: &BurnJob, info: &MediaInfo) -> Vec<String> {
    let mut filters = Vec::new();

    // Tonemap before subtitles, otherwise the subtitle overlay is tonemapped
    // along with the picture and comes out grey.
    let tonemapped = job.tonemap && info.color.is_hdr();
    if tonemapped {
        // CPU by default: libplacebo needs Vulkan, which macOS does not
        // have, and a hard-failing burn is worse than a slower one.
        filters.push(if job.prefer_gpu_tonemap {
            TONEMAP_GPU.to_string()
        } else {
            TONEMAP_CPU.to_string()
        });
    }

    // The four output colour tags must describe the pixels actually
    // produced, not a fixed assumption:
    // - If a tonemapper ran, it truthfully converted to bt709/tv, so tag
    //   that. Both chains are configured to land on exactly bt709/tv.
    // - Otherwise nothing in the chain touches colour, so the input's own
    //   tags pass straight through untouched.
    // - Untagged input falls back to bt709/tv: the single most common case
    //   for untagged HD footage, and a truthful-ish guess beats emitting no
    //   tag at all (which is the original washed-out-video bug).
    let (out_space, out_primaries, out_transfer, out_range) = if tonemapped {
        ("bt709", "bt709", "bt709", "tv")
    } else {
        (
            info.color.space.as_deref().unwrap_or("bt709"),
            info.color.primaries.as_deref().unwrap_or("bt709"),
            info.color.transfer.as_deref().unwrap_or("bt709"),
            info.color.range.as_deref().unwrap_or("tv"),
        )
    };

    // Scale before the subtitles, never after: libass then renders glyphs
    // directly at the output resolution instead of having them resampled
    // along with the picture.
    let target = job.size.resolve(info.display_dimensions());
    if !job.size.is_noop(info.display_dimensions()) {
        filters.push(scale_filter(target));
    }

    filters.push(format!(
        "ass={}:fontsdir={}:shaping=complex",
        job.ass.to_string_lossy(),
        job.fonts_dir.to_string_lossy()
    ));

    let mut a: Vec<String> = vec![
        "-hide_banner".into(),
        "-v".into(),
        "error".into(),
        "-nostdin".into(),
        "-y".into(),
    ];

    a.extend([
        "-i".into(),
        job.input.to_string_lossy().into_owned(),
        "-filter_complex".into(),
        format!("[0:v]{}[v]", filters.join(",")),
        "-map".into(),
        "[v]".into(),
        // Trailing ? makes the audio stream optional: silent clips must not
        // hard-fail.
        "-map".into(),
        "0:a:0?".into(),
        "-c:v".into(),
        job.encoder.ffmpeg_name().into(),
    ]);

    // After -i, deliberately: see TrimRange::seek_args for what an
    // input-side seek does to a filtered, subtitled clip.
    a.extend(job.trim.seek_args());

    if job.encoder.is_hardware() {
        a.extend(job.encoder.rate_control_args());
    } else {
        a.extend([
            "-crf".into(),
            job.crf.to_string(),
            "-preset".into(),
            job.preset.clone(),
        ]);
    }

    a.extend([
        "-pix_fmt".into(),
        "yuv420p".into(),
        // Q2: the filter chain forces RGB->YUV without tagging the result.
        // Untagged output gets decoded as BT.601 and looks washed out, so
        // these tags must always be present and must describe the pixels
        // that actually come out of the filter chain (see above).
        "-colorspace".into(),
        out_space.into(),
        "-color_primaries".into(),
        out_primaries.into(),
        "-color_trc".into(),
        out_transfer.into(),
        "-color_range".into(),
        out_range.into(),
        // Q1: audio is never re-encoded.
        "-c:a".into(),
        "copy".into(),
        // Q3: phone video is VFR; forcing CFR duplicates and drops frames.
        "-fps_mode".into(),
        "passthrough".into(),
        "-movflags".into(),
        "+faststart".into(),
        "-progress".into(),
        "pipe:1".into(),
        "-nostats".into(),
        job.output.to_string_lossy().into_owned(),
    ]);

    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ColorMeta, MediaInfo, Rational};
    use std::path::PathBuf;

    fn sdr_info() -> MediaInfo {
        MediaInfo {
            width: 1280,
            height: 720,
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
            rotation: 0,
            has_audio: true,
            audio_codec: Some("aac".into()),
            start_time: 0.0,
        }
    }

    fn hdr_info() -> MediaInfo {
        let mut i = sdr_info();
        i.color.transfer = Some("arib-std-b67".into());
        i
    }

    fn untagged_info() -> MediaInfo {
        let mut i = sdr_info();
        i.color = ColorMeta {
            space: None,
            primaries: None,
            transfer: None,
            range: None,
        };
        i
    }

    fn job() -> BurnJob {
        BurnJob {
            input: PathBuf::from("in.mp4"),
            ass: PathBuf::from("subs.ass"),
            fonts_dir: PathBuf::from("fonts"),
            output: PathBuf::from("out.mp4"),
            encoder: VideoEncoder::X264,
            crf: 16,
            preset: "slow".into(),
            tonemap: false,
            prefer_gpu_tonemap: false,
            trim: TrimRange::FULL,
            size: OutputSize::Source,
        }
    }

    #[test]
    fn uses_ass_filter_not_subtitles_filter() {
        let a = burn_args(&job(), &sdr_info()).join(" ");
        // The `ass` filter goes straight to libass. `subtitles` re-parses
        // through libavformat and loses style fidelity.
        assert!(a.contains("ass=subs.ass"));
        assert!(!a.contains("subtitles="));
        assert!(a.contains("fontsdir=fonts"));
        assert!(a.contains("shaping=complex"));
    }

    #[test]
    fn q1_audio_is_stream_copied_never_reencoded() {
        let a = burn_args(&job(), &sdr_info()).join(" ");
        assert!(a.contains("-c:a copy"));
        assert!(!a.contains("aac"));
        // The trailing ? makes audio optional so silent clips do not fail.
        assert!(a.contains("-map 0:a:0?"));
    }

    #[test]
    fn q2_output_is_explicitly_colour_tagged() {
        let a = burn_args(&job(), &sdr_info()).join(" ");
        // Without these the filter chain emits untagged output, players
        // assume BT.601, and the video looks washed out and green-shifted.
        assert!(a.contains("-colorspace bt709"));
        assert!(a.contains("-color_primaries bt709"));
        assert!(a.contains("-color_trc bt709"));
        assert!(a.contains("-color_range tv"));
    }

    #[test]
    fn q3_variable_frame_rate_is_preserved() {
        let a = burn_args(&job(), &sdr_info()).join(" ");
        assert!(a.contains("-fps_mode passthrough"));
        // Forcing an output rate duplicates and drops frames -> judder.
        assert!(!a.contains(" -r "));
    }

    #[test]
    fn defaults_to_quality_x264_settings() {
        let a = burn_args(&job(), &sdr_info()).join(" ");
        assert!(a.contains("-c:v libx264"));
        assert!(a.contains("-crf 16"));
        assert!(a.contains("-preset slow"));
        assert!(a.contains("-pix_fmt yuv420p"));
        assert!(a.contains("-movflags +faststart"));
        assert!(a.contains("-progress pipe:1"));
    }

    #[test]
    fn hardware_encoder_replaces_crf_with_its_own_rate_control() {
        let mut j = job();
        j.encoder = VideoEncoder::VideoToolbox;
        let a = burn_args(&j, &sdr_info()).join(" ");
        assert!(a.contains("-c:v h264_videotoolbox"));
        assert!(!a.contains("-crf"));
        assert!(!a.contains("-preset"));
    }

    #[test]
    fn hdr_source_defaults_to_the_cpu_tonemapper_not_libplacebo() {
        let mut j = job();
        j.tonemap = true;
        let a = burn_args(&j, &hdr_info()).join(" ");
        // libplacebo is Vulkan-only and macOS has no Vulkan driver, so it
        // hard-fails the burn there (VK_ERROR_INCOMPATIBLE_DRIVER). The
        // default tonemapper must be the portable one, or every HLG phone
        // clip fails on the primary platform.
        assert!(!a.contains("libplacebo"), "argv was: {a}");
        assert!(a.contains("zscale=t=linear:npl=100"));
        assert!(a.contains("tonemap=hable:desat=0"));
        assert!(a.contains("zscale=t=bt709:m=bt709:r=tv"));
    }

    #[test]
    fn cpu_tonemapper_runs_before_the_ass_filter() {
        let mut j = job();
        j.tonemap = true;
        let a = burn_args(&j, &hdr_info()).join(" ");
        let tm = a.find("zscale=t=linear").unwrap();
        let ass = a.find("ass=subs.ass").unwrap();
        // Tonemap must run before subtitles, or the text is tonemapped too
        // and comes out grey.
        assert!(tm < ass);
    }

    #[test]
    fn libplacebo_is_reachable_but_only_when_explicitly_opted_in() {
        let mut j = job();
        j.tonemap = true;
        j.prefer_gpu_tonemap = true;
        let a = burn_args(&j, &hdr_info()).join(" ");
        // Still the better tonemapper on hosts that actually have Vulkan.
        assert!(a.contains("libplacebo"));
        assert!(a.contains("tonemapping=bt.2390"));
        assert!(!a.contains("zscale"));
        let lib = a.find("libplacebo").unwrap();
        let ass = a.find("ass=subs.ass").unwrap();
        assert!(lib < ass);
    }

    #[test]
    fn opting_into_the_gpu_tonemapper_does_nothing_without_tonemap() {
        let mut j = job();
        j.tonemap = false;
        j.prefer_gpu_tonemap = true;
        let a = burn_args(&j, &hdr_info()).join(" ");
        assert!(!a.contains("libplacebo"));
        assert!(!a.contains("zscale"));
    }

    #[test]
    fn sdr_source_never_gets_a_tonemapper() {
        let mut j = job();
        j.tonemap = true;
        let a = burn_args(&j, &sdr_info()).join(" ");
        assert!(!a.contains("libplacebo"));
        assert!(!a.contains("zscale"));
        assert!(!a.contains("tonemap"));
    }

    #[test]
    fn hdr_source_with_tonemap_is_tagged_bt709_whichever_tonemapper_ran() {
        for prefer_gpu in [false, true] {
            let mut j = job();
            j.tonemap = true;
            j.prefer_gpu_tonemap = prefer_gpu;
            let a = burn_args(&j, &hdr_info()).join(" ");
            // Both chains genuinely convert to bt709/tv, so these tags are
            // truthful either way.
            assert!(a.contains("-colorspace bt709"));
            assert!(a.contains("-color_primaries bt709"));
            assert!(a.contains("-color_trc bt709"));
            assert!(a.contains("-color_range tv"));
        }
    }

    #[test]
    fn hdr_source_without_tonemap_keeps_its_own_transfer_tag() {
        let mut j = job();
        j.tonemap = false;
        let a = burn_args(&j, &hdr_info()).join(" ");
        // Regression test: nothing in the chain converts HLG/PQ pixels when
        // tonemap is off, so tagging them bt709 would make players decode
        // HDR values as SDR. The source's own transfer must survive.
        assert!(a.contains("-color_trc arib-std-b67"));
        assert!(!a.contains("-color_trc bt709"));
    }

    #[test]
    fn untagged_source_falls_back_to_bt709_tv() {
        let a = burn_args(&job(), &untagged_info()).join(" ");
        // Untagged HD footage is overwhelmingly BT.709; emitting a guessed
        // tag beats emitting none (the original untagged-output bug), and
        // all four flags must always be present as a complete set.
        assert!(a.contains("-colorspace bt709"));
        assert!(a.contains("-color_primaries bt709"));
        assert!(a.contains("-color_trc bt709"));
        assert!(a.contains("-color_range tv"));
    }

    #[test]
    fn hardware_encoders_never_leak_the_software_crf_or_preset() {
        // None of the hardware encoders take -crf: each has its own quality
        // knob (-q:v, -cq, -global_quality, -qp_i/-qp_p). Note this does NOT
        // assert "-preset never appears": h264_nvenc and h264_qsv have their
        // own, differently-scoped -preset option (nvenc's p1-p7 scale, qsv's
        // veryfast..veryslow) that is legitimately part of their own
        // rate-control tuning. What must never happen is the *software*
        // preset value ("slow", from job.preset) leaking into a hardware
        // encoder's argv.
        for (encoder, ffmpeg_name) in [
            (VideoEncoder::Nvenc, "h264_nvenc"),
            (VideoEncoder::Qsv, "h264_qsv"),
            (VideoEncoder::Amf, "h264_amf"),
        ] {
            let mut j = job();
            j.encoder = encoder;
            let a = burn_args(&j, &sdr_info()).join(" ");
            assert!(a.contains(&format!("-c:v {ffmpeg_name}")));
            assert!(!a.contains("-crf"));
            assert!(!a.contains("-preset slow"));
        }
    }

    #[test]
    fn nvenc_uses_its_own_quality_biased_rate_control() {
        let mut j = job();
        j.encoder = VideoEncoder::Nvenc;
        let a = burn_args(&j, &sdr_info()).join(" ");
        assert!(a.contains("-preset p7"));
        assert!(a.contains("-tune hq"));
        assert!(a.contains("-rc vbr"));
        assert!(a.contains("-cq 19"));
    }

    #[test]
    fn qsv_uses_its_own_quality_biased_rate_control() {
        let mut j = job();
        j.encoder = VideoEncoder::Qsv;
        let a = burn_args(&j, &sdr_info()).join(" ");
        assert!(a.contains("-global_quality 20"));
        assert!(a.contains("-preset veryslow"));
    }

    #[test]
    fn amf_uses_its_own_quality_biased_rate_control_and_has_no_preset() {
        let mut j = job();
        j.encoder = VideoEncoder::Amf;
        let a = burn_args(&j, &sdr_info()).join(" ");
        assert!(a.contains("-quality quality"));
        assert!(a.contains("-rc cqp"));
        assert!(a.contains("-qp_i 20"));
        assert!(a.contains("-qp_p 22"));
        // Unlike nvenc/qsv, h264_amf has no -preset option at all.
        assert!(!a.contains("-preset"));
    }

    #[test]
    fn an_untrimmed_full_size_job_emits_no_seek_and_no_scale() {
        let a = burn_args(&job(), &sdr_info());
        let joined = a.join(" ");
        assert!(!a.contains(&"-ss".to_string()), "{joined}");
        assert!(!a.contains(&"-t".to_string()), "{joined}");
        assert!(!joined.contains("scale="), "{joined}");
    }

    #[test]
    fn a_trim_seeks_after_the_input_so_the_clip_starts_at_zero() {
        let mut j = job();
        j.trim = TrimRange::new(4.0, Some(9.5));
        let a = burn_args(&j, &sdr_info());

        let ss = a.iter().position(|x| x == "-ss").expect("no -ss");
        let i = a.iter().position(|x| x == "-i").expect("no -i");
        // An input-side seek leaves the filtered video on source
        // timestamps while the copied audio rebases to zero -- four
        // seconds of desync on a clip cut from 4s, and subtitles addressed
        // to timestamps that never arrive. See TrimRange::seek_args.
        assert!(ss > i, "the seek must follow -i");
        assert_eq!(a[ss + 1], "4.000");

        // -t, not -to: the seek rebases the output clock to zero, so a
        // source-timeline endpoint would cut in the wrong place.
        let t = a.iter().position(|x| x == "-t").expect("no -t");
        assert_eq!(a[t + 1], "5.500");
        assert!(!a.contains(&"-to".to_string()));
    }

    #[test]
    fn a_trim_does_not_disturb_the_quality_flags() {
        let mut j = job();
        j.trim = TrimRange::new(1.0, Some(2.0));
        let a = burn_args(&j, &sdr_info()).join(" ");
        assert!(a.contains("-c:a copy"), "Q1 lost");
        assert!(a.contains("-fps_mode passthrough"), "Q3 lost");
        assert!(a.contains("-colorspace bt709"), "Q2 lost");
    }

    #[test]
    fn a_resize_scales_before_the_subtitles_are_drawn() {
        let mut j = job();
        j.size = OutputSize::Height(480);
        let a = burn_args(&j, &sdr_info()).join(" ");
        let scale = a.find("scale=852:480").expect("no scale filter");
        let ass = a.find("ass=subs.ass").expect("no ass filter");
        assert!(
            scale < ass,
            "subtitles must be rendered at the output size, not resampled with the picture"
        );
        assert!(a.contains("flags=lanczos"));
    }

    #[test]
    fn a_resize_on_an_hdr_source_still_tonemaps_first() {
        let mut j = job();
        j.tonemap = true;
        j.size = OutputSize::Height(480);
        let a = burn_args(&j, &hdr_info()).join(" ");
        let tonemap = a.find("tonemap=hable").expect("no tonemapper");
        let scale = a.find("scale=852:480").expect("no scale filter");
        let ass = a.find("ass=subs.ass").expect("no ass filter");
        assert!(tonemap < scale && scale < ass, "{a}");
    }

    #[test]
    fn a_target_matching_the_source_adds_no_filter() {
        let mut j = job();
        j.size = OutputSize::Height(720);
        assert!(!burn_args(&j, &sdr_info()).join(" ").contains("scale="));
    }

    #[test]
    fn a_rotated_source_is_scaled_against_its_display_dimensions() {
        // Stored 1280x720 with a 90-degree flag displays as 720x1280, so
        // fitting height 640 must give 360x640, not 1138x640.
        let mut i = sdr_info();
        i.rotation = 90;
        let mut j = job();
        j.size = OutputSize::Height(640);
        assert!(burn_args(&j, &i).join(" ").contains("scale=360:640"));
    }
}
