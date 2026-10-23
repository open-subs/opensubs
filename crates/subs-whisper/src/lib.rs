//! Whisper, linked in.
//!
//! The desktop app used to transcribe through ffmpeg's `af_whisper` filter,
//! which only exists in an ffmpeg built against whisper.cpp -- Homebrew's
//! `ffmpeg-full`, Gyan.dev's full build -- and no self-contained macOS ffmpeg
//! has it. That made a working install a second, separate install. Linking
//! whisper.cpp into the app removes the requirement: ffmpeg is left with
//! decoding and burning, which every static build can do, and the app can
//! ship its own.
//!
//! Same input (the 16 kHz mono PCM WAV the pipeline already extracts), same
//! output (a `Transcript`). Two things happen here that the old filter
//! backend never did: a voice detector ([`vad`]) decides where the speech
//! is, so segments start at the voice rather than at the start of the
//! file, and the web app's clean-up rules (`subs_asr::cleanup`) take out
//! what Whisper writes over music and silence.

use std::path::{Path, PathBuf};
use subs_asr::cleanup::clean_up;
use subs_asr::{
    aligned_words, fit_to_speech, has_speech, near_speech, plausible_alignment, retime, transcript_from_speech, AsrError, AsrOptions, AudioRef,
    Segment, Span, TimedSegment, Transcriber, Transcript, Word, NEAR_SPEECH_S,
};
use whisper_rs::{
    DtwMode, DtwModelPreset, DtwParameters, FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters,
};

pub mod vad;

pub struct WhisperTranscriber {
    model_path: PathBuf,
    /// Used when a call does not name one; `None` detects it.
    language: Option<String>,
}

impl WhisperTranscriber {
    /// A `\\?\` verbatim path -- which is what the desktop app's resource
    /// directory is on Windows -- is handed to whisper.cpp in its plain
    /// form. whisper.cpp opens the file it is given as is, so the verbatim
    /// form does load today; it is native code that never expects one, and
    /// the plain form is also what the user reads in an error.
    pub fn new(model_path: impl Into<PathBuf>) -> Self {
        let model_path = model_path.into();
        Self { model_path: dunce::simplified(&model_path).to_path_buf(), language: None }
    }

    /// The spoken language, as the ffmpeg backend took it: the pipeline asks
    /// with default options, so this is how a caller names it.
    pub fn with_language(mut self, language: impl Into<String>) -> Self {
        self.language = Some(language.into());
        self
    }
}

/// 16-bit PCM WAV to the f32 samples whisper.cpp wants.
fn read_samples(path: &Path) -> Result<Vec<f32>, AsrError> {
    let mut reader = hound::WavReader::open(path).map_err(|e| AsrError::Backend(format!("reading {}: {e}", path.display())))?;
    let spec = reader.spec();
    if spec.sample_rate != 16_000 || spec.channels != 1 {
        return Err(AsrError::Backend(format!(
            "expected 16 kHz mono audio, got {} Hz with {} channels",
            spec.sample_rate, spec.channels
        )));
    }
    reader
        .samples::<i16>()
        .map(|s| s.map(|v| v as f32 / 32768.0))
        .collect::<Result<_, _>>()
        .map_err(|e| AsrError::Backend(format!("decoding {}: {e}", path.display())))
}

/// The language to give whisper.cpp, or `None` to have it detect one.
///
/// An English-only model (`ggml-*.en.bin`) has no language tokens, yet
/// whisper.cpp still runs its detector on "auto", reading the logits of
/// whichever tokens sit where the language tokens would be. The text is
/// English regardless; only the reported language is noise -- `ms` or `fa`
/// for plainly English speech. That label becomes the source language the
/// offline translator is told, and M2M-100 handed English marked as Malay
/// mostly copies it through, so a translated export came out half in
/// English. Such a model can only ever produce English: say so, and skip
/// the detector.
fn language_for(model_is_multilingual: bool, requested: Option<&str>) -> Option<&str> {
    if !model_is_multilingual {
        return Some("en");
    }
    requested.filter(|l| *l != "auto")
}

impl Transcriber for WhisperTranscriber {
    fn transcribe(&self, audio: &AudioRef, opts: &AsrOptions) -> Result<Transcript, AsrError> {
        let samples = read_samples(&audio.path)?;
        // Word times from the alignment of each token to the audio, for the
        // model families whisper.cpp knows the alignment heads of. Segment
        // times alone are too coarse to time a subtitle by: see
        // `subs_asr::TimedSegment`.
        let mut ctx_params = WhisperContextParameters::default();
        if let Some(preset) = dtw_preset(&self.model_path) {
            ctx_params.dtw_parameters(DtwParameters {
                mode: DtwMode::ModelPreset { model_preset: preset },
                ..DtwParameters::default()
            });
        }
        let ctx = WhisperContext::new_with_params(&self.model_path, ctx_params)
            .map_err(|e| AsrError::Backend(format!("loading {}: {e}", self.model_path.display())))?;
        let eot = ctx.token_eot();
        let wanted = language_for(
            ctx.is_multilingual(),
            opts.language.as_deref().or(self.language.as_deref()),
        );

        // Ask whether anyone is speaking before asking what they said. A
        // clip of silence or music needs no transcription, and transcribing
        // it is exactly what produced "[BLANK_AUDIO]" and invented lines. A
        // detector that cannot run is not a reason to refuse: without it the
        // transcript is what it was before the detector existed.
        let speech = match vad::speech_spans(&samples) {
            Ok(spans) => Some(spans),
            Err(e) => {
                eprintln!("opensubs: {e}; transcribing without it");
                None
            }
        };
        if speech.as_deref().is_some_and(|s| !has_speech(s)) {
            return Ok(Transcript {
                language: wanted.unwrap_or("auto").to_string(),
                duration: samples.len() as f64 / 16_000.0,
                words: Vec::new(),
                segments: Vec::new(),
            });
        }

        let mut state = ctx.create_state().map_err(|e| AsrError::Backend(e.to_string()))?;
        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        // `None` is auto-detect, as it is for the ffmpeg filter's "auto".
        params.set_language(Some(wanted.unwrap_or("auto")));
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
        // OpenAI's own decoder suppresses the tokens Whisper uses to caption
        // sounds rather than words -- brackets, note glyphs -- and whisper.cpp
        // does not unless asked. Without it a music bed comes back as
        // "[Music] [Music]" and silence as "[BLANK_AUDIO]".
        params.set_suppress_nst(true);
        let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
        params.set_n_threads(threads as i32);

        state.full(params, &samples).map_err(|e| AsrError::Backend(format!("whisper failed: {e}")))?;

        let language = wanted
            .map(str::to_string)
            .or_else(|| {
                whisper_rs::get_lang_str(state.full_lang_id_from_state())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| "en".to_string());

        let mut segments = Vec::new();
        for segment in state.as_iter() {
            let mut bytes: Vec<u8> = Vec::new();
            let mut byte_times: Vec<f64> = Vec::new();
            let mut aligned = true;
            for i in 0..segment.n_tokens() {
                let Some(token) = segment.get_token(i) else { continue };
                // Timestamps, language and task markers are not text.
                if token.token_id() >= eot {
                    continue;
                }
                let Ok(piece) = token.to_bytes() else { continue };
                let t = token.token_data().t_dtw;
                aligned &= t >= 0;
                byte_times.extend(std::iter::repeat_n(t as f64 / 100.0, piece.len()));
                bytes.extend_from_slice(piece);
            }
            let whole = String::from_utf8_lossy(&bytes).into_owned();
            // One time per character, from the token its first byte came in.
            let char_times = (aligned && std::str::from_utf8(&bytes).is_ok())
                .then(|| whole.char_indices().map(|(at, _)| byte_times[at]).collect::<Vec<f64>>());
            // Trimmed, with the times trimmed alongside.
            let lead = whole.chars().take_while(|c| c.is_whitespace()).count();
            let text = whole.trim().to_string();
            if text.is_empty() {
                continue;
            }
            let count = text.chars().count();
            // whisper.cpp reports centiseconds.
            segments.push(TimedSegment {
                start: segment.start_timestamp() as f64 / 100.0,
                end: segment.end_timestamp() as f64 / 100.0,
                text,
                char_times: char_times.map(|t| t[lead..lead + count].to_vec()),
            });
        }
        Ok(finish(segments, speech.as_deref(), &samples, &language))
    }
}

/// A whisper.cpp model file's hyper-parameters, from its header:
/// `(n_vocab, n_text_state, n_text_layer)`.
fn model_header(model: &Path) -> Option<(i32, i32, i32)> {
    use std::io::Read;
    let mut header = [0u8; 4 * 12];
    std::fs::File::open(model).ok()?.read_exact(&mut header).ok()?;
    if &header[..4] != b"lmgg" {
        return None;
    }
    let word = |i: usize| i32::from_le_bytes(header[4 * i..4 * i + 4].try_into().unwrap());
    // magic, n_vocab, n_audio_ctx, n_audio_state, n_audio_head,
    // n_audio_layer, n_text_ctx, n_text_state, n_text_head, n_text_layer
    Some((word(1), word(7), word(9)))
}

/// Whether a model file only transcribes English, read from its header
/// (English-only checkpoints have a 51,864-token vocabulary, the
/// multilingual ones 51,865 or more), so a file renamed by hand is judged
/// by what it is. `None` when the file is not a whisper.cpp model.
pub fn model_is_english_only(model: &Path) -> Option<bool> {
    model_header(model).map(|(vocab, _, _)| vocab == 51864)
}

/// The language spoken in a 16 kHz mono WAV, and how sure the model is,
/// using a multilingual `model`. Measured on the voice only: the detector's
/// spans are joined and the first thirty seconds of them are read, because
/// a clip that opens on music or silence would otherwise be judged on that.
/// `Ok(None)` when there is no speech to judge.
pub fn spoken_language(model: &Path, audio: &AudioRef) -> Result<Option<(String, f32)>, AsrError> {
    let samples = read_samples(&audio.path)?;
    let voiced: Vec<f32> = match vad::speech_spans(&samples) {
        Ok(spans) => {
            let mut v = Vec::new();
            for s in spans {
                let a = (s.start * 16_000.0) as usize;
                let b = ((s.end * 16_000.0) as usize).min(samples.len());
                if a < b {
                    v.extend_from_slice(&samples[a..b]);
                }
                if v.len() >= 30 * 16_000 {
                    break;
                }
            }
            v
        }
        Err(_) => samples.iter().copied().take(30 * 16_000).collect(),
    };
    if voiced.len() < 16_000 {
        return Ok(None);
    }
    let ctx = WhisperContext::new_with_params(model, WhisperContextParameters::default())
        .map_err(|e| AsrError::Backend(format!("loading {}: {e}", model.display())))?;
    if !ctx.is_multilingual() {
        return Err(AsrError::Backend("language detection needs a multilingual model".into()));
    }
    let mut state = ctx.create_state().map_err(|e| AsrError::Backend(e.to_string()))?;
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(8);
    state.pcm_to_mel(&voiced, threads).map_err(|e| AsrError::Backend(format!("reading the audio: {e}")))?;
    let (id, probs) = state.lang_detect(0, threads).map_err(|e| AsrError::Backend(format!("language detection failed: {e}")))?;
    let p = probs.get(id as usize).copied().unwrap_or(0.0);
    Ok(whisper_rs::get_lang_str(id).map(|l| (l.to_string(), p)))
}

/// A Whisper language code's English name ("zh" -> "Chinese"), for a
/// sentence that has to name it.
pub fn language_name(code: &str) -> Option<String> {
    let id = whisper_rs::get_lang_id(code)?;
    let full = whisper_rs::get_lang_str_full(id)?;
    let mut c = full.chars();
    c.next().map(|first| first.to_uppercase().chain(c).collect())
}

/// The alignment-head preset for a whisper.cpp model file, read from its
/// header, or `None` for a model whisper.cpp has no preset for -- which
/// then transcribes as before, with word times spread over the speech.
fn dtw_preset(model: &Path) -> Option<DtwModelPreset> {
    let (vocab, text_state, text_layers) = model_header(model)?;
    let english = vocab == 51864;
    Some(match (text_layers, text_state) {
        (4, 384) if english => DtwModelPreset::TinyEn,
        (4, 384) => DtwModelPreset::Tiny,
        (6, 512) if english => DtwModelPreset::BaseEn,
        (6, 512) => DtwModelPreset::Base,
        (12, 768) if english => DtwModelPreset::SmallEn,
        (12, 768) => DtwModelPreset::Small,
        (24, 1024) if english => DtwModelPreset::MediumEn,
        (24, 1024) => DtwModelPreset::Medium,
        (32, 1280) if vocab >= 51866 => DtwModelPreset::LargeV3,
        (32, 1280) => DtwModelPreset::LargeV2,
        (4, 1280) => DtwModelPreset::LargeV3Turbo,
        _ => return None,
    })
}

/// From Whisper's segments to the transcript.
///
/// Each segment is placed: by its aligned words when the alignment ran, or
/// cut down to the speech under it when it did not. A segment nowhere near
/// any voice is dropped -- that is the model writing over music or silence.
/// Then the clean-up rules take out what cannot be a transcript of its
/// audio, and the words keep the times they were placed at.
fn finish(segments: Vec<TimedSegment>, speech: Option<&[Span]>, samples: &[f32], language: &str) -> Transcript {
    let mut placed: Vec<(Segment, Option<Vec<Word>>)> = Vec::new();
    for seg in segments {
        match aligned_words(&seg, speech).filter(|w| plausible_alignment(&seg, w)) {
            Some(words) => {
                let (start, end) = (words[0].start, words[words.len() - 1].end);
                if speech.is_none_or(|sp| near_speech(sp, start, end, NEAR_SPEECH_S)) {
                    placed.push((Segment { start, end, text: seg.text }, Some(words)));
                }
            }
            None => {
                let plain = Segment { start: seg.start, end: seg.end, text: seg.text };
                let fitted = match speech {
                    Some(sp) => fit_to_speech(std::slice::from_ref(&plain), sp),
                    None => vec![plain],
                };
                placed.extend(fitted.into_iter().map(|s| (s, None)));
            }
        }
    }

    let plain: Vec<Segment> = placed.iter().map(|(s, _)| s.clone()).collect();
    let cleaned = clean_up(&plain, |from, to| rms(samples, from, to), language);

    let mut words: Vec<Word> = Vec::new();
    let mut kept_segments = Vec::new();
    let mut from = 0usize;
    for kept in cleaned.kept {
        // Clean-up keeps a segment's times; that is how it is found again.
        let Some(at) = placed[from..].iter().position(|(s, _)| s.start == kept.start && s.end == kept.end) else {
            continue;
        };
        let aligned = placed[from + at].1.clone();
        from += at + 1;
        let mut these = match aligned {
            Some(original) => retime(&kept.text, &original),
            None => transcript_from_speech(vec![kept.clone()], speech, language).words,
        };
        // Words never run backwards, across segments either.
        let floor = words.last().map_or(f64::NEG_INFINITY, |w| w.end);
        for w in &mut these {
            if w.start < floor {
                let len = (w.end - w.start).max(0.05);
                w.start = floor;
                w.end = floor + len;
            }
        }
        words.extend(these);
        kept_segments.push(kept);
    }
    Transcript {
        language: language.to_string(),
        duration: kept_segments.iter().map(|s| s.end).fold(0.0, f64::max),
        words,
        segments: kept_segments,
    }
}

/// RMS of 16 kHz samples between two times in seconds.
fn rms(samples: &[f32], from: f64, to: f64) -> f64 {
    let a = ((from.max(0.0)) * 16_000.0) as usize;
    let b = ((to.max(0.0) * 16_000.0).ceil() as usize).min(samples.len());
    if b <= a {
        return 0.0;
    }
    let sum: f64 = samples[a..b].iter().map(|&x| f64::from(x) * f64::from(x)).sum();
    (sum / (b - a) as f64).sqrt()
}

#[cfg(test)]
mod tests {
    use super::{dtw_preset, finish, language_for, rms};
    use subs_asr::{Span, TimedSegment};
    use whisper_rs::DtwModelPreset;

    fn seg(start: f64, end: f64, text: &str) -> TimedSegment {
        TimedSegment { start, end, text: text.into(), char_times: None }
    }

    /// Times for each character of `text`, one per word, the way whisper.cpp's
    /// alignment reports them (every character of a token gets its time).
    fn aligned(text: &str, word_times: &[f64]) -> TimedSegment {
        let mut times = Vec::new();
        let mut w = 0usize;
        let mut in_space = false;
        for c in text.chars() {
            if c == ' ' {
                in_space = true;
            } else if in_space {
                in_space = false;
                w += 1;
            }
            times.push(word_times[w.min(word_times.len() - 1)]);
        }
        TimedSegment { start: 0.0, end: 0.0, text: text.into(), char_times: Some(times) }
    }

    /// Tears of Steel's first ninety seconds as whisper.cpp segmented them,
    /// with the alignment's word times and the detector's voice: the
    /// countdown in the intro is a real voice and stays; the first line of
    /// dialogue starts where it is spoken (23.3 s, against 23.0 s in the
    /// film's own subtitles) rather than at the segment's 7.0 s; the
    /// "Thank you." written over the closing music goes.
    #[test]
    fn lines_are_timed_by_their_words_and_lines_far_from_any_voice_go() {
        let samples = vec![0.05f32; 16_000 * 92];
        let speech = [Span::new(4.71, 10.14), Span::new(24.48, 30.21), Span::new(60.99, 62.43)];
        let mut jerk = aligned("You're a jerk, Tom!", &[23.30, 23.48, 23.98, 24.34]);
        jerk.start = 7.0;
        jerk.end = 16.0;
        let mut thanks = aligned("Thank you.", &[89.38, 89.38]);
        thanks.start = 87.4;
        thanks.end = 89.4;
        let t = finish(
            vec![aligned("We have main engine start.", &[4.84, 5.10, 5.44, 5.82, 6.72]), jerk, thanks],
            Some(&speech),
            &samples,
            "en",
        );
        let texts: Vec<&str> = t.segments.iter().map(|s| s.text.as_str()).collect();
        assert_eq!(texts, ["We have main engine start.", "You're a jerk, Tom!"]);
        let you = t.words.iter().find(|w| w.text == "You're").unwrap();
        assert!((you.start - 23.30).abs() < 1e-9, "{you:?}");
    }

    /// Without an alignment, a segment is cut down to the voice under it
    /// and annotations go.
    #[test]
    fn without_an_alignment_segments_are_cut_to_the_voice() {
        let samples = vec![0.05f32; 16_000 * 40];
        let speech = [Span::new(22.9, 24.3), Span::new(25.1, 26.8)];
        let t = finish(
            vec![seg(0.0, 7.0, "[BLANK_AUDIO]"), seg(10.0, 17.0, "[Music]"), seg(20.0, 27.0, "You're a jerk, Tom. Look, Celia.")],
            Some(&speech),
            &samples,
            "en",
        );
        assert_eq!(t.segments.len(), 1, "{:?}", t.segments);
        assert!((t.words[0].start - 22.8).abs() < 1e-6, "{:?}", t.words[0]);
    }

    #[test]
    fn the_alignment_preset_is_read_from_the_model_header() {
        let dir = std::env::temp_dir().join(format!("subs-whisper-header-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let write = |name: &str, hp: [i32; 11]| {
            let mut bytes = b"lmgg".to_vec();
            for v in hp {
                bytes.extend_from_slice(&v.to_le_bytes());
            }
            let p = dir.join(name);
            std::fs::write(&p, bytes).unwrap();
            p
        };
        // The headers of ggml-base.bin and ggml-small.bin as shipped.
        let base = write("base", [51865, 1500, 512, 8, 6, 448, 512, 8, 6, 80, 1]);
        let small_en = write("small.en", [51864, 1500, 768, 12, 12, 448, 768, 12, 12, 80, 1]);
        let odd = write("odd", [51865, 1500, 100, 8, 6, 448, 100, 8, 3, 80, 1]);
        assert!(matches!(dtw_preset(&base), Some(DtwModelPreset::Base)));
        assert!(matches!(dtw_preset(&small_en), Some(DtwModelPreset::SmallEn)));
        assert!(dtw_preset(&odd).is_none());
        assert!(dtw_preset(&dir.join("missing")).is_none());
        assert_eq!(super::model_is_english_only(&base), Some(false));
        assert_eq!(super::model_is_english_only(&small_en), Some(true));
        assert_eq!(super::model_is_english_only(&dir.join("missing")), None);
        assert_eq!(super::language_name("zh").as_deref(), Some("Chinese"));
        assert_eq!(super::language_name("xx"), None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn rms_is_measured_over_the_span_asked_for() {
        let mut samples = vec![0.0f32; 32_000];
        samples[16_000..].iter_mut().for_each(|x| *x = 0.5);
        assert_eq!(rms(&samples, 0.0, 1.0), 0.0);
        assert!((rms(&samples, 1.0, 2.0) - 0.5).abs() < 1e-6);
        assert_eq!(rms(&samples, 3.0, 4.0), 0.0);
    }

    #[test]
    fn an_english_only_model_always_reports_english() {
        // Detection on such a model returns a language it cannot transcribe.
        assert_eq!(language_for(false, None), Some("en"));
        assert_eq!(language_for(false, Some("auto")), Some("en"));
        // Asking it for another language changes nothing it outputs.
        assert_eq!(language_for(false, Some("ja")), Some("en"));
    }

    #[test]
    fn a_multilingual_model_detects_unless_told() {
        assert_eq!(language_for(true, None), None);
        assert_eq!(language_for(true, Some("auto")), None);
        assert_eq!(language_for(true, Some("ja")), Some("ja"));
    }
}
