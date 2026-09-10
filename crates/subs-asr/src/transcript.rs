use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Word {
    pub start: f64,
    pub end: f64,
    pub text: String,
    pub confidence: f32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Segment {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// The canonical transcript. No downstream crate ever sees a
/// backend-specific type.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Transcript {
    pub language: String,
    pub duration: f64,
    pub words: Vec<Word>,
    pub segments: Vec<Segment>,
}

impl Transcript {
    /// Apply a container `start_time` offset. ASR sees an extracted WAV that
    /// always begins at zero; the source may not.
    pub fn shift(&mut self, seconds: f64) {
        for w in &mut self.words {
            w.start += seconds;
            w.end += seconds;
        }
        for s in &mut self.segments {
            s.start += seconds;
            s.end += seconds;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{Aligner, AudioRef, IdentityAligner};

    fn t() -> Transcript {
        Transcript {
            language: "en".into(),
            duration: 3.0,
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
            segments: vec![Segment {
                start: 0.0,
                end: 1.0,
                text: "Hello world".into(),
            }],
        }
    }

    #[test]
    fn round_trips_through_json() {
        let json = serde_json::to_string(&t()).unwrap();
        let back: Transcript = serde_json::from_str(&json).unwrap();
        assert_eq!(back.words.len(), 2);
        assert_eq!(back.words[1].text, "world");
        assert_eq!(back.language, "en");
    }

    #[test]
    fn shifts_all_timestamps_by_container_start_time() {
        let mut x = t();
        x.shift(1.5);
        assert!((x.words[0].start - 1.5).abs() < 1e-9);
        assert!((x.words[1].end - 2.5).abs() < 1e-9);
        assert!((x.segments[0].start - 1.5).abs() < 1e-9);
    }

    #[test]
    fn identity_aligner_returns_input_unchanged() {
        let a = IdentityAligner;
        let out = a.align(&AudioRef::new("x.wav"), &t()).unwrap();
        assert_eq!(out.words, t().words);
    }
}
