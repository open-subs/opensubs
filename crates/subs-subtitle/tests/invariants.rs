use proptest::prelude::*;
use subs_asr::{Segment, Transcript, Word};
use subs_media::Rational;
use subs_subtitle::{segment, snap_to_frame, Cue, SegmentConfig};

/// Real CJK characters to build tokens from -- `is_cjk_dominant` decides by
/// Unicode code point range, so these must be actual CJK characters, not
/// placeholders.
const CJK_CHARS: [char; 10] = ['字', '幕', '工', '具', '视', '频', '时', '间', '轴', '测'];

/// Which script a generated word's token is built from. CJK-dominant text
/// takes the 20-character `MAX_CHARS_CJK` line budget instead of the
/// 42-character `MAX_CHARS_LATIN` one, which changes where every cue
/// boundary falls -- so the generator must exercise both, plus a
/// mixed-script token to exercise the majority-vote in `is_cjk_dominant`.
#[derive(Clone, Copy, Debug)]
enum Script {
    Latin,
    Cjk,
    Mixed,
}

/// Build a token's text for the given script, length, and a proptest-chosen
/// rotation offset into `CJK_CHARS` (so shrinking can still explore which
/// characters appear, not just how many).
fn make_token(script: Script, len: usize, offset: usize) -> String {
    let cjk_run = |n: usize| -> String {
        (0..n)
            .map(|i| CJK_CHARS[(offset + i) % CJK_CHARS.len()])
            .collect()
    };
    match script {
        Script::Latin => "x".repeat(len),
        Script::Cjk => cjk_run(len),
        Script::Mixed => {
            // A single token straddling both scripts, e.g. "yy字幕" --
            // exercises `is_cjk_dominant`'s majority-of-letters tie-break
            // within one word, not just across words in a cue.
            let cjk_len = (len / 2).max(1);
            let latin_len = len.saturating_sub(cjk_len).max(1);
            format!("{}{}", "y".repeat(latin_len), cjk_run(cjk_len))
        }
    }
}

/// Choose a script and token length for one word. Weighted so Latin and CJK
/// are both common (4:4) and mixed-script tokens occur but are rarer (1) --
/// the choice comes from `prop_oneof!`, a proptest combinator, so shrinking
/// still works (a failing case shrinks toward simpler scripts/lengths, it
/// doesn't just vanish). CJK tokens skew toward 1-4 characters, matching how
/// CJK words are typically shorter than Latin ones and more likely to
/// produce the multi-word cues where the 20-character budget actually bites.
fn word_spec_strategy() -> impl Strategy<Value = (Script, usize, usize)> {
    prop_oneof![
        4 => (1usize..12).prop_map(|len| (Script::Latin, len, 0usize)),
        4 => (1usize..5, 0usize..CJK_CHARS.len())
            .prop_map(|(len, offset)| (Script::Cjk, len, offset)),
        1 => (2usize..8, 0usize..CJK_CHARS.len())
            .prop_map(|(len, offset)| (Script::Mixed, len, offset)),
    ]
}

/// Generate a plausible transcript: monotonically advancing, non-overlapping
/// words with varied gaps, scripts, and token lengths. Gaps range from tight
/// (0.05s, well under `pause_split`) to long (1.2s, always a pause split),
/// and durations from short to long, so both sparse and dense speech are
/// exercised -- they take different paths through `must_break` and
/// `enforce_gaps`. Scripts vary per word (Latin, CJK, mixed), so both line
/// budgets and script-mixed cues are exercised too.
fn transcript_strategy() -> impl Strategy<Value = Transcript> {
    prop::collection::vec((word_spec_strategy(), 0.05f64..1.2, 0.05f64..0.9), 1..80).prop_map(
        |specs| {
            let mut cursor = 0.0f64;
            let mut words = Vec::new();
            for ((script, len, offset), gap, dur) in specs {
                cursor += gap;
                let start = cursor;
                let end = cursor + dur;
                cursor = end;
                words.push(Word {
                    start,
                    end,
                    text: make_token(script, len, offset),
                    confidence: 0.9,
                });
            }
            Transcript {
                language: "en".into(),
                duration: cursor,
                words,
                segments: Vec::<Segment>::new(),
            }
        },
    )
}

/// Walk the cues and consume `expected` from them, word by word, in order.
/// Returns how many words each cue accounted for.
///
/// This replaces the old `cue.text().split(' ')` reconstruction, which the
/// script-aware joiner broke: CJK tokens are now joined with no separator at
/// all (`字幕工具`, not `字幕 工具`), so there is nothing to split on.
///
/// The replacement is deliberately *stronger*, not weaker. Splitting on
/// spaces only ever compared a bag of substrings; this consumes each
/// expected word as an exact prefix, in input order, and then insists the
/// cue text is fully exhausted and that every input word was used. A
/// dropped, duplicated, reordered, truncated or silently-rewritten word all
/// fail here, and so does any stray character the segmenter invents.
///
/// Separator spaces are optional at each boundary precisely because the
/// joiner is script-aware; `Cue::text()` also rejoins wrapped lines with a
/// space, which is the same optional boundary.
fn consume_words(cues: &[Cue], expected: &[String]) -> Result<Vec<usize>, String> {
    let mut idx = 0usize;
    let mut per_cue = Vec::with_capacity(cues.len());

    for (ci, c) in cues.iter().enumerate() {
        let text = c.text();
        let mut rest: &str = &text;
        let mut n = 0usize;

        while !rest.is_empty() {
            if let Some(r) = rest.strip_prefix(' ') {
                rest = r;
                continue;
            }
            let want = expected.get(idx).ok_or_else(|| {
                format!(
                    "cue {ci} still has text {rest:?} after all {} input words were consumed",
                    expected.len()
                )
            })?;
            rest = rest.strip_prefix(want.as_str()).ok_or_else(|| {
                format!("cue {ci}: expected input word {idx} ({want:?}) at the start of {rest:?}")
            })?;
            idx += 1;
            n += 1;
        }

        per_cue.push(n);
    }

    if idx != expected.len() {
        return Err(format!(
            "only {idx} of {} input words appeared in the cues",
            expected.len()
        ));
    }
    Ok(per_cue)
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(400))]

    /// The invariant that matters most: segmentation is lossless. Every
    /// word must appear exactly once, in order -- nothing dropped,
    /// reordered, or duplicated. Text silently lost during segmentation is
    /// the classic subtitle bug and is invisible to eyeballing.
    #[test]
    fn no_word_is_lost_reordered_or_duplicated(t in transcript_strategy()) {
        let fps = Rational { num: 30, den: 1 };
        let cues = segment(&t, fps, &SegmentConfig::default());

        let expected: Vec<String> = t.words.iter().map(|w| w.text.clone()).collect();
        // Every input word, in order, exactly once, with nothing left over
        // in any cue -- see `consume_words`.
        prop_assert!(consume_words(&cues, &expected).is_ok(),
            "{}", consume_words(&cues, &expected).unwrap_err());
    }

    /// Zero sync drift: every cue's `start` equals `snap_to_frame` of its
    /// own first word's start. A cue is never delayed past the speech it
    /// transcribes -- reading speed (`max_cps`) is only a best-effort
    /// target, but sync is inviolable. To find "its own first word", the
    /// word sequence is reconstructed from the cues in order (the same
    /// reconstruction the no-word-loss property uses) and walked alongside
    /// the input words: each cue's `start` is checked against the snapped
    /// start of the input word sitting at that cue's first position.
    #[test]
    fn no_cue_drifts_out_of_sync(t in transcript_strategy()) {
        let fps = Rational { num: 30, den: 1 };
        let cues = segment(&t, fps, &SegmentConfig::default());

        let expected: Vec<String> = t.words.iter().map(|w| w.text.clone()).collect();
        let per_cue = consume_words(&cues, &expected)
            .map_err(TestCaseError::fail)?;

        let mut word_idx = 0usize;
        for (c, n_words) in cues.iter().zip(per_cue) {
            prop_assert!(word_idx < t.words.len());
            let expected_start = snap_to_frame(t.words[word_idx].start, fps);
            prop_assert!(
                (c.start - expected_start).abs() < 1e-9,
                "cue drifted out of sync: cue.start={} expected={} (word {})",
                c.start,
                expected_start,
                word_idx
            );
            word_idx += n_words;
        }
        prop_assert_eq!(word_idx, t.words.len());
    }

    #[test]
    fn cues_are_ordered_and_never_overlap(t in transcript_strategy()) {
        let fps = Rational { num: 30, den: 1 };
        let cues = segment(&t, fps, &SegmentConfig::default());
        for pair in cues.windows(2) {
            prop_assert!(pair[0].end <= pair[1].start + 1e-9);
        }
    }

    #[test]
    fn no_cue_is_inverted_or_empty(t in transcript_strategy()) {
        let fps = Rational { num: 30, den: 1 };
        for c in segment(&t, fps, &SegmentConfig::default()) {
            prop_assert!(c.end >= c.start);
            prop_assert!(!c.lines.is_empty());
        }
    }

    #[test]
    fn no_cue_exceeds_two_lines(t in transcript_strategy()) {
        let fps = Rational { num: 30, den: 1 };
        for c in segment(&t, fps, &SegmentConfig::default()) {
            prop_assert!(c.lines.len() <= 2);
        }
    }

    #[test]
    fn no_cue_exceeds_the_maximum_duration(t in transcript_strategy()) {
        let fps = Rational { num: 30, den: 1 };
        let cfg = SegmentConfig::default();
        for c in segment(&t, fps, &cfg) {
            prop_assert!(c.duration() <= cfg.max_duration + 1e-6);
        }
    }

    #[test]
    fn every_boundary_lands_on_a_frame(t in transcript_strategy()) {
        let fps = Rational { num: 30, den: 1 };
        let fd = fps.frame_duration();
        for c in segment(&t, fps, &SegmentConfig::default()) {
            for edge in [c.start, c.end] {
                let frames = edge / fd;
                prop_assert!(
                    (frames - frames.round()).abs() < 1e-6,
                    "edge {edge} is not on a frame boundary"
                );
            }
        }
    }
}
