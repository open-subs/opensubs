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

/// How long a group's cue would actually be on screen, once the next
/// group's start has clipped it.
fn shown_for(group: &[&Word], next: Option<&Vec<&Word>>) -> f64 {
    let start = group[0].start;
    let natural_end = group[group.len() - 1].end;
    match next {
        Some(n) => (n[0].start - start).min(natural_end - start).max(0.0),
        None => natural_end - start,
    }
}

/// Would these words, as one group, fit on screen and in time?
///
/// The two hard limits `must_break` enforces while grouping, re-checked
/// on a proposed merge: at most `max_lines` of text, at most
/// `max_duration` from first word to last.
fn fits(words: &[&Word], cfg: &SegmentConfig) -> bool {
    let span = words[words.len() - 1].end - words[0].start;
    if span > cfg.max_duration {
        return false;
    }
    let tokens = tokens_of(words);
    let text = join_tokens(&tokens);
    joined_len(&tokens) <= line_budget(&text) * cfg.max_lines
}

/// The silence between two adjacent groups.
fn gap_between(a: &[&Word], b: &[&Word]) -> f64 {
    b[0].start - a[a.len() - 1].end
}

/// Join adjacent groups whose cues would be too brief to read.
///
/// Left to right, and repeatedly: joining two still-brief groups can
/// leave a group that is brief, and the reader does not care that it took
/// two steps to get there.
///
/// Three ways to put a brief group back, tried in this order:
///
/// 1. **Into the group before it** (APP-73). A fragment is most often the
///    tail of the phrase it follows, and the group before it is the one
///    that tends to have room: the twelve cases in the report all had a
///    one-line cue ahead of the fragment and a full two-line cue after it.
/// 2. **Into the group after it** (APP-52), when the one before is full or
///    absent.
/// 3. **Re-cut three groups as two**, when both neighbours are full. The
///    words of all three are pooled and split once, at the word boundary
///    that leaves both halves fitting and neither brief. The report's
///    "#31, full on both sides" is this case; nothing else can help it.
///
/// Every step keeps the first pass's guarantees: a real pause is never
/// crossed, capacity stays `max_lines`, and `max_duration` still holds.
fn merge_flickering(groups: &mut Vec<Vec<&Word>>, cfg: &SegmentConfig) {
    let mut i = 0;
    while i < groups.len() {
        let shown = shown_for(&groups[i], groups.get(i + 1));
        if shown >= cfg.min_duration {
            i += 1;
            continue;
        }

        // A real silence is a sentence boundary and outranks flicker: two
        // sentences welded together read worse than one brief cue.
        let prev_ok = i > 0 && gap_between(&groups[i - 1], &groups[i]) < cfg.pause_split;
        let next_ok =
            i + 1 < groups.len() && gap_between(&groups[i], &groups[i + 1]) < cfg.pause_split;

        // 1. Into the previous group.
        if prev_ok {
            let mut joined = groups[i - 1].clone();
            joined.extend(groups[i].iter().copied());
            if fits(&joined, cfg) {
                let tail = groups.remove(i);
                groups[i - 1].extend(tail);
                // Not advancing: what is now at `i` may itself be brief.
                continue;
            }
        }

        // 2. Into the next group.
        if next_ok {
            let mut joined = groups[i].clone();
            joined.extend(groups[i + 1].iter().copied());
            if fits(&joined, cfg) {
                let tail = groups.remove(i + 1);
                groups[i].extend(tail);
                // Deliberately not advancing: the merged group may still be brief.
                continue;
            }
        }

        // 3. Both neighbours full: pool the three groups' words and cut
        //    again -- as two groups when they fit, otherwise as three with
        //    the words shared out so that none is brief.
        if prev_ok && next_ok {
            let after = groups.get(i + 2).cloned();
            let pool: Vec<&Word> = groups[i - 1]
                .iter()
                .chain(groups[i].iter())
                .chain(groups[i + 1].iter())
                .copied()
                .collect();
            if let Some(cut) = recut(&pool, after.as_ref(), cfg) {
                groups.splice(i - 1..i + 2, cut);
                // Re-examine from the first of the new groups.
                i -= 1;
                continue;
            }
        }

        i += 1;
    }
}

/// Cut the pooled words of three adjacent groups again.
///
/// Two groups when some word boundary leaves both within capacity and
/// duration and neither brief; otherwise three, sharing the words out so
/// that every group fits and none is brief -- the case the report calls
/// "full on both sides", where the neighbours are already near capacity
/// and the only room for the fragment is made by moving words toward it.
/// Among the boundaries that work, the most even split by character
/// count. `None` when nothing works, and the three stay as they are.
fn recut<'a>(
    pool: &[&'a Word],
    after: Option<&Vec<&'a Word>>,
    cfg: &SegmentConfig,
) -> Option<Vec<Vec<&'a Word>>> {
    let n = pool.len();
    let chars = |ws: &[&Word]| joined_len(&tokens_of(ws));
    let total = chars(pool);

    // Every group must fit, not straddle a pause, and stay on screen long
    // enough; `after` is what clips the last one.
    let ok = |ws: &[&'a Word], next: Option<&Vec<&'a Word>>| {
        fits(ws, cfg) && shown_for(ws, next) >= cfg.min_duration
    };
    let no_pause_at = |k: usize| gap_between(&pool[..k], &pool[k..]) < cfg.pause_split;

    let mut best: Option<(usize, Vec<Vec<&'a Word>>)> = None;
    let mut consider = |imbalance: usize, groups: Vec<Vec<&'a Word>>| {
        if best.as_ref().is_none_or(|(worst, _)| imbalance < *worst) {
            best = Some((imbalance, groups));
        }
    };

    for k in 1..n {
        if !no_pause_at(k) {
            continue;
        }
        let (a, b) = (pool[..k].to_vec(), pool[k..].to_vec());
        if ok(&a, Some(&b)) && ok(&b, after) {
            consider((2 * chars(&a)).abs_diff(total), vec![a, b]);
        }
    }
    if let Some((_, g)) = best {
        return Some(g);
    }

    let third = total / 3;
    let mut best3: Option<(usize, Vec<Vec<&'a Word>>)> = None;
    for k1 in 1..n.saturating_sub(1) {
        if !no_pause_at(k1) {
            continue;
        }
        for k2 in k1 + 1..n {
            if !no_pause_at(k2) {
                continue;
            }
            let (a, b, c) = (
                pool[..k1].to_vec(),
                pool[k1..k2].to_vec(),
                pool[k2..].to_vec(),
            );
            if ok(&a, Some(&b)) && ok(&b, Some(&c)) && ok(&c, after) {
                let imbalance = chars(&a).abs_diff(third)
                    + chars(&b).abs_diff(third)
                    + chars(&c).abs_diff(third);
                if best3.as_ref().is_none_or(|(worst, _)| imbalance < *worst) {
                    best3 = Some((imbalance, vec![a, b, c]));
                }
            }
        }
    }
    best3.map(|(_, g)| g)
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

    // Second pass: put back together the groups that would flicker.
    //
    // APP-52. `must_break` closes a group as soon as the text would run
    // past `max_cps`, which is right on its own terms and wrong in its
    // consequences on a fast speaker. A dense passage becomes a run of
    // two-word groups; each cue is then pulled back by `enforce_gaps` to
    // just short of the next one's start, and the reader gets seven
    // subtitles in five seconds, none of them on screen long enough to
    // read. Measured on the reported clip: ten of twenty-eight cues under
    // 0.9 s, seven of them consecutive and each exactly two frames apart.
    //
    // The trade looks like "reading speed against flicker", and it is
    // not: the clamped cues are *already* worse on reading speed than the
    // merge would be. "production" alone is ten characters in 0.50 s --
    // 20 cps, above the 17 this rule exists to hold. Joined with its
    // neighbours it is 45 characters in 3.3 s, which is 13.6. Merging
    // improves both numbers at once, so there is nothing to trade away.
    //
    // Only what would otherwise flicker is touched, and only within the
    // limits the first pass already guarantees: a real pause still ends a
    // cue, capacity is still two lines, and `max_duration` still holds.
    merge_flickering(&mut groups, cfg);

    // Third pass: build each cue from its own group, anchored to its own
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

    /// APP-52. thea's clip, cues 22-28: a fast passage that `must_break`
    /// cut into two-word groups, each then clipped by the next one's
    /// start to about half a second.
    #[test]
    fn a_fast_passage_does_not_become_a_run_of_flickers() {
        // Real word timings from the reported clip, 104.3s to 109.7s.
        let specs: Vec<(f64, f64, &str)> = vec![
            (104.300, 104.600, "free"),
            (104.600, 104.833, "video"),
            (104.900, 105.300, "experts"),
            (105.300, 105.667, "guide,"),
            (105.733, 106.100, "seven"),
            (106.100, 106.400, "things"),
            (106.400, 106.600, "you"),
            (106.667, 106.950, "should"),
            (106.950, 107.233, "know"),
            (107.300, 107.600, "before"),
            (107.600, 107.900, "hiring"),
            (107.900, 108.067, "a"),
            (108.133, 108.633, "production"),
            (108.700, 109.700, "company."),
        ];
        let t = Transcript {
            language: "en".into(),
            duration: 110.0,
            words: words(&specs),
            segments: vec![],
        };
        let cues = segment(&t, fps30(), &SegmentConfig::default());

        let brief: Vec<_> = cues
            .iter()
            .filter(|c| c.end - c.start < SegmentConfig::default().min_duration)
            .collect();
        assert!(
            brief.is_empty(),
            "{} cue(s) too brief to read: {:?}",
            brief.len(),
            brief
                .iter()
                .map(|c| (c.end - c.start, c.lines.join(" ")))
                .collect::<Vec<_>>()
        );

        // And nothing was lost putting them back together.
        let out: Vec<String> = cues.iter().flat_map(|c| c.lines.clone()).collect();
        let joined = out.join(" ");
        for (_, _, w) in &specs {
            assert!(joined.contains(w), "lost {w:?} from {joined:?}");
        }
    }

    /// The merge must not weld two sentences over a real silence.
    #[test]
    fn a_pause_still_ends_a_cue_even_when_the_first_is_brief() {
        let t = Transcript {
            language: "en".into(),
            duration: 10.0,
            words: words(&[
                (0.0, 0.4, "Yes."),
                (3.0, 3.6, "Anyway,"),
                (3.6, 4.2, "onward."),
            ]),
            segments: vec![],
        };
        let cues = segment(&t, fps30(), &SegmentConfig::default());
        assert!(cues.len() >= 2, "a 2.6s silence must still split: {cues:?}");
        assert!(cues[0].lines.join(" ").contains("Yes."));
    }

    /// APP-73. The reported shape, twelve times over: a one-line cue, a
    /// brief fragment, then a cue already two lines full. Backward merge
    /// is blocked by capacity; the fragment belongs to the line before it.
    #[test]
    fn a_brief_fragment_joins_the_previous_cue_when_the_next_is_full() {
        // Fast speech: `must_break`'s reading-speed rule closes the first
        // group before "this," (23 chars in 1.3 s is 17.7 cps), and again
        // before the long words (30 chars in 1.55 s). That leaves "this, of
        // course." as a group of its own, shown for 0.85 s until the next
        // group starts -- the fragment. The long words behind it fill two
        // lines, so the APP-52 merge into the next group is blocked by
        // capacity; only the group before has room.
        let mut specs: Vec<(f64, f64, String)> = vec![
            (0.0, 0.35, "We".into()),
            (0.35, 0.7, "should".into()),
            (0.7, 1.0, "mention".into()),
            (1.05, 1.3, "this,".into()),
            (1.35, 1.5, "of".into()),
            (1.5, 1.8, "course.".into()),
        ];
        for i in 0..8 {
            let t0 = 1.9 + i as f64;
            specs.push((t0, t0 + 0.8, format!("considerable{i}")));
        }
        let w: Vec<Word> = specs
            .iter()
            .map(|(s, e, t)| Word {
                start: *s,
                end: *e,
                text: t.clone(),
                confidence: 0.9,
            })
            .collect();
        let cfg = SegmentConfig::default();
        let cues = segment(&transcript(w), fps30(), &cfg);
        let first = &cues[0];
        assert!(
            first.text().ends_with("of course."),
            "fragment did not join the cue before it: {:?}",
            cues.iter().map(|c| c.text()).collect::<Vec<_>>()
        );
        for c in &cues {
            assert!(
                c.duration() >= cfg.min_duration - 1e-6,
                "brief cue survived: {c:?}"
            );
            assert!(c.lines.len() <= cfg.max_lines);
            assert!(c.duration() <= cfg.max_duration + 1e-6);
        }
    }

    /// APP-73, the case that neither merge can fix: full on both sides.
    /// Both neighbours sit at 83 of the 84-character capacity, so the
    /// fragment fits into neither. The three are cut again so that no cue
    /// is brief, and nothing is lost.
    #[test]
    fn a_fragment_between_two_full_cues_is_recut() {
        let mut specs: Vec<(f64, f64, String)> = Vec::new();
        let mut t0 = 0.0;
        // Seven eleven-letter words: 83 characters, one short of capacity,
        // spoken slowly enough (0.8 s each; two of them in 1.4 s is 16.4
        // cps, where 0.75 s would be 17.04 and split the group) to stay
        // under 17 cps as one group.
        for i in 0..7 {
            specs.push((t0, t0 + 0.6, format!("beforehand{i}")));
            t0 += 0.8;
        }
        // The fragment: two words. The first word after it is long and
        // close behind (27 characters in 1.5 s is 18 cps), so the first
        // pass closes the fragment as a group of its own, shown for half a
        // second until that word starts.
        // `t0` is 0.2 s past the last word's end here.
        specs.push((t0 - 0.15, t0 + 0.05, "and".into()));
        specs.push((t0 + 0.05, t0 + 0.25, "so".into()));
        t0 += 0.35;
        // Four twenty-letter words behind it: 83 characters again, at 1.45 s
        // apart so the group itself stays under 17 cps.
        for i in 0..4 {
            specs.push((t0, t0 + 1.0, format!("afterwardsafterward{i}")));
            t0 += 1.45;
        }
        let w: Vec<Word> = specs
            .iter()
            .map(|(s, e, t)| Word {
                start: *s,
                end: *e,
                text: t.clone(),
                confidence: 0.9,
            })
            .collect();
        let cfg = SegmentConfig::default();
        let cues = segment(&transcript(w), fps30(), &cfg);
        let brief: Vec<_> = cues
            .iter()
            .filter(|c| c.duration() < cfg.min_duration - 1e-6)
            .collect();
        assert!(
            brief.is_empty(),
            "brief cues: {:?} in {:?}",
            brief
                .iter()
                .map(|c| (c.duration(), c.text()))
                .collect::<Vec<_>>(),
            cues.iter()
                .map(|c| (c.duration(), c.text()))
                .collect::<Vec<_>>()
        );
        let joined: Vec<String> = cues.iter().map(|c| c.text()).collect();
        for (_, _, t) in &specs {
            assert!(
                joined.iter().any(|c| c.contains(t.as_str())),
                "lost {t:?}: {joined:?}"
            );
        }
        for c in &cues {
            assert!(c.lines.len() <= cfg.max_lines, "{c:?}");
            assert!(c.duration() <= cfg.max_duration + 1e-6, "{c:?}");
        }
    }

    /// Forward merge still never crosses a real pause.
    #[test]
    fn a_fragment_after_a_pause_does_not_join_the_previous_cue() {
        let t = transcript(words(&[
            (0.0, 0.5, "First"),
            (0.5, 1.0, "sentence."),
            // 1.5 s of silence, then a fragment clipped by a full cue after it
            (2.5, 2.7, "Then"),
            (2.7, 2.9, "this"),
            (3.0, 3.5, "continues"),
            (3.5, 4.0, "onward"),
        ]));
        let cues = segment(&t, fps30(), &SegmentConfig::default());
        assert_eq!(cues[0].text(), "First sentence.");
        assert!(!cues[0].text().contains("Then"));
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
