//! Speech recognition behind a trait, plus the canonical `Transcript`.

pub mod ffmpeg_whisper;
pub mod mock;
pub mod transcript;

pub use ffmpeg_whisper::{
    parse_whisper_jsonl, synthesize_words, transcript_from_segments, FfmpegWhisperTranscriber,
};
pub use mock::MockTranscriber;
pub use transcript::{Segment, Transcript, Word};

use std::path::{Path, PathBuf};

#[derive(Debug, thiserror::Error)]
pub enum AsrError {
    #[error("i/o error: {0}")]
    Io(#[from] std::io::Error),
    #[error("malformed transcript: {0}")]
    Json(#[from] serde_json::Error),
    #[error("backend failed: {0}")]
    Backend(String),
}

/// A reference to extracted 16 kHz mono PCM audio.
#[derive(Debug, Clone)]
pub struct AudioRef {
    pub path: PathBuf,
}

impl AudioRef {
    pub fn new(p: impl AsRef<Path>) -> Self {
        Self {
            path: p.as_ref().to_path_buf(),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct AsrOptions {
    /// `None` means auto-detect, which also selects the backend.
    pub language: Option<String>,
}

pub trait Transcriber {
    fn transcribe(&self, audio: &AudioRef, opts: &AsrOptions) -> Result<Transcript, AsrError>;
}

/// Refines word timings independently of the recogniser.
///
/// Whisper has no native word timestamps; whisper.cpp derives them from
/// cross-attention via DTW, which drifts. Forced alignment implements this
/// trait post-MVP without touching any `Transcriber`.
pub trait Aligner {
    fn align(&self, audio: &AudioRef, t: &Transcript) -> Result<Transcript, AsrError>;
}

/// The MVP default: no refinement.
pub struct IdentityAligner;

impl Aligner for IdentityAligner {
    fn align(&self, _audio: &AudioRef, t: &Transcript) -> Result<Transcript, AsrError> {
        Ok(t.clone())
    }
}
