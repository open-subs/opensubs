//! Where in the audio somebody is actually speaking, and what that does to
//! the timing of what Whisper wrote.
//!
//! Whisper's segment times are not speech times. A segment starts where the
//! decoder's window starts, and before the first word that is the start of
//! the file: a video that opens on ten seconds of silence came back with its
//! first segment at 0.0 s, and because word timings are spread across a
//! segment in proportion to their length, the first line was on screen
//! from the first frame, over silence. On Tears of Steel, whose first line
//! of dialogue is spoken at 23 s after the opening titles, the first
//! dialogue cue began at 20.0 s.
//!
//! A voice-activity detector says where the voice is. This module takes its
//! answer as plain spans and does the arithmetic: each segment is cut down to
//! the speech inside it, a segment with no speech under it is dropped (it is
//! the model writing over music or silence), and word timings are spread over
//! the voiced time only, so a pause inside a segment no longer drags the
//! words after it forward.
//!
//! Pure functions over numbers and strings, so they are tested directly; the
//! detector itself lives with the recogniser (`subs-whisper`).

use crate::{Segment, Transcript, Word};

/// A stretch of audio, in seconds, that holds a voice.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Span {
    pub start: f64,
    pub end: f64,
}

impl Span {
    pub fn new(start: f64, end: f64) -> Self {
        Self { start, end: end.max(start) }
    }

    fn len(&self) -> f64 {
        self.end - self.start
    }
}

/// Below this much speech in the whole clip, nobody is speaking in it.
///
/// Not zero, for the reason the web app gives for the same number: a cough
/// or a door can register a fraction of a second, and refusing to caption a
/// real interview because of it would be worse. Silence, a music bed and
/// room tone all measure 0.0 s here, so the margin is wide.
pub const ENOUGH_SPEECH_S: f64 = 1.5;

/// How much speech the spans hold, in seconds.
pub fn speech_seconds(speech: &[Span]) -> f64 {
    speech.iter().map(Span::len).sum()
}

/// Whether there is enough speech to be worth transcribing at all.
pub fn has_speech(speech: &[Span]) -> bool {
    speech_seconds(speech) >= ENOUGH_SPEECH_S
}

/// A segment keeps at least this much voiced time under it, or it goes.
const MIN_VOICED_S: f64 = 0.3;
/// ...unless the voiced time is at least this share of the segment, which
/// keeps a genuinely short "Yes." that the detector caught only in part.
const MIN_VOICED_SHARE: f64 = 0.25;
/// A segment may start this far ahead of the voice it carries. The
/// detector's edge sits a little after the first consonant, and a subtitle
/// a frame or two early reads better than one that clips the first word.
const LEAD_S: f64 = 0.1;
/// And end this far after it, for the same reason at the other end.
const TAIL_S: f64 = 0.25;
/// Voiced spans closer than this are one stretch of speech when spreading
/// words; a breath between two words is not a place for time to vanish.
const BRIDGE_S: f64 = 0.3;

/// The speech inside `[start, end]`, clipped to it.
fn voiced_within(speech: &[Span], start: f64, end: f64) -> Vec<Span> {
    speech
        .iter()
        .filter(|s| s.end > start && s.start < end)
        .map(|s| Span::new(s.start.max(start), s.end.min(end)))
        .filter(|s| s.len() > 0.0)
        .collect()
}

/// Cut each segment down to the speech under it, and drop the ones that
/// have none.
///
/// A segment's start moves forward to the first voice inside it (less
/// `LEAD_S`) and its end back to the last (plus `TAIL_S`); it never moves
/// outward, because Whisper's own boundaries are the outer limit of where
/// its words can be. Segments are taken in order and never overlap after
/// this, which `transcript_from_speech` relies on.
pub fn fit_to_speech(segments: &[Segment], speech: &[Span]) -> Vec<Segment> {
    let mut out: Vec<Segment> = Vec::with_capacity(segments.len());
    for seg in segments {
        let start = seg.start.max(out.last().map_or(f64::NEG_INFINITY, |p| p.end));
        let end = seg.end.max(start);
        let voiced = voiced_within(speech, start, end);
        let total: f64 = voiced.iter().map(Span::len).sum();
        let span = (end - start).max(1e-9);
        if total < MIN_VOICED_S && total / span < MIN_VOICED_SHARE {
            continue;
        }
        let (Some(first), Some(last)) = (voiced.first(), voiced.last()) else {
            continue;
        };
        let new_start = (first.start - LEAD_S).max(start);
        let new_end = (last.end + TAIL_S).min(end).max(new_start);
        out.push(Segment {
            start: new_start,
            end: new_end,
            text: seg.text.clone(),
        });
    }
    out
}

/// Characters after which a line of Chinese or Japanese can be broken.
const CJK_CLAUSE_END: &str = "，。！？、；：…,!?;";

fn is_cjk_letter(c: char) -> bool {
    matches!(
        c as u32,
        0x3040..=0x30FF | 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF | 0x20000..=0x2A6DF
    )
}

/// The pieces of a segment's text that word timings are spread over.
///
/// Whitespace-separated words, as before -- except that a run of Chinese or
/// Japanese, which has no spaces, is cut after each clause mark. Whisper
/// writes a Chinese sentence as one unbroken string, so without this a
/// twenty-second segment was one "word": one cue, padded to the seven-second
/// maximum and gone while the speaker was still talking, with nothing on
/// screen for the rest. Clauses give the segmenter somewhere to break, and
/// the pieces still join without spaces (`subs_subtitle::join_tokens`).
pub fn speech_tokens(text: &str) -> Vec<String> {
    token_spans(text).into_iter().map(|(t, _)| t).collect()
}

/// [`speech_tokens`], each with the index of its first character in `text`.
fn token_spans(text: &str) -> Vec<(String, usize)> {
    let chars: Vec<char> = text.chars().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }
        let from = i;
        while i < chars.len() && !chars[i].is_whitespace() {
            i += 1;
        }
        let word = &chars[from..i];
        if !word.iter().any(|&c| is_cjk_letter(c)) {
            out.push((word.iter().collect(), from));
            continue;
        }
        // Whisper often writes ASCII punctuation in Chinese -- "我叫小王,今年
        // 30歲," -- and once the text is cut there, an ASCII comma at the end
        // of one piece would be joined to the next with a space, which
        // Chinese does not have. After a Chinese or Japanese character it is
        // written as the full-width mark it stands for, one character for
        // one, so every timing index still lines up.
        let word: Vec<char> = word
            .iter()
            .enumerate()
            .map(|(k, &c)| {
                let beside_cjk = k.checked_sub(1).is_some_and(|p| is_cjk_letter(word[p]))
                    || word.get(k + 1).is_some_and(|&n| is_cjk_letter(n));
                match (beside_cjk, c) {
                    (true, ',') => '，',
                    (true, '!') => '！',
                    (true, '?') => '？',
                    (true, ';') => '；',
                    (true, ':') => '：',
                    (true, '.') => '。',
                    _ => c,
                }
            })
            .collect();
        let mut start = 0;
        for k in 0..word.len() {
            let next_is_mark = word.get(k + 1).is_some_and(|n| CJK_CLAUSE_END.contains(*n));
            if CJK_CLAUSE_END.contains(word[k]) && !next_is_mark {
                out.push((word[start..=k].iter().collect(), from + start));
                start = k + 1;
            }
        }
        if start < word.len() {
            out.push((word[start..].iter().collect(), from + start));
        }
    }
    out
}

/// One segment as Whisper wrote it, and -- when the recogniser could say --
/// when each of its characters was spoken.
///
/// whisper.cpp can align every token it writes to the audio (DTW over the
/// decoder's cross-attention). Those times are word-accurate where the
/// segment times are not: on Tears of Steel the segment holding "You're a
/// jerk, Tom!" claimed 7.0-16.0 s, while the alignment put "You" at
/// 23.30 s, against 23.0 s in the film's own subtitles.
#[derive(Debug, Clone, PartialEq)]
pub struct TimedSegment {
    pub start: f64,
    pub end: f64,
    pub text: String,
    /// One time per character of `text`, or `None` when there are none.
    pub char_times: Option<Vec<f64>>,
}

/// A word lasts at most this long plus `WORD_S_PER_CHAR` per character
/// when nothing after it says where it ends.
const WORD_BASE_S: f64 = 0.2;
const WORD_S_PER_CHAR: f64 = 0.08;
/// A Chinese or Japanese character is a syllable.
const CJK_S_PER_CHAR: f64 = 0.25;

fn longest_word(text: &str) -> f64 {
    let cjk = text.chars().filter(|&c| is_cjk_letter(c)).count();
    let other = text.chars().filter(|c| c.is_alphanumeric()).count().saturating_sub(cjk);
    WORD_BASE_S + WORD_S_PER_CHAR * other as f64 + CJK_S_PER_CHAR * cjk as f64
}

/// The words of a timed segment, each starting where its first character
/// was aligned and ending where the next word starts -- or sooner, when the
/// next word is a pause away, so a word does not stretch across a silence.
/// `None` when the segment carries no usable alignment.
pub fn aligned_words(seg: &TimedSegment, speech: Option<&[Span]>) -> Option<Vec<Word>> {
    let times = seg.char_times.as_ref()?;
    if times.len() != seg.text.chars().count() || times.iter().any(|t| !t.is_finite() || *t < 0.0) {
        return None;
    }
    let spans = token_spans(&seg.text);
    let mut starts: Vec<f64> = Vec::with_capacity(spans.len());
    let mut floor = f64::NEG_INFINITY;
    for (_, at) in &spans {
        // Alignment can step back by a frame; words never do.
        let t = times[*at].max(floor);
        floor = t;
        starts.push(t);
    }
    let mut words = Vec::with_capacity(spans.len());
    for (i, (text, _)) in spans.iter().enumerate() {
        let start = starts[i];
        let mut end = start + longest_word(text);
        if let Some(next) = starts.get(i + 1) {
            end = end.min(*next);
        } else {
            end = end.min(seg.end.max(start + 0.1));
        }
        // Not past the voice it belongs to, when the detector found one.
        if let Some(span) = speech.and_then(|sp| sp.iter().find(|s| s.start <= start + 0.05 && start < s.end + TAIL_S)) {
            end = end.min(span.end + TAIL_S);
        }
        words.push(Word { start, end: end.max(start + 0.05), text: text.clone(), confidence: 1.0 });
    }
    // Ends may not run past the next start after the minimum length above.
    for i in 0..words.len().saturating_sub(1) {
        if words[i].end > words[i + 1].start {
            words[i].end = words[i + 1].start.max(words[i].start);
        }
    }
    Some(words)
}

/// Whether an alignment can be believed for this segment.
///
/// The alignment is usually right where the segment times are wrong, but it
/// can fail too, and when it does it fails loudly. On speech that repeats --
/// the same eleven-second sentence looped for two minutes -- every loop
/// sounds alike, and the alignment spread the first segment's words over
/// nineteen seconds and crammed the second's 105 characters into 2.3. Two
/// tests catch that without second-guessing a good alignment: nobody speaks
/// faster than 25 characters a second, and a segment's words do not take
/// half as long again as the segment itself (with six seconds of grace,
/// for the zero-length segments whisper.cpp sometimes writes).
/// A segment that fails either is placed by its own times instead.
pub fn plausible_alignment(seg: &TimedSegment, words: &[Word]) -> bool {
    let (Some(first), Some(last)) = (words.first(), words.last()) else {
        return false;
    };
    let span = (last.end - first.start).max(1e-3);
    let chars = seg.text.chars().filter(|c| c.is_alphanumeric()).count() as f64;
    let own = (seg.end - seg.start).max(0.0);
    chars / span <= MAX_CHARS_PER_SECOND && span <= (own * 1.5).max(own + 6.0)
}

/// Faster than this is not speech; see `cleanup` for the same number.
const MAX_CHARS_PER_SECOND: f64 = 25.0;

/// Whether the detector heard a voice within `reach` seconds of a span.
///
/// The test for dropping an aligned segment is deliberately this loose.
/// The detector misses quiet or shouted lines under music -- it gave "You're
/// a jerk, Tom!" at 23.3 s probabilities of 0.1 to 0.4, below its threshold
/// -- and the alignment already places the words, so the detector only has
/// to rule out what is nowhere near any voice: the "Thank you." Whisper
/// wrote over the closing music, twenty-five seconds after the last line.
pub fn near_speech(speech: &[Span], start: f64, end: f64, reach: f64) -> bool {
    speech.iter().any(|s| s.end >= start - reach && s.start <= end + reach)
}

/// How far from any detected voice an aligned segment may sit and stay.
pub const NEAR_SPEECH_S: f64 = 1.0;

/// Times for a segment's words after the clean-up has edited its text,
/// taken from the words of the text as Whisper wrote it.
///
/// Clean-up only ever removes (annotations, a looped tail, an echo), so the
/// edited words are matched to the originals in order; a word that cannot
/// be matched takes the time of the one before it.
pub fn retime(cleaned: &str, original: &[Word]) -> Vec<Word> {
    let mut out = Vec::new();
    let mut k = 0usize;
    for token in speech_tokens(cleaned) {
        let found = original[k..].iter().position(|w| w.text == token);
        match found {
            Some(off) => {
                let w = &original[k + off];
                out.push(Word { text: token, ..w.clone() });
                k += off + 1;
            }
            None => {
                let (start, end) = out
                    .last()
                    .map(|w: &Word| (w.end, w.end + 0.2))
                    .or_else(|| original.get(k).map(|w| (w.start, w.end)))
                    .unwrap_or((0.0, 0.2));
                out.push(Word { start, end, text: token, confidence: 1.0 });
            }
        }
    }
    out
}

/// Spread `tokens` over the voiced time in `spans`, in proportion to their
/// length, as `synthesize_words` spreads them over a whole segment.
fn spread(tokens: &[String], spans: &[Span]) -> Vec<Word> {
    let chars: Vec<usize> = tokens.iter().map(|t| t.chars().count().max(1)).collect();
    let total_chars: usize = chars.iter().sum();
    let voiced: f64 = spans.iter().map(Span::len).sum();
    if tokens.is_empty() || voiced <= 0.0 {
        return Vec::new();
    }
    // Position `x` seconds into the voiced time, on the real clock. A point
    // exactly at the end of one span is, for a word *starting* there, the
    // beginning of the next one -- not the silence between them.
    let at = |x: f64, starting: bool| -> f64 {
        let mut left = x;
        for (i, s) in spans.iter().enumerate() {
            let last = i + 1 == spans.len();
            if left < s.len() - 1e-12 || (left <= s.len() + 1e-12 && (!starting || last)) {
                return s.start + left.min(s.len());
            }
            left -= s.len();
        }
        spans.last().map_or(0.0, |s| s.end)
    };
    let mut out = Vec::with_capacity(tokens.len());
    let mut done = 0usize;
    for (token, n) in tokens.iter().zip(&chars) {
        let from = voiced * done as f64 / total_chars as f64;
        done += n;
        let to = voiced * done as f64 / total_chars as f64;
        out.push(Word {
            start: at(from, true),
            end: at(to, false),
            text: token.clone(),
            confidence: 1.0,
        });
    }
    out
}

/// Join spans separated by less than `BRIDGE_S`.
fn bridged(spans: Vec<Span>) -> Vec<Span> {
    let mut out: Vec<Span> = Vec::new();
    for s in spans {
        match out.last_mut() {
            Some(prev) if s.start - prev.end < BRIDGE_S => prev.end = prev.end.max(s.end),
            _ => out.push(s),
        }
    }
    out
}

/// Build a transcript from segments that have already been fitted to the
/// speech (see [`fit_to_speech`]), with word timings over the voiced time.
///
/// `speech` of `None` means no detector ran, and every segment counts as
/// voiced from end to end -- the behaviour before this module existed,
/// except that Chinese and Japanese are still cut at clause marks.
pub fn transcript_from_speech(segments: Vec<Segment>, speech: Option<&[Span]>, language: &str) -> Transcript {
    let mut words = Vec::new();
    let mut duration: f64 = 0.0;
    for seg in &segments {
        duration = duration.max(seg.end);
        let tokens = speech_tokens(&seg.text);
        let spans = match speech {
            Some(speech) => {
                let inside = bridged(voiced_within(speech, seg.start, seg.end));
                if inside.is_empty() {
                    vec![Span::new(seg.start, seg.end)]
                } else {
                    // The lead and tail `fit_to_speech` allowed belong to the
                    // first and last word, not to the gap before them.
                    let mut inside = inside;
                    inside[0].start = seg.start;
                    let n = inside.len();
                    inside[n - 1].end = seg.end;
                    inside
                }
            }
            None => vec![Span::new(seg.start, seg.end)],
        };
        words.extend(spread(&tokens, &spans));
    }
    Transcript {
        language: language.to_string(),
        duration,
        words,
        segments,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: f64, end: f64, text: &str) -> Segment {
        Segment { start, end, text: text.into() }
    }

    #[test]
    fn a_first_segment_that_swallowed_the_silence_starts_where_the_voice_does() {
        // Whisper's first segment began at 0.0 on a clip with ten seconds of
        // silence first; the voice starts at 10.09 s.
        let fitted = fit_to_speech(
            &[seg(0.0, 13.2, "The ferry left before the light came up over the bay.")],
            &[Span::new(10.09, 13.0)],
        );
        assert_eq!(fitted.len(), 1);
        assert!((fitted[0].start - 9.99).abs() < 1e-9, "{:?}", fitted[0]);
        assert!(fitted[0].end <= 13.2 && fitted[0].end >= 13.0);
        let t = transcript_from_speech(fitted, Some(&[Span::new(10.09, 13.0)]), "en");
        assert!(t.words[0].start >= 9.9, "{:?}", t.words[0]);
        assert!(t.words.iter().all(|w| w.start >= 9.9));
    }

    #[test]
    fn a_segment_over_music_or_silence_is_dropped() {
        let fitted = fit_to_speech(
            &[seg(0.0, 7.0, "[BLANK_AUDIO]"), seg(20.0, 25.0, "You're a jerk, Tom.")],
            &[Span::new(22.8, 24.4)],
        );
        assert_eq!(fitted.len(), 1);
        assert_eq!(fitted[0].text, "You're a jerk, Tom.");
        assert!(fitted[0].start > 22.6);
    }

    #[test]
    fn a_short_answer_the_detector_caught_in_part_is_kept() {
        let fitted = fit_to_speech(&[seg(5.0, 5.5, "Yes.")], &[Span::new(5.1, 5.3)]);
        assert_eq!(fitted.len(), 1);
    }

    #[test]
    fn segments_never_move_outward() {
        let fitted = fit_to_speech(&[seg(2.0, 4.0, "hello there")], &[Span::new(1.0, 5.0)]);
        assert_eq!((fitted[0].start, fitted[0].end), (2.0, 4.0));
    }

    #[test]
    fn words_skip_a_pause_inside_a_segment() {
        // Two phrases with two seconds of silence between them, in one
        // segment: the second phrase's words must be after the pause.
        let speech = [Span::new(0.0, 1.0), Span::new(3.0, 4.0)];
        let t = transcript_from_speech(vec![seg(0.0, 4.0, "aaaa bbbb")], Some(&speech), "en");
        assert_eq!(t.words.len(), 2);
        assert!(t.words[0].end <= 1.0 + 1e-9, "{:?}", t.words[0]);
        assert!(t.words[1].start >= 3.0 - 1e-9, "{:?}", t.words[1]);
        assert!((t.words[1].end - 4.0).abs() < 1e-9);
    }

    #[test]
    fn chinese_is_cut_at_clause_marks() {
        assert_eq!(
            speech_tokens("下午三点，我们在车站见面。然后一起去看展览"),
            ["下午三点，", "我们在车站见面。", "然后一起去看展览"]
        );
        // Latin words are untouched, and a run of marks stays together.
        assert_eq!(speech_tokens("Hello, world"), ["Hello,", "world"]);
        assert_eq!(speech_tokens("真的吗？！好"), ["真的吗？！", "好"]);
        // ASCII marks after Chinese become the full-width ones, so the
        // pieces join without a space.
        assert_eq!(speech_tokens("我叫小王,今年30歲,在杭州."), ["我叫小王，", "今年30歲，", "在杭州。"]);
        assert_eq!(speech_tokens("随感路36,此次"), ["随感路36，", "此次"]);
        // A decimal point between digits is not a sentence end.
        assert_eq!(speech_tokens("3.5"), ["3.5"]);
        assert_eq!(speech_tokens("Librivox."), ["Librivox."]);
    }

    #[test]
    fn without_a_detector_every_segment_is_voiced_end_to_end() {
        let t = transcript_from_speech(vec![seg(1.0, 3.0, "one two")], None, "en");
        assert_eq!(t.words.first().unwrap().start, 1.0);
        assert!((t.words.last().unwrap().end - 3.0).abs() < 1e-9);
    }

    #[test]
    fn word_timings_are_ordered_and_inside_their_segment() {
        let speech = [Span::new(0.5, 1.5), Span::new(1.6, 2.0), Span::new(4.0, 6.0)];
        let fitted = fit_to_speech(&[seg(0.0, 6.5, "one two three four five six seven")], &speech);
        let t = transcript_from_speech(fitted.clone(), Some(&speech), "en");
        for pair in t.words.windows(2) {
            assert!(pair[1].start + 1e-9 >= pair[0].end, "{pair:?}");
        }
        assert!(t.words[0].start >= fitted[0].start - 1e-9);
        assert!(t.words.last().unwrap().end <= fitted[0].end + 1e-9);
    }

    fn timed(text: &str, times: Vec<f64>, start: f64, end: f64) -> TimedSegment {
        TimedSegment { start, end, text: text.into(), char_times: Some(times) }
    }

    /// Per-character times as the alignment gives them on Tears of Steel:
    /// the segment claimed 7.0 s; the words were spoken from 23.3 s.
    #[test]
    fn aligned_words_start_where_they_were_spoken_not_where_the_segment_claims() {
        let text = "You're a jerk, Tom!";
        let mut times = Vec::new();
        for (i, c) in text.chars().enumerate() {
            times.push(match i {
                0..=6 => 23.30,
                7..=8 => 23.48,
                9..=14 => 23.98,
                _ => 24.34,
            });
            let _ = c;
        }
        let words = aligned_words(&timed(text, times, 7.0, 16.0), None).unwrap();
        assert_eq!(words.len(), 4);
        assert!((words[0].start - 23.30).abs() < 1e-9);
        assert!(words[3].end < 25.5, "the last word does not stretch to the segment end: {:?}", words[3]);
        for pair in words.windows(2) {
            assert!(pair[1].start >= pair[0].end - 1e-9, "{pair:?}");
        }
    }

    /// The looped sentence: its first segment spread over 19 s, its second
    /// crammed into 2.3 s. Both are refused; Tears of Steel's moved but
    /// compact alignment is kept.
    #[test]
    fn an_alignment_that_stretches_or_crams_is_refused() {
        let text = "And so my fellow Americans ask not what your country can do for you, ask what you can do for your country.";
        let seg = |start: f64, end: f64| TimedSegment { start, end, text: text.into(), char_times: None };
        let words = |a: f64, b: f64| vec![
            Word { start: a, end: a + 0.3, text: "And".into(), confidence: 1.0 },
            Word { start: b - 0.3, end: b, text: "country.".into(), confidence: 1.0 },
        ];
        assert!(!plausible_alignment(&seg(0.0, 11.0), &words(0.52, 19.54)));
        assert!(!plausible_alignment(&seg(11.0, 22.0), &words(19.44, 21.78)));
        assert!(plausible_alignment(&seg(0.0, 11.0), &words(0.52, 10.4)));
        let jerk = TimedSegment { start: 7.0, end: 16.0, text: "You're a jerk, Tom!".into(), char_times: None };
        assert!(plausible_alignment(&jerk, &[
            Word { start: 23.30, end: 23.48, text: "You're".into(), confidence: 1.0 },
            Word { start: 24.34, end: 24.6, text: "Tom!".into(), confidence: 1.0 },
        ]));
    }

    #[test]
    fn a_word_does_not_stretch_across_a_pause() {
        let words = aligned_words(&timed("one two", vec![1.0, 1.0, 1.0, 1.0, 9.0, 9.0, 9.0], 1.0, 9.5), None).unwrap();
        assert!(words[0].end < 2.0, "{:?}", words[0]);
        assert_eq!(words[1].start, 9.0);
    }

    #[test]
    fn missing_or_mismatched_alignment_is_none() {
        assert!(aligned_words(&timed("ab", vec![1.0], 0.0, 1.0), None).is_none());
        assert!(aligned_words(&timed("ab", vec![1.0, -1.0], 0.0, 1.0), None).is_none());
        let none = TimedSegment { start: 0.0, end: 1.0, text: "ab".into(), char_times: None };
        assert!(aligned_words(&none, None).is_none());
    }

    #[test]
    fn a_line_far_from_any_voice_is_not_near_speech() {
        let speech = [Span::new(4.7, 10.1), Span::new(24.5, 62.4)];
        assert!(near_speech(&speech, 23.3, 24.5, NEAR_SPEECH_S));
        assert!(!near_speech(&speech, 87.75, 89.4, NEAR_SPEECH_S));
    }

    #[test]
    fn cleaned_text_keeps_the_times_of_the_words_it_kept() {
        let original = vec![
            Word { start: 1.0, end: 1.5, text: "[Music]".into(), confidence: 1.0 },
            Word { start: 4.8, end: 5.1, text: "We".into(), confidence: 1.0 },
            Word { start: 5.1, end: 5.4, text: "have".into(), confidence: 1.0 },
        ];
        let words = retime("We have", &original);
        assert_eq!(words.iter().map(|w| w.start).collect::<Vec<_>>(), [4.8, 5.1]);
    }

    #[test]
    fn enough_speech_is_measured_over_all_spans() {
        assert!(!has_speech(&[]));
        assert!(!has_speech(&[Span::new(0.0, 0.4), Span::new(3.0, 3.5)]));
        assert!(has_speech(&[Span::new(0.0, 1.0), Span::new(3.0, 3.6)]));
    }
}
