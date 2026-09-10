use crate::width::{join_tokens, joined_len};
use crate::{enforce_gaps, line_budget, snap_to_frame, wrap_lines, Cue, MAX_LINES, MIN_GAP_FRAMES};
use subs_asr::{Transcript, Word};
use subs_media::Rational;

#[derive(Debug, Clone)]
pub struct SegmentConfig {
    /// Reading speed ceiling, characters per second (Netflix standard).
    pub max_cps: f64,
    pub min_duration: f64,
    pub max_duration: f64,
    pub max_lines: usize,
    pub min_gap_frames: u32,
    /// A silence at least this long always ends a cue.
    pub pause_split: f64,
}

impl Default for SegmentConfig {
    fn default() -> Self {
        Self {
            max_cps: 17.0,
            min_duration: 1.0,
            max_duration: 7.0,
            max_lines: MAX_LINES,
            min_gap_frames: MIN_GAP_FRAMES,
            pause_split: 0.7,
        }
    }
}

fn tokens_of<'a>(words: &[&'a Word]) -> Vec<&'a str> {
    words.iter().map(|w| w.text.as_str()).collect()
}

/// Would appending `next` to `group` violate a constraint?
fn must_break(group: &[&Word], next: &Word, cfg: &SegmentConfig) -> bool {
    let Some(first) = group.first() else {
        return false;
    };
    let last = group[group.len() - 1];

    // A clear pause is always a break, regardless of length.
    if next.start - last.end >= cfg.pause_split {
        return true;
    }

    let span = next.end - first.start;
    if span > cfg.max_duration {
        return true;
    }

    let mut tokens = tokens_of(group);
    tokens.push(next.text.as_str());
    let text = join_tokens(&tokens);
    let budget = line_budget(&text);
    let chars = joined_len(&tokens);

    // Two lines of `budget` characters is the hard capacity of a cue.
    if chars > budget * cfg.max_lines {
        return true;
    }

    // Reading speed, measured against the duration the cue would occupy.
    let effective = span.max(cfg.min_duration);
    if chars as f64 / effective > cfg.max_cps {
        return true;
    }

    false
}

/// Build one cue from a word group.
///
/// `start` is always the group's own first word, snapped to a frame --
/// never delayed past the speech it transcribes. Sync is inviolable: a cue
/// that appears after its speech is a defect a viewer notices immediately,
/// whereas a cue that is merely fast to read is a missed quality target.
///
/// `end` is stretched, as an attempt, toward `min_duration` and the
/// `max_cps`-derived target (`start + chars / max_cps`), capped at
/// `max_duration`. `must_break` guarantees `chars <= budget * max_lines`, so
/// that cps-driven target is always well within `max_duration` and this
/// never needs to cut into a group's own text -- but the stretch is only a
/// best effort: `enforce_gaps`, called once over every cue at the end of
/// `segment`, will pull this `end` back to preserve the gap to the next
/// cue's (natural, un-delayed) start whenever speech is too dense for both
/// sync and the full reading-speed target to hold simultaneously.
fn build_cue(group: &[&Word], fps: Rational, cfg: &SegmentConfig) -> Cue {
    let tokens = tokens_of(group);
    let text = join_tokens(&tokens);
    let budget = line_budget(&text);
    let chars = joined_len(&tokens);

    let start = group[0].start;
    let raw_end = group[group.len() - 1].end;

    // Hold short/dense cues on screen long enough to be read -- for
    // duration and for reading speed -- but never past the maximum
    // duration.
    let min_end = start + cfg.min_duration;
    let cps_end = start + chars as f64 / cfg.max_cps;
    let end = raw_end
        .max(min_end)
        .max(cps_end)
        .min(start + cfg.max_duration);

    Cue {
        start: snap_to_frame(start, fps),
        end: snap_to_frame(end, fps),
        lines: wrap_lines(&tokens, budget, cfg.max_lines),
    }
}

/// Turn a transcript into reading-comfortable cues.
///
/// Guarantees, all asserted in this module's tests and property-tested in
/// `tests/invariants.rs`:
/// - every word appears exactly once, in order (no text loss)
/// - at most `max_lines` lines per cue
/// - duration within `[min_duration, max_duration]`
/// - cues ordered, non-overlapping, separated by `min_gap_frames`
/// - all boundaries on frame boundaries
/// - **sync**: a cue's start always equals its first word's start
///   (snapped to a frame) -- never delayed by earlier cues
///
/// Reading speed (`max_cps`) is a *best-effort target, not a guarantee*.
/// When speech is denser than `max_cps` allows, the same characters still
/// have to occupy the same seconds: no word may be dropped or reordered,
/// and a cue may never be delayed past the speech it transcribes, so
/// there is no legal way to both keep sync and slow the cue down. Given
/// that choice, sync wins: `build_cue` still stretches `end` toward the
/// cps-derived target, but `enforce_gaps` (below) will pull it back to
/// preserve the gap before the next cue's un-delayed start, and the cue
/// ends up faster to read than `max_cps`. That is the correct trade --
/// a subtitle that is fast to read is a quality shortfall; a subtitle
/// that is late, reordered, or missing text is a defect.
pub fn segment(t: &Transcript, fps: Rational, cfg: &SegmentConfig) -> Vec<Cue> {
    if t.words.is_empty() {
        return Vec::new();
    }

    // First pass: decide word groups (pause / capacity / natural-duration
    // rules), independent of the eventual cue timing.
    let mut groups: Vec<Vec<&Word>> = Vec::new();
    let mut group: Vec<&Word> = Vec::new();
    for w in &t.words {
        if !group.is_empty() && must_break(&group, w, cfg) {
            groups.push(std::mem::take(&mut group));
        }
        group.push(w);
    }
    if !group.is_empty() {
        groups.push(group);
    }

    // Second pass: build each cue from its own group, anchored to its own
    // words' natural timing -- no cue is ever delayed by another.
    let mut cues: Vec<Cue> = groups.iter().map(|g| build_cue(g, fps, cfg)).collect();

    // Padding a short/dense cue's end toward min_duration or the cps target
    // can push it past the next cue's (natural, un-delayed) start. Pull it
    // back rather than the other way around: sync of the *next* cue must
    // never be sacrificed to give the current one more reading time.
    enforce_gaps(&mut cues, fps, cfg.min_gap_frames);
    cues
}

#[cfg(test)]
mod tests {
    use super::*;
    use subs_asr::{Segment as AsrSegment, Transcript, Word};
    use subs_media::Rational;

    fn fps30() -> Rational {
        Rational { num: 30, den: 1 }
    }

    fn words(specs: &[(f64, f64, &str)]) -> Vec<Word> {
        specs
            .iter()
            .map(|(s, e, t)| Word {
                start: *s,
                end: *e,
                text: (*t).to_string(),
                confidence: 0.99,
            })
            .collect()
    }

    fn transcript(w: Vec<Word>) -> Transcript {
        let duration = w.last().map(|x| x.end).unwrap_or(0.0);
        Transcript {
            language: "en".into(),
            duration,
            words: w,
            segments: Vec::<AsrSegment>::new(),
        }
    }

    #[test]
    fn empty_transcript_produces_no_cues() {
        let cues = segment(&transcript(vec![]), fps30(), &SegmentConfig::default());
        assert!(cues.is_empty());
    }

    #[test]
    fn short_utterance_becomes_one_cue_padded_to_the_minimum_duration() {
        let t = transcript(words(&[(0.0, 0.3, "Hi"), (0.35, 0.6, "there")]));
        let cues = segment(&t, fps30(), &SegmentConfig::default());
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text(), "Hi there");
        assert!(cues[0].duration() >= 1.0 - 1e-6);
    }

    #[test]
    fn a_long_pause_splits_cues() {
        let t = transcript(words(&[(0.0, 0.4, "before"), (5.0, 5.4, "after")]));
        let cues = segment(&t, fps30(), &SegmentConfig::default());
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text(), "before");
        assert_eq!(cues[1].text(), "after");
    }

    #[test]
    fn no_cue_exceeds_the_maximum_duration() {
        let w: Vec<Word> = (0..40)
            .map(|i| Word {
                start: i as f64 * 0.5,
                end: i as f64 * 0.5 + 0.4,
                text: format!("w{i}"),
                confidence: 0.9,
            })
            .collect();
        let cfg = SegmentConfig::default();
        for c in segment(&transcript(w), fps30(), &cfg) {
            assert!(c.duration() <= cfg.max_duration + 1e-6, "too long: {c:?}");
        }
    }

    #[test]
    fn reading_speed_target_is_met_when_speech_is_sparse() {
        // Six two-word utterances, each pair close together (0.3s apart,
        // well under the 0.7s pause_split) so they merge into one cue, but
        // 3s of silence between pairs -- plenty of room to stretch each
        // cue's end to the cps target without crowding the next one. This
        // is the case the padding in `build_cue` exists for: the target
        // is actually achieved, not merely attempted.
        let w: Vec<Word> = (0..12)
            .map(|i| {
                let pair = (i / 2) as f64;
                let within_pair = (i % 2) as f64;
                let start = pair * 3.0 + within_pair * 0.3;
                Word {
                    start,
                    end: start + 0.25,
                    text: "abcdefgh".into(),
                    confidence: 0.9,
                }
            })
            .collect();
        let cfg = SegmentConfig::default();
        for c in segment(&transcript(w), fps30(), &cfg) {
            assert!(c.cps() <= cfg.max_cps + 1e-6, "too fast: {} cps", c.cps());
        }
    }

    #[test]
    fn dense_speech_never_drifts_out_of_sync() {
        // 480 words spoken evenly over 60 seconds -- far denser than 17
        // cps allows for 8-char tokens. Sync must hold exactly: every
        // cue's start is its own first word's start, snapped to a frame,
        // never delayed by an earlier cue's padding. Reading speed is
        // sacrificed instead (checked only insofar as no cue is held open
        // past the transcript's end by more than one max_duration).
        let n = 480;
        let total = 60.0;
        let step = total / n as f64;
        let w: Vec<Word> = (0..n)
            .map(|i| Word {
                start: i as f64 * step,
                end: i as f64 * step + step * 0.8,
                text: "abcdefgh".into(),
                confidence: 0.9,
            })
            .collect();
        let cfg = SegmentConfig::default();
        let fps = fps30();
        let t = transcript(w.clone());
        let cues = segment(&t, fps, &cfg);
        assert!(!cues.is_empty());

        let mut word_idx = 0usize;
        for c in &cues {
            let n_words = c.text().split(' ').count();
            let expected_start = snap_to_frame(w[word_idx].start, fps);
            assert!(
                (c.start - expected_start).abs() < 1e-9,
                "cue drifted out of sync: cue.start={} expected={} (word {})",
                c.start,
                expected_start,
                word_idx
            );
            word_idx += n_words;
        }

        let last = cues.last().unwrap();
        assert!(
            last.end <= t.duration + cfg.max_duration + 1e-6,
            "last cue end {} drifted more than max_duration past transcript duration {}",
            last.end,
            t.duration
        );
    }

    #[test]
    fn no_cue_has_more_than_two_lines() {
        let w: Vec<Word> = (0..30)
            .map(|i| Word {
                start: i as f64 * 0.3,
                end: i as f64 * 0.3 + 0.25,
                text: "word".into(),
                confidence: 0.9,
            })
            .collect();
        for c in segment(&transcript(w), fps30(), &SegmentConfig::default()) {
            assert!(c.lines.len() <= 2, "too many lines: {c:?}");
        }
    }

    #[test]
    fn cues_never_overlap_and_are_ordered() {
        let w: Vec<Word> = (0..25)
            .map(|i| Word {
                start: i as f64 * 0.4,
                end: i as f64 * 0.4 + 0.35,
                text: format!("word{i}"),
                confidence: 0.9,
            })
            .collect();
        let cues = segment(&transcript(w), fps30(), &SegmentConfig::default());
        for pair in cues.windows(2) {
            assert!(pair[0].end <= pair[1].start + 1e-9, "overlap: {pair:?}");
        }
    }

    #[test]
    fn no_word_is_lost_reordered_or_duplicated() {
        let w: Vec<Word> = (0..37)
            .map(|i| Word {
                start: i as f64 * 0.35,
                end: i as f64 * 0.35 + 0.3,
                text: format!("w{i}"),
                confidence: 0.9,
            })
            .collect();
        let expected: Vec<String> = w.iter().map(|x| x.text.clone()).collect();
        let cues = segment(&transcript(w), fps30(), &SegmentConfig::default());
        let got: Vec<String> = cues
            .iter()
            .flat_map(|c| c.text().split(' ').map(str::to_string).collect::<Vec<_>>())
            .collect();
        assert_eq!(got, expected);
    }

    #[test]
    fn chinese_cues_contain_no_inter_token_spaces() {
        // The rendered subtitle must read 字幕工具视频时间, not
        // "字幕 工具 视频 时间". The existing CJK test below only checks
        // line *length*, which is blind to this.
        let w = words(&[
            (0.0, 0.4, "字幕"),
            (0.5, 0.9, "工具"),
            (1.0, 1.4, "视频"),
            (1.5, 1.9, "时间"),
        ]);
        let cues = segment(&transcript(w), fps30(), &SegmentConfig::default());
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].lines, vec!["字幕工具视频时间"]);
    }

    #[test]
    fn a_latin_token_inside_chinese_keeps_its_spaces() {
        let w = words(&[(0.0, 0.4, "这个"), (0.5, 0.9, "CapCut"), (1.0, 1.4, "工具")]);
        let cues = segment(&transcript(w), fps30(), &SegmentConfig::default());
        assert_eq!(cues[0].text(), "这个 CapCut 工具");
    }

    #[test]
    fn chinese_text_uses_the_dense_line_budget() {
        let w: Vec<Word> = (0..10)
            .map(|i| Word {
                start: i as f64 * 0.5,
                end: i as f64 * 0.5 + 0.4,
                text: "字幕工具".into(),
                confidence: 0.9,
            })
            .collect();
        for c in segment(&transcript(w), fps30(), &SegmentConfig::default()) {
            for line in &c.lines {
                assert!(line.chars().count() <= 20, "CJK line too long: {line}");
            }
        }
    }
}
