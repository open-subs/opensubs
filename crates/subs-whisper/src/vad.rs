//! Where the voice is: Silero VAD through whisper.cpp's own detector.
//!
//! Whisper writes something over every stretch of audio, speech or not, and
//! times its first segment from the start of the file (see
//! `subs_asr::speech`). The detector answers the question Whisper cannot:
//! which seconds hold a voice. The web app runs the same model in ONNX form
//! (`apps/web/src/lib/vad.ts`), where it separated narration from music,
//! cooking noise and silence on every clip it was measured on; singing is
//! the one thing it does not count as speech.
//!
//! The model is 885 KB and compiled in, so every build -- installers, the
//! CLI, a Linux package using the system ffmpeg -- has it without anything
//! to fetch or bundle. whisper.cpp opens models by path, so it is written
//! once to the temp directory under a name that carries its hash.

use std::path::PathBuf;

use subs_asr::Span;
use whisper_rs::{WhisperVadContext, WhisperVadContextParams, WhisperVadParams};

const MODEL: &[u8] = include_bytes!("../vad/ggml-silero-v5.1.2.bin");
/// The first 12 hex digits of the model's SHA-256, for its file name.
const MODEL_TAG: &str = "29940d98d42b";

/// The model file, written on first use.
fn model_path() -> std::io::Result<PathBuf> {
    let path = std::env::temp_dir().join(format!("opensubs-silero-vad-{MODEL_TAG}.bin"));
    if std::fs::metadata(&path).map(|m| m.len() as usize == MODEL.len()).unwrap_or(false) {
        return Ok(path);
    }
    // Written beside itself and renamed, so two exports starting at once
    // never read a half-written model.
    let part = path.with_extension(format!("{}.part", std::process::id()));
    std::fs::write(&part, MODEL)?;
    std::fs::rename(&part, &path)?;
    Ok(path)
}

/// The detector's settings. Silero's own threshold; speech segments padded
/// a little, and a gap shorter than 300 ms does not end one -- a pause for
/// breath is still the same sentence.
fn params() -> WhisperVadParams {
    let mut p = WhisperVadParams::new();
    p.set_threshold(0.5);
    p.set_min_speech_duration(250);
    p.set_min_silence_duration(300);
    p.set_speech_pad(30);
    p
}

/// The voiced spans of 16 kHz mono `samples`, in seconds, or the reason the
/// detector could not run. The caller transcribes without it in that case:
/// a missing detector is the behaviour before it existed, not a failure.
pub fn speech_spans(samples: &[f32]) -> Result<Vec<Span>, String> {
    let path = model_path().map_err(|e| format!("writing the voice detector: {e}"))?;
    let mut ctx_params = WhisperVadContextParams::new();
    ctx_params.set_n_threads(std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).min(4) as i32);
    // On the CPU: it runs at hundreds of times real time there, and the GPU
    // is Whisper's.
    ctx_params.set_use_gpu(false);
    let mut ctx = WhisperVadContext::new(&path.to_string_lossy(), ctx_params)
        .map_err(|e| format!("loading the voice detector: {e}"))?;
    let segments = ctx
        .segments_from_samples(params(), samples)
        .map_err(|e| format!("voice detection failed: {e}"))?;
    // whisper.cpp reports centiseconds.
    Ok(segments.map(|s| Span::new(f64::from(s.start) / 100.0, f64::from(s.end) / 100.0)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_compiled_in_model_is_the_one_described() {
        assert_eq!(MODEL.len(), 885_098);
        // ggml magic, little-endian "ggml".
        assert_eq!(&MODEL[..4], b"lmgg");
    }

    #[test]
    fn silence_holds_no_speech() {
        let spans = speech_spans(&vec![0.0; 16_000 * 5]).unwrap();
        assert!(subs_asr::speech_seconds(&spans) < 0.1, "{spans:?}");
    }
}
