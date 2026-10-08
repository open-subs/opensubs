//! Cloud translation: what the app needs so a person sees the exact price
//! before anything is charged.
//!
//! Translation on OpenSubs' servers is paid in credits, and the price
//! depends on the subtitles, which do not exist until the video has been
//! listened to. So a cloud-translated export runs in three steps:
//!
//! 1. [`transcribe_for_cloud`] listens to the video and returns the
//!    subtitle lines and their price. The transcript is kept here, by job
//!    id, so the export does not have to listen again.
//! 2. The window shows the price, the person agrees, and the window sends
//!    the lines to the gateway with the signed-in session. The webview does
//!    that call rather than this process because the session lives there,
//!    and refreshing it from two places would revoke it.
//! 3. `burn` runs with the job id and the translations, using
//!    [`CachedTranscriber`] and [`PresetTranslator`] in place of the
//!    recogniser and the translator.
//!
//! The gateway computes its own price from the same crate
//! (`subs_translate::pricing`), so the figure shown is the figure charged.

use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use subs_asr::{AsrError, AsrOptions, AudioRef, Transcriber, Transcript};
use subs_translate::{TranslateError, TranslateRequest, Translator};

/// The translations a person paid for, handed to `burn`.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CloudTranslation {
    /// From [`TranscribedDto::job_id`].
    pub job_id: String,
    /// One per line returned by [`transcribe_for_cloud`], in order.
    pub translations: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscribedDto {
    pub job_id: String,
    /// The subtitle text the gateway will translate, one entry per cue.
    pub lines: Vec<String>,
    /// The language the recogniser heard.
    pub language: String,
    /// What translating `lines` costs, in credits, as the gateway prices it.
    pub credits: u32,
}

/// What a transcript was made from. An export may only reuse it for the
/// same file, model and clip.
#[derive(Debug, Clone, PartialEq)]
pub struct TranscriptKey {
    pub path: String,
    pub model: String,
    pub start: Option<f64>,
    pub end: Option<f64>,
}

/// Transcripts waiting for their export, by job id. A handful at most:
/// one per export a person has priced and not yet run.
#[derive(Default)]
pub struct PendingTranscripts {
    jobs: Mutex<HashMap<String, (TranscriptKey, Transcript)>>,
    order: Mutex<VecDeque<String>>,
}

/// More than this and the oldest priced-but-not-run export is forgotten.
const KEEP: usize = 4;

impl PendingTranscripts {
    pub fn insert(&self, key: TranscriptKey, transcript: Transcript) -> String {
        let id = new_job_id();
        let mut jobs = self.jobs.lock().unwrap();
        let mut order = self.order.lock().unwrap();
        jobs.insert(id.clone(), (key, transcript));
        order.push_back(id.clone());
        while order.len() > KEEP {
            if let Some(old) = order.pop_front() {
                jobs.remove(&old);
            }
        }
        id
    }

    /// The transcript for `id`, if it was made from `key`. Kept after the
    /// read, so a failed export can be run again without listening again.
    pub fn get(&self, id: &str, key: &TranscriptKey) -> Result<Transcript, String> {
        let jobs = self.jobs.lock().unwrap();
        match jobs.get(id) {
            Some((k, t)) if k == key => Ok(t.clone()),
            Some(_) => Err(
                "The video, model or clip changed after the translation was priced. \
                 Start the export again to see the new price."
                    .into(),
            ),
            None => Err("This translation is no longer waiting to be used. \
                 Start the export again to see the price."
                .into()),
        }
    }
}

fn new_job_id() -> String {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("job-{:x}-{:x}", std::process::id(), nanos)
}

/// A recogniser that returns a transcript it was given, for an export
/// whose audio has already been listened to.
pub struct CachedTranscriber(pub Transcript);

impl Transcriber for CachedTranscriber {
    fn transcribe(&self, _audio: &AudioRef, _opts: &AsrOptions) -> Result<Transcript, AsrError> {
        Ok(self.0.clone())
    }
}

/// A translator that hands out translations it was given, in order, one
/// batch at a time.
pub struct PresetTranslator(Mutex<VecDeque<String>>);

impl PresetTranslator {
    pub fn new(translations: Vec<String>) -> Self {
        Self(Mutex::new(translations.into()))
    }

    /// Translations nobody asked for. Anything left over means the cues
    /// came out differently from the lines that were translated.
    pub fn remaining(&self) -> usize {
        self.0.lock().unwrap().len()
    }
}

impl Translator for PresetTranslator {
    fn translate(
        &self,
        texts: &[String],
        _req: &TranslateRequest,
    ) -> Result<Vec<String>, TranslateError> {
        let mut left = self.0.lock().unwrap();
        if left.len() < texts.len() {
            return Err(TranslateError::CountMismatch {
                sent: texts.len(),
                got: left.len(),
            });
        }
        Ok(left.drain(..texts.len()).collect())
    }
}

/// A scratch directory for listening to one video.
pub fn asr_work_dir() -> PathBuf {
    std::env::temp_dir().join(format!("opensubs-desktop-asr-{}", new_job_id()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn transcript(text: &str) -> Transcript {
        Transcript {
            language: "en".into(),
            duration: 1.0,
            words: vec![],
            segments: vec![subs_asr::Segment {
                start: 0.0,
                end: 1.0,
                text: text.into(),
            }],
        }
    }

    fn key(path: &str) -> TranscriptKey {
        TranscriptKey {
            path: path.into(),
            model: "m.bin".into(),
            start: None,
            end: Some(4.0),
        }
    }

    #[test]
    fn a_transcript_is_reused_only_for_what_it_was_made_from() {
        let pending = PendingTranscripts::default();
        let id = pending.insert(key("a.mp4"), transcript("hello"));
        assert!(pending.get(&id, &key("a.mp4")).is_ok());
        assert!(pending.get(&id, &key("a.mp4")).is_ok(), "kept for a retry");
        let other = pending.get(&id, &key("b.mp4")).unwrap_err();
        assert!(other.contains("changed"), "{other}");
        let gone = pending.get("job-nope", &key("a.mp4")).unwrap_err();
        assert!(gone.contains("Start the export again"), "{gone}");
    }

    #[test]
    fn only_a_few_priced_exports_are_kept() {
        let pending = PendingTranscripts::default();
        let first = pending.insert(key("a.mp4"), transcript("1"));
        for _ in 0..KEEP {
            pending.insert(key("a.mp4"), transcript("n"));
        }
        assert!(pending.get(&first, &key("a.mp4")).is_err());
    }

    #[test]
    fn preset_translations_come_out_in_order_and_refuse_a_shortfall() {
        let t = PresetTranslator::new(vec!["一".into(), "二".into(), "三".into()]);
        let req = TranslateRequest::to("zh-Hans");
        let batch = |n: usize| vec![String::from("x"); n];
        assert_eq!(t.translate(&batch(2), &req).unwrap(), ["一", "二"]);
        assert_eq!(t.remaining(), 1);
        assert!(matches!(
            t.translate(&batch(2), &req),
            Err(TranslateError::CountMismatch { sent: 2, got: 1 })
        ));
    }

    #[test]
    fn the_cached_transcriber_returns_what_it_was_given() {
        let t = transcript("hello");
        let got = CachedTranscriber(t.clone())
            .transcribe(
                &AudioRef::new(PathBuf::from("unused.wav")),
                &AsrOptions::default(),
            )
            .unwrap();
        assert_eq!(got, t);
    }
}
