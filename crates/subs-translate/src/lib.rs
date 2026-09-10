//! Translated subtitles.
//!
//! The competitor study lists multi-language subtitles as a P1
//! differentiator that every competitor offering it charges for. It is
//! shipped here unlocked (see `subs-tier`), with the cost passed straight
//! through: translation calls the Claude API with the user's own key.
//!
//! # Why translation happens after segmentation, not before
//!
//! The tempting design is to translate the transcript and segment the
//! result. It is wrong. Segmentation derives cue boundaries from *word
//! timestamps*, and a translation has none -- word order moves, words
//! merge and split, and any attempt to re-derive timings from translated
//! text is guesswork that shows up as drift.
//!
//! So the cues are built from the original audio first, keeping every
//! timing the ASR actually measured, and only the *text inside* each cue is
//! replaced. Timings are then bit-identical to the untranslated export:
//! translation cannot introduce drift, because it never touches a
//! timestamp. What it can do is overflow a line, so each translated cue is
//! re-wrapped against the target script's own line budget -- CJK gets ~20
//! characters per line, Latin 42.
//!
//! The cost of this design is honest and worth stating: a translation is
//! confined to its source cue's time slot, so a language that needs
//! markedly more words has to say the same thing more tersely rather than
//! spilling into the next cue. That is what the system prompt asks the
//! model for, and it is the right ask -- but it is a request, not a
//! guarantee. When a translation comes back longer than two lines can
//! hold, it is wrapped into two lines and left long: **text is never
//! truncated to fit.** A subtitle that overflows its line budget is a
//! legibility problem the viewer can still read around; a subtitle with
//! the end of the sentence silently deleted is a defect.

pub mod claude;
pub mod language;
#[cfg(feature = "cues")]
pub mod tokenize;

#[cfg(feature = "cues")]
use subs_subtitle::{line_budget, wrap_lines, Cue, MAX_LINES};

pub use language::{languages, Language};
#[cfg(feature = "cues")]
pub use tokenize::tokenize;

#[cfg(feature = "http")]
pub use claude::ClaudeTranslator;

/// How many cues go into one request.
///
/// A whole clip in one call would give the model the most context, but it
/// also makes one refusal or one miscount cost the entire export, and long
/// outputs are where count drift appears. Batching bounds both, at the cost
/// of losing continuity across a boundary every ~60 cues -- roughly every
/// three minutes of speech.
pub const MAX_BATCH: usize = 60;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum TranslateError {
    /// The backend returned a different number of lines than it was given.
    /// Fatal by design: each string is pinned to a timestamp that is not
    /// being recomputed, so accepting a miscount would desynchronise every
    /// cue after it.
    #[error(
        "translation returned {got} lines for {sent} subtitles; refusing to guess which is which"
    )]
    CountMismatch { sent: usize, got: usize },
    #[error("no translation credentials: {0}")]
    Auth(String),
    #[error("translation backend failed: {0}")]
    Backend(String),
    #[error("translation was declined ({0})")]
    Refused(String),
    #[error("could not read the translation response: {0}")]
    Parse(String),
}

/// What to translate into, and optionally what from.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TranslateRequest {
    /// Target language code, e.g. `"ja"`.
    pub target: String,
    /// Source language, when known. `None` (or `"auto"`) lets the model
    /// work it out, which is what the ASR layer reports unless the user
    /// named a language.
    pub source: Option<String>,
}

impl TranslateRequest {
    pub fn to(target: impl Into<String>) -> Self {
        Self {
            target: target.into(),
            source: None,
        }
    }

    pub fn from_language(mut self, source: impl Into<String>) -> Self {
        self.source = Some(source.into());
        self
    }
}

/// A translation backend.
///
/// The contract is exact: `translate` returns one string per input string,
/// in the same order. Implementations that cannot guarantee that must
/// return [`TranslateError::CountMismatch`] rather than a best guess.
pub trait Translator {
    fn translate(
        &self,
        texts: &[String],
        req: &TranslateRequest,
    ) -> Result<Vec<String>, TranslateError>;
}

/// Leaves text exactly as it is. The default when no target is chosen.
pub struct IdentityTranslator;

impl Translator for IdentityTranslator {
    fn translate(
        &self,
        texts: &[String],
        _req: &TranslateRequest,
    ) -> Result<Vec<String>, TranslateError> {
        Ok(texts.to_vec())
    }
}

/// Replays a fixed table, so the whole pipeline can be tested end to end
/// with no network -- the same role `MockTranscriber` plays for ASR.
///
/// Unknown input is passed through unchanged rather than failing, which
/// keeps a fixture from having to enumerate every cue.
pub struct MockTranslator {
    table: Vec<(String, String)>,
}

impl MockTranslator {
    pub fn new(pairs: impl IntoIterator<Item = (String, String)>) -> Self {
        Self {
            table: pairs.into_iter().collect(),
        }
    }
}

impl Translator for MockTranslator {
    fn translate(
        &self,
        texts: &[String],
        _req: &TranslateRequest,
    ) -> Result<Vec<String>, TranslateError> {
        Ok(texts
            .iter()
            .map(|t| {
                self.table
                    .iter()
                    .find(|(k, _)| k == t)
                    .map_or_else(|| t.clone(), |(_, v)| v.clone())
            })
            .collect())
    }
}

#[cfg(feature = "cues")]
/// Replace the text of every cue with its translation, keeping all timings.
///
/// Cue count, `start` and `end` come out untouched; only `lines` change.
pub fn translate_cues(
    cues: &[Cue],
    translator: &dyn Translator,
    req: &TranslateRequest,
) -> Result<Vec<Cue>, TranslateError> {
    if cues.is_empty() {
        return Ok(Vec::new());
    }

    let sources: Vec<String> = cues.iter().map(Cue::text).collect();

    let mut translated: Vec<String> = Vec::with_capacity(sources.len());
    for chunk in sources.chunks(MAX_BATCH) {
        let out = translator.translate(chunk, req)?;
        if out.len() != chunk.len() {
            // A backend may not enforce its own contract; the pipeline does.
            return Err(TranslateError::CountMismatch {
                sent: chunk.len(),
                got: out.len(),
            });
        }
        translated.extend(out);
    }

    apply_translations(cues, &translated)
}

#[cfg(feature = "cues")]
/// Put already-fetched translations onto their cues, keeping every timing.
///
/// Split out of [`translate_cues`] because the browser build cannot use a
/// [`Translator`] at all -- it has no HTTP client linked in and does its
/// own `fetch` -- but it must not reimplement the rewrapping, or the web
/// app and the desktop would break lines differently for the same text.
/// This is the only place cue text is replaced; both paths go through it.
pub fn apply_translations(
    cues: &[Cue],
    translations: &[String],
) -> Result<Vec<Cue>, TranslateError> {
    if translations.len() != cues.len() {
        return Err(TranslateError::CountMismatch {
            sent: cues.len(),
            got: translations.len(),
        });
    }

    Ok(cues
        .iter()
        .zip(translations)
        .map(|(cue, text)| Cue {
            start: cue.start,
            end: cue.end,
            lines: rewrap(text, &cue.lines),
        })
        .collect())
}

#[cfg(feature = "cues")]
/// Re-break one translated string against its own script's line budget.
///
/// An empty translation falls back to the original lines: a blank subtitle
/// is strictly worse than an untranslated one, and this is the only place
/// a backend's shortfall can be absorbed without desynchronising anything.
fn rewrap(text: &str, fallback: &[String]) -> Vec<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return fallback.to_vec();
    }

    let tokens = tokenize(trimmed);
    if tokens.is_empty() {
        return fallback.to_vec();
    }

    let refs: Vec<&str> = tokens.iter().map(String::as_str).collect();
    let lines = wrap_lines(&refs, line_budget(trimmed), MAX_LINES);
    if lines.is_empty() {
        fallback.to_vec()
    } else {
        lines
    }
}

#[cfg(all(test, feature = "cues"))]
mod tests {
    use super::*;

    fn cue(start: f64, end: f64, line: &str) -> Cue {
        Cue {
            start,
            end,
            lines: vec![line.into()],
        }
    }

    struct Counting {
        calls: std::cell::RefCell<Vec<usize>>,
    }

    impl Translator for Counting {
        fn translate(
            &self,
            texts: &[String],
            _req: &TranslateRequest,
        ) -> Result<Vec<String>, TranslateError> {
            self.calls.borrow_mut().push(texts.len());
            Ok(texts.iter().map(|t| format!("<{t}>")).collect())
        }
    }

    struct Miscounting;

    impl Translator for Miscounting {
        fn translate(
            &self,
            _texts: &[String],
            _req: &TranslateRequest,
        ) -> Result<Vec<String>, TranslateError> {
            Ok(vec!["only one".into()])
        }
    }

    #[test]
    fn timings_survive_translation_exactly() {
        let cues = vec![cue(0.0, 1.5, "Hello"), cue(1.6, 3.25, "world")];
        let out = translate_cues(
            &cues,
            &MockTranslator::new([
                ("Hello".to_string(), "こんにちは".to_string()),
                ("world".to_string(), "世界".to_string()),
            ]),
            &TranslateRequest::to("ja"),
        )
        .unwrap();

        assert_eq!(out.len(), cues.len());
        for (a, b) in cues.iter().zip(&out) {
            assert_eq!(a.start, b.start, "start moved");
            assert_eq!(a.end, b.end, "end moved");
        }
        assert_eq!(out[0].text(), "こんにちは");
        assert_eq!(out[1].text(), "世界");
    }

    #[test]
    fn a_translation_that_outgrows_one_line_is_broken_across_two() {
        // Comfortably over 42 characters, comfortably under 84: this is the
        // case the line budget exists for.
        let long = "This sentence is a good deal longer than one subtitle line holds";
        let out = translate_cues(
            &[cue(0.0, 4.0, "short")],
            &MockTranslator::new([("short".to_string(), long.to_string())]),
            &TranslateRequest::to("en"),
        )
        .unwrap();

        assert_eq!(out[0].lines.len(), 2, "{:?}", out[0].lines);
        for line in &out[0].lines {
            assert!(
                line.chars().count() <= 42,
                "line over the Latin budget: {line}"
            );
        }
    }

    #[test]
    fn an_overlong_translation_overflows_rather_than_losing_its_ending() {
        // Longer than two lines can hold. The model is asked to keep
        // translations short and usually does, but when it does not, the
        // choice is overflow or truncation -- and truncation would delete
        // the end of a sentence the viewer needs.
        let huge = "This is a considerably longer sentence than the original was, and it                     keeps going well past anything that two subtitle lines could ever hold                     without spilling over the edge of the frame";
        let out = translate_cues(
            &[cue(0.0, 4.0, "short")],
            &MockTranslator::new([("short".to_string(), huge.to_string())]),
            &TranslateRequest::to("en"),
        )
        .unwrap();

        assert!(out[0].lines.len() <= MAX_LINES, "never a third line");
        assert_eq!(
            out[0].text().split_whitespace().collect::<Vec<_>>(),
            huge.split_whitespace().collect::<Vec<_>>(),
            "text was truncated to fit"
        );
    }

    #[test]
    fn cjk_output_is_wrapped_on_the_narrower_cjk_budget() {
        let cjk = "这是一句相当长的中文字幕需要换行才能读得舒服一点点";
        let out = translate_cues(
            &[cue(0.0, 4.0, "short")],
            &MockTranslator::new([("short".to_string(), cjk.to_string())]),
            &TranslateRequest::to("zh-Hans"),
        )
        .unwrap();

        assert!(out[0].lines.len() <= MAX_LINES);
        for line in &out[0].lines {
            assert!(
                line.chars().count() <= 20,
                "line over the CJK budget: {line}"
            );
        }
        // Rewrapping must not have inserted spaces into Chinese.
        assert!(!out[0].lines[0].contains(' '), "{:?}", out[0].lines);
    }

    #[test]
    fn no_text_is_lost_when_a_cue_is_rewrapped() {
        let cjk = "这是一句相当长的中文字幕需要换行才能读得舒服";
        let out = translate_cues(
            &[cue(0.0, 4.0, "x")],
            &MockTranslator::new([("x".to_string(), cjk.to_string())]),
            &TranslateRequest::to("zh-Hans"),
        )
        .unwrap();
        let rejoined: String = out[0]
            .lines
            .concat()
            .chars()
            .filter(|c| !c.is_whitespace())
            .collect();
        assert_eq!(rejoined, cjk);
    }

    #[test]
    fn a_multi_line_cue_is_translated_as_one_sentence() {
        // The source cue is two lines only because of the line budget; the
        // translator must see the sentence, not the fragments.
        let cues = vec![Cue {
            start: 0.0,
            end: 2.0,
            lines: vec!["Hello".into(), "world".into()],
        }];
        let out = translate_cues(
            &cues,
            &MockTranslator::new([("Hello world".to_string(), "你好世界".to_string())]),
            &TranslateRequest::to("zh-Hans"),
        )
        .unwrap();
        assert_eq!(out[0].text(), "你好世界");
    }

    #[test]
    fn a_miscounting_backend_is_rejected_rather_than_desynchronising_the_clip() {
        let cues = vec![cue(0.0, 1.0, "a"), cue(1.0, 2.0, "b")];
        assert_eq!(
            translate_cues(&cues, &Miscounting, &TranslateRequest::to("ja")),
            Err(TranslateError::CountMismatch { sent: 2, got: 1 })
        );
    }

    #[test]
    fn an_empty_translation_falls_back_to_the_original_line() {
        let out = translate_cues(
            &[cue(0.0, 1.0, "keep me")],
            &MockTranslator::new([("keep me".to_string(), "   ".to_string())]),
            &TranslateRequest::to("ja"),
        )
        .unwrap();
        assert_eq!(out[0].text(), "keep me");
    }

    #[test]
    fn long_clips_are_translated_in_bounded_batches() {
        let cues: Vec<Cue> = (0..MAX_BATCH * 2 + 5)
            .map(|i| cue(i as f64, i as f64 + 0.5, "line"))
            .collect();
        let counting = Counting {
            calls: std::cell::RefCell::new(Vec::new()),
        };
        let out = translate_cues(&cues, &counting, &TranslateRequest::to("ja")).unwrap();

        assert_eq!(out.len(), cues.len());
        let calls = counting.calls.borrow();
        assert_eq!(calls.as_slice(), &[MAX_BATCH, MAX_BATCH, 5]);
    }

    #[test]
    fn the_identity_translator_changes_nothing_at_all() {
        let cues = vec![cue(0.0, 1.0, "unchanged")];
        let out = translate_cues(&cues, &IdentityTranslator, &TranslateRequest::to("en")).unwrap();
        assert_eq!(out, cues);
    }

    #[test]
    fn no_cues_means_no_backend_call() {
        let counting = Counting {
            calls: std::cell::RefCell::new(Vec::new()),
        };
        assert!(translate_cues(&[], &counting, &TranslateRequest::to("ja"))
            .unwrap()
            .is_empty());
        assert!(counting.calls.borrow().is_empty());
    }

    #[test]
    fn applying_translations_directly_matches_going_through_a_backend() {
        // The browser path and the desktop path must not diverge on line
        // breaking, which is the only thing rewrapping decides.
        let cues = vec![cue(0.0, 2.0, "Hello world"), cue(2.5, 4.0, "second")];
        let translations = vec!["你好世界".to_string(), "第二".to_string()];

        let direct = apply_translations(&cues, &translations).unwrap();
        let via_backend = translate_cues(
            &cues,
            &MockTranslator::new([
                ("Hello world".to_string(), "你好世界".to_string()),
                ("second".to_string(), "第二".to_string()),
            ]),
            &TranslateRequest::to("zh-Hans"),
        )
        .unwrap();

        assert_eq!(direct, via_backend);
    }

    #[test]
    fn applying_the_wrong_number_of_translations_is_refused() {
        let cues = vec![cue(0.0, 1.0, "a"), cue(1.0, 2.0, "b")];
        assert_eq!(
            apply_translations(&cues, &["only one".to_string()]),
            Err(TranslateError::CountMismatch { sent: 2, got: 1 })
        );
    }
}

pub mod pricing;
