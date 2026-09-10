use crate::{AsrError, AsrOptions, AudioRef, Transcriber, Transcript};
use std::path::Path;

/// Fixture-backed transcriber. Ignores the audio entirely and replays a
/// committed `Transcript`, which is what makes the test loop deterministic.
pub struct MockTranscriber {
    transcript: Transcript,
}

impl MockTranscriber {
    pub fn from_file(path: impl AsRef<Path>) -> Result<Self, AsrError> {
        let raw = std::fs::read_to_string(path)?;
        Ok(Self {
            transcript: serde_json::from_str(&raw)?,
        })
    }

    pub fn from_transcript(transcript: Transcript) -> Self {
        Self { transcript }
    }
}

impl Transcriber for MockTranscriber {
    fn transcribe(&self, _audio: &AudioRef, _opts: &AsrOptions) -> Result<Transcript, AsrError> {
        Ok(self.transcript.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AsrOptions, AudioRef, Transcriber};

    fn fixture() -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/hello.transcript.json")
    }

    #[test]
    fn loads_a_fixture_from_disk() {
        let m = MockTranscriber::from_file(fixture()).unwrap();
        let t = m
            .transcribe(&AudioRef::new("ignored.wav"), &AsrOptions::default())
            .unwrap();
        assert_eq!(t.words.len(), 2);
        assert_eq!(t.words[0].text, "Hello");
        assert_eq!(t.language, "en");
    }

    #[test]
    fn is_deterministic_across_calls() {
        let m = MockTranscriber::from_file(fixture()).unwrap();
        let a = m
            .transcribe(&AudioRef::new("a.wav"), &AsrOptions::default())
            .unwrap();
        let b = m
            .transcribe(&AudioRef::new("b.wav"), &AsrOptions::default())
            .unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn reports_a_useful_error_for_a_missing_fixture() {
        assert!(matches!(
            MockTranscriber::from_file("does-not-exist.json"),
            Err(AsrError::Io(_))
        ));
    }
}
