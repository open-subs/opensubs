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
//! output (`Transcript` built by `transcript_from_segments`), so nothing
//! downstream can tell the two backends apart.

use std::path::{Path, PathBuf};
use subs_asr::{transcript_from_segments, AsrError, AsrOptions, AudioRef, Segment, Transcriber, Transcript};
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

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
        let ctx = WhisperContext::new_with_params(
            &self.model_path,
            WhisperContextParameters::default(),
        )
        .map_err(|e| AsrError::Backend(format!("loading {}: {e}", self.model_path.display())))?;
        let mut state = ctx.create_state().map_err(|e| AsrError::Backend(e.to_string()))?;

        let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
        // `None` is auto-detect, as it is for the ffmpeg filter's "auto".
        let wanted = language_for(
            ctx.is_multilingual(),
            opts.language.as_deref().or(self.language.as_deref()),
        );
        params.set_language(Some(wanted.unwrap_or("auto")));
        params.set_print_progress(false);
        params.set_print_realtime(false);
        params.set_print_special(false);
        params.set_print_timestamps(false);
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
            let text = segment.to_string().trim().to_string();
            if text.is_empty() {
                continue;
            }
            // whisper.cpp reports centiseconds.
            segments.push(Segment {
                start: segment.start_timestamp() as f64 / 100.0,
                end: segment.end_timestamp() as f64 / 100.0,
                text,
            });
        }
        Ok(transcript_from_segments(segments, &language))
    }
}

#[cfg(test)]
mod tests {
    use super::language_for;

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
