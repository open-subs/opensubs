//! The browser's view of the OpenSubs engine.
//!
//! Kept deliberately thin, following `opencapture`'s `shot-core::wasm`: every
//! function here marshals JSON in and out of the pure crates and holds no
//! logic of its own. If something here needs a decision made, the decision
//! belongs in `subs-subtitle`, `subs-style`, `subs-media`, `subs-translate`
//! or `subs-tier`, where it is already covered by native tests — the web app
//! and the desktop app must never be able to disagree about how a line
//! breaks, what a style renders as, or which features are gated.
//!
//! # What is deliberately absent
//!
//! No ASR and no encoding. Both need a real process (`whisper.cpp`, ffmpeg)
//! and neither exists in a browser, so the web app supplies them itself:
//! speech recognition in JS, and the burn either handed off to the desktop
//! app / CLI or performed by a wasm libass + WebCodecs path in the page. The
//! seam is drawn here on purpose — everything that is pure computation is
//! shared Rust, everything that needs a platform is the host's problem.
//!
//! # The boundary is JSON
//!
//! Structured values cross as JSON strings rather than as `serde-wasm-bindgen`
//! objects. It is one fewer dependency, it is trivially inspectable in a
//! devtools console, and every payload here is small — a transcript is
//! thousands of numbers, not megabytes of pixels.

use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use subs_asr::Transcript;
use subs_media::{burn_args, BurnJob, ColorMeta, MediaInfo, OutputSize, Rational, TrimRange};
use subs_style::StyleTemplate;
use subs_subtitle::{parse_subtitles, segment, to_srt, to_vtt, Cue, SegmentConfig};

/// Route panics to `console.error` instead of an opaque `unreachable`
/// trap. Idempotent, and safe to call from every entry point.
#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

/// Errors cross the boundary as plain `String`s, which wasm-bindgen turns
/// into thrown JS strings.
///
/// The obvious choice is `JsValue`, and it is wrong here: `JsValue` cannot
/// be constructed outside a wasm runtime, so every error path would be
/// unreachable from `cargo test` and this module's failure behaviour could
/// only be checked in a browser. `String` keeps the whole surface — success
/// *and* failure — under the same fast native test run as the rest of the
/// engine.
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

fn to_json<T: Serialize>(value: &T) -> Result<String, String> {
    serde_json::to_string(value).map_err(err)
}

fn from_json<T: for<'de> Deserialize<'de>>(json: &str, what: &str) -> Result<T, String> {
    serde_json::from_str(json).map_err(|e| err(format!("could not read {what}: {e}")))
}

/// The engine version, so the page can show what it is actually running.
#[wasm_bindgen(js_name = version)]
pub fn version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

// ---------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------

/// One preset, flattened for a picker.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct StyleSummary {
    name: String,
    pack: String,
    font: String,
    size_pct: f64,
    alignment: u8,
    primary_hex: String,
    back_hex: String,
    border_style: String,
}

fn hex(c: subs_style::Rgba) -> String {
    format!("#{:02x}{:02x}{:02x}", c.r, c.g, c.b)
}

fn summarize(s: &StyleTemplate) -> StyleSummary {
    StyleSummary {
        name: s.name.clone(),
        pack: subs_style::pack_of(&s.name)
            .map_or("Custom", subs_style::Pack::label)
            .to_string(),
        font: s.font.clone(),
        size_pct: s.size_pct,
        alignment: s.alignment,
        primary_hex: hex(s.primary),
        back_hex: hex(s.back_color),
        border_style: match s.border_style {
            subs_style::BorderStyle::OutlineShadow => "outline".into(),
            subs_style::BorderStyle::OpaqueBox => "box".into(),
        },
    }
}

/// Every shipped preset, both packs, as a JSON array.
#[wasm_bindgen(js_name = presets)]
pub fn presets_js() -> Result<String, String> {
    let all: Vec<StyleSummary> = subs_style::all_presets().iter().map(summarize).collect();
    to_json(&all)
}

/// One preset as an editable template document.
#[wasm_bindgen(js_name = styleTemplate)]
pub fn style_template(name: &str) -> Result<String, String> {
    subs_style::preset_by_name(name)
        .map(|t| subs_style::to_json_string(&t))
        .ok_or_else(|| err(format!("no preset named '{name}'")))
}

/// Validate a hand-edited template. Returns the normalised document, or an
/// error naming the offending field.
#[wasm_bindgen(js_name = validateStyle)]
pub fn validate_style(json: &str) -> Result<String, String> {
    let template = subs_style::from_json_str(json).map_err(err)?;
    Ok(subs_style::to_json_string(&template))
}

fn resolve_style(style: &str) -> Result<StyleTemplate, String> {
    // A preset name or a full template document — the page does not have to
    // know which it is holding.
    if let Some(preset) = subs_style::preset_by_name(style) {
        return Ok(preset);
    }
    subs_style::from_json_str(style).map_err(|e| {
        err(format!(
            "'{style}' is not a preset name, and not a valid template: {e}"
        ))
    })
}

// ---------------------------------------------------------------------
// Cues in, cues out
// ---------------------------------------------------------------------

/// Read an existing `.srt` or `.vtt`. Format is detected from content.
#[wasm_bindgen(js_name = parseSubtitles)]
pub fn parse_subtitles_js(text: &str) -> Result<String, String> {
    to_json(&parse_subtitles(text).map_err(err)?)
}

/// Turn word-level ASR output into reading-comfortable cues.
///
/// `fps_num`/`fps_den` are the video's frame rate as an exact rational, so
/// cue boundaries land on real frames. 30/1 is a safe default when the page
/// cannot determine it — a `<video>` element does not expose frame rate.
#[wasm_bindgen(js_name = segmentTranscript)]
pub fn segment_transcript(
    transcript_json: &str,
    fps_num: u32,
    fps_den: u32,
) -> Result<String, String> {
    let transcript: Transcript = from_json(transcript_json, "the transcript")?;
    let fps = Rational {
        num: fps_num.max(1),
        den: fps_den.max(1),
    };
    to_json(&segment(&transcript, fps, &SegmentConfig::default()))
}

/// Build a transcript from segment-level ASR output, synthesising word
/// timings the same way the desktop does.
///
/// Browser Whisper reports sentences, not words -- the small quantised ONNX
/// exports are not built with the cross-attentions word timestamps need.
/// The desktop's `af_whisper` has exactly the same limitation, so both go
/// through one shared synthesis rather than each inventing its own, which
/// is what keeps the two front ends breaking lines identically.
#[wasm_bindgen(js_name = transcriptFromSegments)]
pub fn transcript_from_segments_js(segments_json: &str, language: &str) -> Result<String, String> {
    let segments: Vec<subs_asr::Segment> = from_json(segments_json, "the segments")?;
    to_json(&subs_asr::transcript_from_segments(segments, language))
}

#[wasm_bindgen(js_name = toSrt)]
pub fn to_srt_js(cues_json: &str) -> Result<String, String> {
    let cues: Vec<Cue> = from_json(cues_json, "the cues")?;
    Ok(to_srt(&cues))
}

#[wasm_bindgen(js_name = toVtt)]
pub fn to_vtt_js(cues_json: &str) -> Result<String, String> {
    let cues: Vec<Cue> = from_json(cues_json, "the cues")?;
    Ok(to_vtt(&cues))
}

/// Render cues to an ASS document at a given display size.
///
/// `play_w`/`play_h` must be the dimensions the subtitles will actually be
/// composited at. Getting this wrong is the single most common cause of
/// soft, mis-scaled subtitles (design spec §3.4), and it is why the page
/// passes the video's real `videoWidth`/`videoHeight` rather than the size
/// of the element on screen.
#[wasm_bindgen(js_name = toAss)]
pub fn to_ass_js(cues_json: &str, style: &str, play_w: u32, play_h: u32) -> Result<String, String> {
    let cues: Vec<Cue> = from_json(cues_json, "the cues")?;
    let template = resolve_style(style)?;
    Ok(subs_style::to_ass(
        &cues,
        &template,
        (play_w.max(2), play_h.max(2)),
    ))
}

/// Render cues to ASS with per-word size emphasis driven by the audio.
///
/// `emphasis_json` is an array-of-arrays: one array per cue, one value per
/// whitespace-separated word, each 0..1 where 1 is the loudest moment of
/// the clip. `strength` scales the effect and is capped by the engine.
///
/// A cue whose word count does not match its levels renders unemphasised
/// rather than shifting the emphasis onto the wrong word.
#[wasm_bindgen(js_name = toAssEmphasised)]
pub fn to_ass_emphasised_js(
    cues_json: &str,
    style: &str,
    play_w: u32,
    play_h: u32,
    emphasis_json: &str,
    strength: f64,
) -> Result<String, String> {
    let cues: Vec<Cue> = from_json(cues_json, "the cues")?;
    let emphasis: Vec<Vec<f32>> = from_json(emphasis_json, "the emphasis levels")?;
    let template = resolve_style(style)?;
    Ok(subs_style::ass::to_ass_emphasised(
        &cues,
        &template,
        (play_w.max(2), play_h.max(2)),
        &emphasis,
        strength,
    ))
}

/// Render two languages in one cue, each at its own size.
///
/// `top_json` and `bottom_json` are cue arrays of equal length carrying
/// the same timings in two languages; the caller decides which language
/// goes on top. Scales are fractions of the style's own size and are
/// clamped by the engine.
///
/// This exists because the page cannot do it: cue text is escaped on the
/// way into a Dialogue line, so an override written into the text arrives
/// as literal `\{` -- which is exactly the protection that stops a
/// subtitle file restyling the video, and not something to route around.
#[wasm_bindgen(js_name = toAssBilingual)]
pub fn to_ass_bilingual_js(
    top_json: &str,
    bottom_json: &str,
    style: &str,
    play_w: u32,
    play_h: u32,
    top_scale: f64,
    bottom_scale: f64,
) -> Result<String, String> {
    let top: Vec<Cue> = from_json(top_json, "the cues")?;
    let bottom: Vec<Cue> = from_json(bottom_json, "the second language's cues")?;
    let template = resolve_style(style)?;
    Ok(subs_style::ass::to_ass_bilingual(
        &top,
        &bottom,
        &template,
        (play_w.max(2), play_h.max(2)),
        top_scale,
        bottom_scale,
    ))
}

/// Both languages as one cue list, for the `.srt` and `.vtt` exports.
///
/// The page could concatenate the two line lists itself, and did. It must
/// not: the ASS writer undoes a machine's line wrap before stacking the
/// languages, so a caller merging them by hand puts a three-line cue in
/// the text export and a two-line one in the burned video. One function,
/// one answer.
#[wasm_bindgen(js_name = mergeBilingual)]
pub fn merge_bilingual_js(top_json: &str, bottom_json: &str) -> Result<String, String> {
    let top: Vec<Cue> = from_json(top_json, "the cues")?;
    let bottom: Vec<Cue> = from_json(bottom_json, "the second language's cues")?;
    to_json(&subs_style::merge_bilingual(&top, &bottom))
}

/// The smallest a supporting bilingual line may be set, as a fraction.
#[wasm_bindgen(js_name = minBilingualScale)]
pub fn min_bilingual_scale() -> f64 {
    subs_style::ass::MIN_BILINGUAL_SCALE
}

/// The largest emphasis the engine will apply, whatever is requested.
#[wasm_bindgen(js_name = maxEmphasisStrength)]
pub fn max_emphasis_strength() -> f64 {
    subs_style::ass::MAX_EMPHASIS_STRENGTH
}

/// Render cues so each word grows and glows at the moment it is spoken.
///
/// Unlike [`to_ass_emphasised_js`] this is driven by time rather than by
/// loudness, so it needs no audio and works on imported subtitles too.
/// `accent` is the glow colour as `#RRGGBB`.
#[wasm_bindgen(js_name = toAssKaraoke)]
pub fn to_ass_karaoke_js(
    cues_json: &str,
    style: &str,
    play_w: u32,
    play_h: u32,
    strength: f64,
    glow: f64,
    accent: &str,
) -> Result<String, String> {
    let cues: Vec<Cue> = from_json(cues_json, "the cues")?;
    let template = resolve_style(style)?;
    let colour = subs_style::Rgba::from_hex(accent)
        .ok_or_else(|| format!("{accent} is not a #RRGGBB colour"))?;
    Ok(subs_style::ass::to_ass_karaoke(
        &cues,
        &template,
        (play_w.max(2), play_h.max(2)),
        strength,
        glow,
        colour,
    ))
}

/// Karaoke on one language of a bilingual cue, the other drawn plainly.
///
/// `effect_on_top` says which half was spoken. It is not a style choice:
/// word timings come from the audio the transcript was made of, so the
/// highlight belongs to the original whichever way round the two are
/// stacked. The effects used to switch off entirely when both languages
/// were shown, which threw away the half that *was* timed.
#[wasm_bindgen(js_name = toAssBilingualKaraoke)]
#[allow(clippy::too_many_arguments)]
pub fn to_ass_bilingual_karaoke_js(
    top_json: &str,
    bottom_json: &str,
    style: &str,
    play_w: u32,
    play_h: u32,
    top_scale: f64,
    bottom_scale: f64,
    effect_on_top: bool,
    strength: f64,
    glow: f64,
    accent: &str,
) -> Result<String, String> {
    let top: Vec<Cue> = from_json(top_json, "the cues")?;
    let bottom: Vec<Cue> = from_json(bottom_json, "the second language's cues")?;
    let template = resolve_style(style)?;
    let colour = subs_style::Rgba::from_hex(accent)
        .ok_or_else(|| format!("{accent} is not a #RRGGBB colour"))?;
    Ok(subs_style::ass::to_ass_bilingual_karaoke(
        &top,
        &bottom,
        &template,
        (play_w.max(2), play_h.max(2)),
        top_scale,
        bottom_scale,
        effect_side(effect_on_top),
        strength,
        glow,
        colour,
    ))
}

/// Loudness emphasis on one language of a bilingual cue.
///
/// The levels belong to the language `effect_on_top` names -- the one the
/// audio was measured against.
#[wasm_bindgen(js_name = toAssBilingualEmphasised)]
#[allow(clippy::too_many_arguments)]
pub fn to_ass_bilingual_emphasised_js(
    top_json: &str,
    bottom_json: &str,
    style: &str,
    play_w: u32,
    play_h: u32,
    top_scale: f64,
    bottom_scale: f64,
    effect_on_top: bool,
    emphasis_json: &str,
    strength: f64,
) -> Result<String, String> {
    let top: Vec<Cue> = from_json(top_json, "the cues")?;
    let bottom: Vec<Cue> = from_json(bottom_json, "the second language's cues")?;
    let emphasis: Vec<Vec<f32>> = from_json(emphasis_json, "the loudness levels")?;
    let template = resolve_style(style)?;
    Ok(subs_style::ass::to_ass_bilingual_emphasised(
        &top,
        &bottom,
        &template,
        (play_w.max(2), play_h.max(2)),
        top_scale,
        bottom_scale,
        effect_side(effect_on_top),
        &emphasis,
        strength,
    ))
}

fn effect_side(on_top: bool) -> subs_style::EffectOn {
    if on_top {
        subs_style::EffectOn::Top
    } else {
        subs_style::EffectOn::Bottom
    }
}

/// The strongest glow the engine will apply, whatever is requested.
#[wasm_bindgen(js_name = maxGlow)]
pub fn max_glow() -> f64 {
    subs_style::ass::MAX_GLOW
}

// ---------------------------------------------------------------------
// Credits
// ---------------------------------------------------------------------

/// What translating these lines on our own backend will cost, in credits.
///
/// `lines_json` is an array of strings — the subtitle text as it will be
/// sent. The result is a [`subs_credits::Quote`] as JSON; the interface
/// should show `credits` and nothing else.
///
/// Quoted here rather than server-side on purpose. The price appears before
/// the user commits, with no round trip and no account needed to see it,
/// and the backend recomputes the identical number from the identical code
/// when it charges — so the two cannot disagree.
#[wasm_bindgen(js_name = quoteTranslation)]
pub fn quote_translation_js(lines_json: &str, target: &str) -> Result<String, String> {
    let lines: Vec<String> = from_json(lines_json, "the lines")?;
    let quote = subs_translate::pricing::quote_translation(
        &lines,
        target,
        subs_credits::Rates::DEEPSEEK_CHAT,
    );
    to_json(&quote)
}

/// What transcribing `seconds` of audio on our own backend costs, in
/// credits. Billed on the trimmed span, which is all that gets sent.
#[wasm_bindgen(js_name = quoteTranscription)]
pub fn quote_transcription_js(seconds: f64) -> Result<String, String> {
    to_json(&subs_credits::quote_audio(
        seconds,
        subs_credits::AudioRates::HOSTED_WHISPER,
    ))
}

/// What one credit is worth in USD, and what a pack costs.
///
/// Exposed so the interface can print a dollar figure beside every quote
/// from the same constant the pricing uses, rather than keeping its own
/// copy that quietly goes stale.
#[wasm_bindgen(js_name = creditPricing)]
pub fn credit_pricing_js() -> Result<String, String> {
    to_json(&serde_json::json!({
        "credit_usd": subs_credits::CREDIT_USD,
        "pack_credits": subs_credits::PACK_CREDITS,
        "pack_usd": subs_credits::pack_usd(),
    }))
}

// ---------------------------------------------------------------------
// Clip and output size
// ---------------------------------------------------------------------

/// Why a clip cannot be exported, or an empty string if it can.
#[wasm_bindgen(js_name = trimError)]
pub fn trim_error(start: f64, end: f64, source_duration: f64) -> String {
    let range = TrimRange::new(start, positive_or_none(end));
    match range.validate(source_duration) {
        Ok(()) => String::new(),
        Err(e) => e.to_string(),
    }
}

/// How long the exported clip runs, for progress and for the UI.
#[wasm_bindgen(js_name = clipDuration)]
pub fn clip_duration(start: f64, end: f64, source_duration: f64) -> f64 {
    TrimRange::new(start, positive_or_none(end)).clip_duration(source_duration)
}

/// The dimensions an export would actually encode at, as `[w, h]`.
#[wasm_bindgen(js_name = resolveSize)]
pub fn resolve_size(display_w: u32, display_h: u32, target_height: u32) -> Vec<u32> {
    let size = if target_height == 0 {
        OutputSize::Source
    } else {
        OutputSize::Height(target_height)
    };
    let (w, h) = size.resolve((display_w, display_h));
    vec![w, h]
}

/// JS has no `Option<f64>`; a non-positive end means "to the end".
fn positive_or_none(end: f64) -> Option<f64> {
    (end.is_finite() && end > 0.0).then_some(end)
}

// ---------------------------------------------------------------------
// Handing the burn off to a real encoder
// ---------------------------------------------------------------------

/// What the page knows about the video and the export it wants.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BurnRequest {
    /// The source file's name, as the user would type it locally.
    input: String,
    output: String,
    /// `videoWidth`/`videoHeight` from the element: already display
    /// dimensions, since the browser has applied any rotation.
    width: u32,
    height: u32,
    duration: f64,
    #[serde(default)]
    fps: f64,
    #[serde(default)]
    style: String,
    #[serde(default)]
    start: f64,
    #[serde(default)]
    end: f64,
    /// 0 means the source's own height.
    #[serde(default)]
    target_height: u32,
    #[serde(default)]
    ass_path: String,
}

impl BurnRequest {
    fn trim(&self) -> TrimRange {
        TrimRange::new(self.start, positive_or_none(self.end))
    }

    fn size(&self) -> OutputSize {
        if self.target_height == 0 {
            OutputSize::Source
        } else {
            OutputSize::Height(self.target_height)
        }
    }

    /// A `MediaInfo` from what a browser can actually observe.
    ///
    /// Colour is left entirely unknown rather than guessed. `burn_args`
    /// falls back to BT.709 for untagged input, which is the right guess
    /// for the HD footage this path sees — but note the `opensubs burn`
    /// command below is the recommended route precisely because it probes
    /// the real file instead of guessing.
    fn media_info(&self) -> MediaInfo {
        let fps = if self.fps > 0.0 {
            // Exact rationals from the common broadcast rates; anything
            // else is expressed in thousandths, which is exact enough for
            // frame snapping and never introduces a repeating decimal.
            approximate_rational(self.fps)
        } else {
            Rational { num: 30, den: 1 }
        };
        MediaInfo {
            width: self.width,
            height: self.height,
            fps,
            duration: self.duration,
            pix_fmt: "yuv420p".into(),
            video_codec: None,
            color: ColorMeta {
                space: None,
                primaries: None,
                transfer: None,
                range: None,
            },
            // The browser has already applied the display matrix, so the
            // dimensions above are the upright ones.
            rotation: 0,
            has_audio: true,
            audio_codec: None,
            start_time: 0.0,
        }
    }
}

/// Nearest exact rational for a frame rate a browser reported as a float.
///
/// 29.97 must become 30000/1001, not 2997/100: frame snapping divides by
/// this, and a rate that is off by a part in ten thousand walks a cue
/// boundary off the frame grid over a long clip.
fn approximate_rational(fps: f64) -> Rational {
    const NTSC: &[(u32, u32, f64)] = &[
        (24000, 1001, 23.976),
        (30000, 1001, 29.97),
        (60000, 1001, 59.94),
        (120000, 1001, 119.88),
    ];
    for (num, den, approx) in NTSC {
        if (fps - approx).abs() < 0.01 {
            return Rational {
                num: *num,
                den: *den,
            };
        }
    }
    if (fps - fps.round()).abs() < 1e-6 {
        return Rational {
            num: fps.round().max(1.0) as u32,
            den: 1,
        };
    }
    Rational {
        num: (fps * 1000.0).round().max(1.0) as u32,
        den: 1000,
    }
}

/// The `opensubs burn` command that reproduces this export locally.
///
/// This, rather than a raw ffmpeg line, is what the page offers first: the
/// CLI probes the actual file, so it gets colour tags, rotation, VFR and
/// HDR right, none of which a browser can see. The ffmpeg command below is
/// the fallback for someone who does not have OpenSubs installed.
#[wasm_bindgen(js_name = cliCommand)]
pub fn cli_command(request_json: &str) -> Result<String, String> {
    let r: BurnRequest = from_json(request_json, "the burn request")?;
    let mut parts = vec![
        "opensubs".to_string(),
        "burn".to_string(),
        shell_quote(&r.input),
    ];

    if !r.output.is_empty() {
        parts.push("-o".into());
        parts.push(shell_quote(&r.output));
    }
    if !r.style.is_empty() && subs_style::preset_by_name(&r.style).is_some() {
        parts.push("--style".into());
        parts.push(shell_quote(&r.style));
    }
    if r.start > 0.0 {
        parts.push("--start".into());
        parts.push(format!("{:.3}", r.start));
    }
    if let Some(end) = positive_or_none(r.end) {
        parts.push("--end".into());
        parts.push(format!("{end:.3}"));
    }
    if r.target_height > 0 {
        parts.push("--height".into());
        parts.push(r.target_height.to_string());
    }
    // The model is required by the CLI and is a local path the page cannot
    // know, so it is left as an obvious placeholder rather than omitted --
    // a command that silently fails to parse is worse than one that shows
    // you what to fill in.
    parts.push("--model".into());
    parts.push("<path-to-whisper-model.bin>".into());

    Ok(parts.join(" "))
}

/// The raw ffmpeg command for the same export, burning an ASS file the page
/// has already produced.
#[wasm_bindgen(js_name = ffmpegCommand)]
pub fn ffmpeg_command(request_json: &str) -> Result<String, String> {
    let r: BurnRequest = from_json(request_json, "the burn request")?;
    let info = r.media_info();
    let ass = if r.ass_path.is_empty() {
        "subs.ass".to_string()
    } else {
        r.ass_path.clone()
    };

    let argv = burn_args(
        &BurnJob {
            input: r.input.clone().into(),
            ass: ass.into(),
            fonts_dir: ".".into(),
            output: r.output.clone().into(),
            encoder: subs_media::VideoEncoder::X264,
            crf: 16,
            preset: "slow".into(),
            tonemap: true,
            prefer_gpu_tonemap: false,
            trim: r.trim(),
            size: r.size(),
        },
        &info,
    );

    let quoted: Vec<String> = argv.iter().map(|a| shell_quote(a)).collect();
    Ok(format!("ffmpeg {}", quoted.join(" ")))
}

/// Single-quote an argument for a POSIX shell, so a filename with a space
/// or a quote in it does not silently produce a different command.
fn shell_quote(arg: &str) -> String {
    if !arg.is_empty()
        && arg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./=:".contains(c))
    {
        return arg.to_string();
    }
    format!("'{}'", arg.replace('\'', r"'\''"))
}

// ---------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------

/// The offered target languages.
#[wasm_bindgen(js_name = languages)]
pub fn languages_js() -> Result<String, String> {
    #[derive(Serialize)]
    struct Lang {
        code: String,
        name: String,
        endonym: String,
    }
    let list: Vec<Lang> = subs_translate::languages()
        .iter()
        .map(|l| Lang {
            code: l.code.to_string(),
            name: l.name.to_string(),
            endonym: l.endonym.to_string(),
        })
        .collect();
    to_json(&list)
}

/// How many cues go in one translation request.
#[wasm_bindgen(js_name = translationBatchSize)]
pub fn translation_batch_size() -> usize {
    subs_translate::MAX_BATCH
}

/// Build the Claude Messages API request body for one batch of cue text.
///
/// The page performs the `fetch` itself — a browser has one, and linking an
/// HTTP client into wasm to duplicate it would be silly — but the prompt,
/// the schema and the batching rules stay here so the two front ends ask
/// for exactly the same thing.
#[wasm_bindgen(js_name = translateRequestBody)]
pub fn translate_request_body(
    texts_json: &str,
    target: &str,
    source: &str,
) -> Result<String, String> {
    let texts: Vec<String> = from_json(texts_json, "the lines to translate")?;
    let mut req = subs_translate::TranslateRequest::to(target);
    if !source.is_empty() && !source.eq_ignore_ascii_case("auto") {
        req.source = Some(source.to_string());
    }
    let body =
        subs_translate::claude::build_request(&texts, &req, subs_translate::claude::DEFAULT_MODEL);
    Ok(body.to_string())
}

/// Pull the translations out of a Claude response body, enforcing that the
/// count matches — a short response would otherwise desynchronise every
/// later cue against its timestamp.
#[wasm_bindgen(js_name = parseTranslateResponse)]
pub fn parse_translate_response(body: &str, expected: usize) -> Result<String, String> {
    let out = subs_translate::claude::parse_response(body, expected).map_err(err)?;
    to_json(&out)
}

/// Put fetched translations onto their cues, re-wrapping each to the target
/// script's line budget and leaving every timestamp untouched.
#[wasm_bindgen(js_name = applyTranslations)]
pub fn apply_translations_js(cues_json: &str, translations_json: &str) -> Result<String, String> {
    let cues: Vec<Cue> = from_json(cues_json, "the cues")?;
    let translations: Vec<String> = from_json(translations_json, "the translations")?;
    let out = subs_translate::apply_translations(&cues, &translations).map_err(err)?;
    to_json(&out)
}

// ---------------------------------------------------------------------
// Tiers
// ---------------------------------------------------------------------

/// What is free, what is premium, and what this build gates.
#[wasm_bindgen(js_name = features)]
pub fn features_js() -> Result<String, String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Feature {
        id: String,
        title: String,
        tier: String,
        cost: String,
        cost_label: String,
        cost_note: String,
        why: String,
        unlocked: bool,
    }
    let list: Vec<Feature> = subs_tier::catalog()
        .into_iter()
        .map(|f| Feature {
            id: f.id.to_string(),
            title: f.title.to_string(),
            tier: f.tier.label().to_string(),
            cost: serde_json::to_value(f.cost)
                .ok()
                .and_then(|v| v.as_str().map(str::to_string))
                .unwrap_or_default(),
            cost_label: f.cost.label().to_string(),
            cost_note: f.cost.explanation().to_string(),
            why: f.why.to_string(),
            unlocked: f.unlocked,
        })
        .collect();
    to_json(&list)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cues_json() -> String {
        r#"[{"start":0.0,"end":2.0,"lines":["Hello world"]},
            {"start":2.5,"end":4.0,"lines":["Second cue"]}]"#
            .to_string()
    }

    #[test]
    fn presets_reach_the_page_with_their_pack() {
        let json = presets_js().unwrap();
        assert!(json.contains("\"name\":\"Clean\""));
        assert!(json.contains("\"pack\":\"Core\""));
        assert!(json.contains("\"pack\":\"Advanced\""));
        assert!(json.contains("primaryHex"));
    }

    #[test]
    fn a_style_can_be_a_preset_name_or_a_whole_template() {
        let by_name = to_ass_js(&cues_json(), "Neon", 1920, 1080).unwrap();
        let template = style_template("Neon").unwrap();
        let by_template = to_ass_js(&cues_json(), &template, 1920, 1080).unwrap();
        assert_eq!(by_name, by_template);
        assert!(by_name.contains("PlayResX: 1920"));
    }

    #[test]
    fn an_unknown_style_says_so_rather_than_falling_back() {
        // Silently substituting a default would ship the wrong look.
        assert!(to_ass_js(&cues_json(), "NoSuchStyle", 1920, 1080).is_err());
    }

    #[test]
    fn subtitle_files_round_trip_through_the_browser_surface() {
        let srt = to_srt_js(&cues_json()).unwrap();
        let back = parse_subtitles_js(&srt).unwrap();
        let original: Vec<Cue> = serde_json::from_str(&cues_json()).unwrap();
        let parsed: Vec<Cue> = serde_json::from_str(&back).unwrap();
        assert_eq!(parsed, original);
    }

    #[test]
    fn a_transcript_segments_into_cues() {
        let transcript = r#"{"language":"en","duration":3.0,"words":[
            {"start":0.0,"end":0.4,"text":"Hello","confidence":1.0},
            {"start":0.5,"end":1.0,"text":"world","confidence":1.0}],"segments":[]}"#;
        let cues: Vec<Cue> =
            serde_json::from_str(&segment_transcript(transcript, 30, 1).unwrap()).unwrap();
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text(), "Hello world");
    }

    #[test]
    fn a_zero_frame_rate_cannot_divide_by_zero() {
        let transcript = r#"{"language":"en","duration":1.0,"words":[
            {"start":0.0,"end":0.4,"text":"Hi","confidence":1.0}],"segments":[]}"#;
        assert!(segment_transcript(transcript, 0, 0).is_ok());
    }

    #[test]
    fn ntsc_rates_become_exact_rationals_rather_than_decimals() {
        assert_eq!(
            approximate_rational(29.97),
            Rational {
                num: 30000,
                den: 1001
            }
        );
        assert_eq!(
            approximate_rational(23.976),
            Rational {
                num: 24000,
                den: 1001
            }
        );
        assert_eq!(approximate_rational(30.0), Rational { num: 30, den: 1 });
        assert_eq!(approximate_rational(25.0), Rational { num: 25, den: 1 });
    }

    #[test]
    fn trim_reporting_matches_the_engine() {
        assert_eq!(trim_error(1.0, 4.0, 10.0), "");
        assert!(!trim_error(9.0, 4.0, 10.0).is_empty());
        assert!(!trim_error(99.0, 0.0, 10.0).is_empty());
        assert_eq!(clip_duration(1.0, 4.0, 10.0), 3.0);
        // A non-positive end means "to the end of the source".
        assert_eq!(clip_duration(1.0, 0.0, 10.0), 9.0);
    }

    #[test]
    fn resolve_size_keeps_the_aspect_ratio_and_stays_even() {
        assert_eq!(resolve_size(1920, 1080, 720), vec![1280, 720]);
        assert_eq!(resolve_size(1920, 1080, 0), vec![1920, 1080]);
        let odd = resolve_size(1080, 2340, 720);
        assert_eq!(odd[0] % 2, 0);
    }

    fn burn_request() -> String {
        r#"{"input":"my clip.mp4","output":"out.mp4","width":1920,"height":1080,
            "duration":30.0,"fps":29.97,"style":"Neon","start":4.0,"end":10.0,
            "targetHeight":720,"assPath":"subs.ass"}"#
            .to_string()
    }

    #[test]
    fn the_cli_command_carries_every_choice_the_page_made() {
        let cmd = cli_command(&burn_request()).unwrap();
        assert!(cmd.starts_with("opensubs burn "));
        assert!(cmd.contains("--style Neon"));
        assert!(cmd.contains("--start 4.000"));
        assert!(cmd.contains("--end 10.000"));
        assert!(cmd.contains("--height 720"));
        assert!(cmd.contains("--model"));
    }

    #[test]
    fn filenames_with_spaces_or_quotes_are_quoted_for_the_shell() {
        let cmd = cli_command(&burn_request()).unwrap();
        assert!(cmd.contains("'my clip.mp4'"), "{cmd}");

        assert_eq!(shell_quote("plain.mp4"), "plain.mp4");
        assert_eq!(shell_quote("with space.mp4"), "'with space.mp4'");
        assert_eq!(shell_quote("it's.mp4"), r"'it'\''s.mp4'");
        assert_eq!(shell_quote(""), "''");
    }

    #[test]
    fn the_ffmpeg_command_is_the_engines_own_argv() {
        let cmd = ffmpeg_command(&burn_request()).unwrap();
        assert!(cmd.starts_with("ffmpeg "));
        // The quality flags the engine insists on, not a hand-written line.
        assert!(cmd.contains("-c:a copy"));
        assert!(cmd.contains("-fps_mode passthrough"));
        assert!(cmd.contains("ass=subs.ass"));
        assert!(cmd.contains("scale=1280:720"));
        // Output-side seek, as the trim module requires.
        let ss = cmd.find("-ss").unwrap();
        let i = cmd.find(" -i ").unwrap();
        assert!(ss > i, "{cmd}");
    }

    #[test]
    fn translation_request_and_response_use_the_shared_prompt_and_schema() {
        let body = translate_request_body(r#"["Hello","World"]"#, "ja", "auto").unwrap();
        assert!(body.contains("claude-opus-5"));
        assert!(body.contains("json_schema"));
        assert!(body.contains("Japanese"));
        // "auto" is not a real source language and must not be claimed.
        assert!(!body.contains("from auto"));

        let response = r#"{"stop_reason":"end_turn","content":[{"type":"text",
            "text":"{\"translations\":[\"こんにちは\",\"世界\"]}"}]}"#;
        let out = parse_translate_response(response, 2).unwrap();
        assert!(out.contains("こんにちは"));
        assert!(parse_translate_response(response, 3).is_err());
    }

    #[test]
    fn translations_land_on_their_cues_without_moving_a_timestamp() {
        let out = apply_translations_js(&cues_json(), r#"["你好世界","第二"]"#).unwrap();
        let after: Vec<Cue> = serde_json::from_str(&out).unwrap();
        let before: Vec<Cue> = serde_json::from_str(&cues_json()).unwrap();
        assert_eq!(after.len(), before.len());
        for (a, b) in after.iter().zip(&before) {
            assert_eq!(a.start, b.start);
            assert_eq!(a.end, b.end);
        }
        assert_eq!(after[0].text(), "你好世界");
    }

    #[test]
    fn a_mismatched_translation_count_is_refused_at_the_boundary() {
        assert!(apply_translations_js(&cues_json(), r#"["only one"]"#).is_err());
    }

    #[test]
    fn the_feature_catalogue_reaches_the_page_fully_unlocked() {
        let json = features_js().unwrap();
        assert!(json.contains("\"tier\":\"Premium\""));
        assert!(json.contains("\"tier\":\"Free\""));
        assert!(!json.contains("\"unlocked\":false"));
    }

    #[test]
    fn the_catalogue_tells_the_page_what_each_row_costs() {
        let json = features_js().unwrap();
        assert!(json.contains("\"cost\":\"free\""), "{json}");
        assert!(json.contains("\"cost\":\"free-or-own-key\""), "{json}");
        assert!(json.contains("costLabel"));
        assert!(json.contains("costNote"));
    }

    #[test]
    fn malformed_json_from_the_page_is_an_error_not_a_panic() {
        assert!(to_srt_js("not json").is_err());
        assert!(segment_transcript("{}", 30, 1).is_err());
        assert!(cli_command("{").is_err());
        assert!(apply_translations_js("[]", "nope").is_err());
    }

    #[test]
    fn languages_and_batch_size_come_from_the_engine() {
        assert!(languages_js().unwrap().contains("zh-Hans"));
        assert_eq!(translation_batch_size(), subs_translate::MAX_BATCH);
    }

    #[test]
    fn segment_output_becomes_a_transcript_the_segmenter_can_use() {
        let segments = r#"[{"start":0.0,"end":2.0,"text":"hello world"},
                           {"start":2.5,"end":4.0,"text":"again"}]"#;
        let transcript = transcript_from_segments_js(segments, "en").unwrap();
        let cues: Vec<Cue> =
            serde_json::from_str(&segment_transcript(&transcript, 30, 1).unwrap()).unwrap();
        assert!(!cues.is_empty());
        assert!(cues[0].text().contains("hello"));
    }

    #[test]
    fn malformed_segments_are_an_error_rather_than_a_panic() {
        assert!(transcript_from_segments_js("nope", "en").is_err());
    }

    #[test]
    fn emphasis_reaches_the_ass_document() {
        let cues = r#"[{"start":0.0,"end":2.0,"lines":["quiet LOUD"]}]"#;
        let out = to_ass_emphasised_js(cues, "Clean", 1920, 1000, "[[0.0,1.0]]", 0.6).unwrap();
        assert!(out.contains("{\\fs45}quiet"), "{out}");
        assert!(out.contains("{\\fs72}LOUD"), "{out}");
    }

    #[test]
    fn zero_strength_matches_the_plain_writer() {
        let cues = r#"[{"start":0.0,"end":2.0,"lines":["one two"]}]"#;
        assert_eq!(
            to_ass_emphasised_js(cues, "Clean", 1920, 1080, "[[1.0,1.0]]", 0.0).unwrap(),
            to_ass_js(cues, "Clean", 1920, 1080).unwrap(),
        );
    }

    #[test]
    fn malformed_emphasis_is_an_error_rather_than_a_panic() {
        let cues = r#"[{"start":0.0,"end":2.0,"lines":["one"]}]"#;
        assert!(to_ass_emphasised_js(cues, "Clean", 1920, 1080, "nope", 0.5).is_err());
    }

    #[test]
    fn karaoke_lights_one_word_per_event() {
        let cues = r#"[{"start":0.0,"end":2.0,"lines":["one two"]}]"#;
        let out = to_ass_karaoke_js(cues, "Clean", 1920, 1080, 0.5, 0.5, "#FFD400").unwrap();
        let events: Vec<&str> = out.lines().filter(|l| l.starts_with("Dialogue:")).collect();
        assert_eq!(events.len(), 2);
        assert!(events
            .iter()
            .all(|e| e.contains("one") && e.contains("two")));
    }

    #[test]
    fn a_quote_is_shown_before_anything_is_charged() {
        let lines = r#"["Hello there","This is Sparta"]"#;
        let out = quote_translation_js(lines, "Simplified Chinese").unwrap();
        assert!(out.contains("\"credits\""), "{out}");
        let empty = quote_translation_js("[]", "Simplified Chinese").unwrap();
        assert!(empty.contains("\"credits\":0"), "{empty}");
    }

    #[test]
    fn karaoke_rejects_a_colour_it_cannot_parse() {
        let cues = r#"[{"start":0.0,"end":1.0,"lines":["hi"]}]"#;
        assert!(to_ass_karaoke_js(cues, "Clean", 1920, 1080, 0.5, 0.5, "puce").is_err());
    }

    #[test]
    fn the_strength_cap_is_published_to_the_page() {
        assert!(max_emphasis_strength() > 0.0);
    }
}
