//! Taking out what the recogniser wrote but nobody said.
//!
//! A port of the web app's `apps/web/src/lib/cleanup.ts`, so that the
//! desktop app and the CLI -- which run whisper.cpp rather than the
//! browser's Whisper -- read their output by the same rules. The reasoning
//! behind each rule is written up there, next to the measurements that
//! produced it; this file keeps the rules and enough of the why to follow
//! them.
//!
//! Whisper is a generative model. Over silence, music or applause it does
//! not fall silent; it writes what a subtitle file most often says at that
//! point -- "[Music]", "[BLANK_AUDIO]", "Thanks for watching!", a Korean
//! newsreader signing off. Each rule below removes something that cannot be
//! a transcript of the audio under it:
//!
//! 1. an annotation of a sound ("[Music]", "(applause)", "♪") rather than words;
//! 2. text in a script the language being spoken is not written in;
//! 3. one word or syllable repeated as a loop;
//! 4. one of the model's stock sign-offs over quiet audio;
//! 5. the previous line said again over quiet audio;
//! 6. a span that holds far more text than anyone can say in it, when a
//!    neighbour already carries the same words.
//!
//! What is *quiet* is relative: a segment whose level is under a third of
//! the median level of the clip's segments. The caller supplies the level.
//!
//! This file deliberately has no regex dependency; the patterns are small
//! enough to write as code.

use crate::Segment;

// --- scripts ------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum Script {
    Han,
    Kana,
    Hangul,
    Latin,
    Cyrillic,
    Arabic,
    Hebrew,
    Thai,
    Devanagari,
}

fn script_of(c: char) -> Option<Script> {
    let u = c as u32;
    Some(match u {
        0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF => Script::Han,
        0x3040..=0x30FF => Script::Kana,
        0x1100..=0x11FF | 0x3130..=0x318F | 0xAC00..=0xD7AF => Script::Hangul,
        0x41..=0x5A | 0x61..=0x7A | 0xC0..=0x24F => {
            // À-ɏ includes × and ÷, which are not letters.
            if u == 0xD7 || u == 0xF7 {
                return None;
            }
            Script::Latin
        }
        0x400..=0x4FF => Script::Cyrillic,
        0x600..=0x6FF | 0x750..=0x77F => Script::Arabic,
        0x590..=0x5FF => Script::Hebrew,
        0xE00..=0xE7F => Script::Thai,
        0x900..=0x97F => Script::Devanagari,
        _ => return None,
    })
}

/// Below this share of the text, a script is incidental: one 漢字 in an
/// English sentence does not make it Chinese.
const SCRIPT_SHARE: f64 = 0.2;

/// Every script with a meaningful share of the characters in `text`.
pub fn scripts_in(text: &str) -> Vec<Script> {
    let mut counts: Vec<(Script, usize)> = Vec::new();
    let mut total = 0usize;
    for c in text.chars() {
        if let Some(s) = script_of(c) {
            total += 1;
            match counts.iter_mut().find(|(k, _)| *k == s) {
                Some((_, n)) => *n += 1,
                None => counts.push((s, 1)),
            }
        }
    }
    if total == 0 {
        return Vec::new();
    }
    counts
        .into_iter()
        .filter(|(_, n)| *n as f64 / total as f64 >= SCRIPT_SHARE)
        .map(|(s, _)| s)
        .collect()
}

/// Which scripts a language is written in. Latin is allowed everywhere,
/// because every language borrows names and acronyms unchanged.
fn written_in(language: &str) -> Option<&'static [Script]> {
    use Script::*;
    let base = language.split(['-', '_']).next().unwrap_or("").to_ascii_lowercase();
    Some(match base.as_str() {
        "zh" | "yue" => &[Han, Latin],
        "ja" => &[Kana, Han, Latin],
        "ko" => &[Hangul, Han, Latin],
        "ru" | "uk" => &[Cyrillic, Latin],
        "ar" | "fa" | "ur" => &[Arabic, Latin],
        "he" => &[Hebrew, Latin],
        "th" => &[Thai, Latin],
        "hi" | "mr" | "ne" => &[Devanagari, Latin],
        _ => return None,
    })
}

const LATIN_ONLY: &[Script] = &[Script::Latin];

/// Whether text could have been spoken in `language`. Mandarin audio does
/// not produce a Korean sentence, however the decoder felt about it.
pub fn script_fits(language: &str, text: &str) -> bool {
    let found = scripts_in(text);
    if found.is_empty() {
        return true;
    }
    let allowed = written_in(language).unwrap_or(LATIN_ONLY);
    found.iter().all(|s| allowed.contains(s))
}

/// Whether a line is written only in Latin, in a language that is not.
/// A bare "you" at the end of a Japanese lesson is the model's, not the
/// speaker's.
pub fn foreign_only(language: &str, text: &str) -> bool {
    let found = scripts_in(text);
    if found != [Script::Latin] {
        return false;
    }
    written_in(language).is_some_and(|w| w[0] != Script::Latin)
}

// --- repetition ---------------------------------------------------------

/// Case, spacing, punctuation and symbols removed, for comparing lines.
pub fn bare(text: &str) -> String {
    text.chars().filter(|c| c.is_alphanumeric()).flat_map(char::to_lowercase).collect()
}

/// A line that is one short piece of text repeated, and nothing else.
#[derive(Debug, Clone, PartialEq)]
pub struct Stutter {
    pub unit: String,
    pub repeats: usize,
}

/// Fewer repeats than this is not repetition at all.
const MIN_STUTTER: usize = 3;
/// Below this many repeats a run of one character is laughter (哈哈哈).
const SINGLE_CHARACTER_LOOP: usize = 6;
/// At this many repeats a word alone on a line is a loop whatever the audio.
const LOOP_REPEATS: usize = 4;

/// Find the loop in a line, if the line is nothing but one.
pub fn stutter_of(text: &str) -> Option<Stutter> {
    let words: Vec<&str> = text.split_whitespace().filter(|w| !bare(w).is_empty()).collect();
    if words.len() >= MIN_STUTTER {
        let first = bare(words[0]);
        if words.iter().all(|w| bare(w) == first) {
            return Some(Stutter { unit: words[0].to_string(), repeats: words.len() });
        }
    }
    // The same for scripts without spaces between words.
    let flat: Vec<char> = bare(text).chars().collect();
    let mut size = 1;
    while size * MIN_STUTTER <= flat.len() {
        if flat.len() % size == 0 {
            let head = &flat[..size];
            if flat.chunks(size).all(|c| c == head) {
                let repeats = flat.len() / size;
                if size > 1 || repeats >= SINGLE_CHARACTER_LOOP {
                    return Some(Stutter { unit: head.iter().collect(), repeats });
                }
            }
        }
        size += 1;
    }
    None
}

// --- the model's own sign-offs -----------------------------------------

/// Lines Whisper writes when it has nothing to transcribe, as `bare` text.
const SIGN_OFFS: &[&str] = &[
    // English
    "thankyou", "thanksforwatching", "thankyouforwatching", "thanksforwatchingthisvideo",
    "pleasesubscribe", "pleasesubscribetomychannel", "dontforgettosubscribe",
    "subtitlesbytheamaraorgcommunity", "subtitlesbyamaraorg", "transcriptionbycastingwords",
    "bye", "byebye", "thanks", "you",
    // Chinese
    "字幕由amaraorg社群提供", "字幕由amaraorg社区提供", "谢谢观看", "謝謝觀看",
    "谢谢大家", "請不吝點贊訂閱轉發打賞支持明鏡與點點欄目",
    "请不吝点赞订阅转发打赏支持明镜与点点栏目", "明鏡與點點欄目", "字幕志願者",
    "下次再見", "下次再见", "感謝觀看", "感谢收看",
    // Japanese
    "ご視聴ありがとうございました", "ご視聴ありがとうございます",
    "最後までご視聴いただきありがとうございました", "チャンネル登録お願いします",
    "おやすみなさい", "ありがとうございました",
    // Korean
    "시청해주셔서감사합니다", "구독과좋아요부탁드립니다", "감사합니다",
];

fn is_sign_off_word(flat: &str) -> bool {
    SIGN_OFFS.contains(&flat)
}

/// Whether a whole line is one of the model's stock sign-offs.
pub fn is_sign_off(text: &str) -> bool {
    let flat = bare(text);
    if is_sign_off_word(&flat) {
        return true;
    }
    // "MBC 뉴스 김철수입니다": the name changes, the frame does not.
    ["mbc뉴스", "kbs뉴스", "sbs뉴스", "ytn뉴스"].iter().any(|p| flat.starts_with(p))
}

/// The vocabulary a subtitle annotation is built from, as `bare` words.
///
/// The web list, plus what whisper.cpp writes that the browser's Whisper
/// does not: `[BLANK_AUDIO]` over silence, and `[Birds chirping]`-style
/// sound descriptions over room tone.
const NON_SPEECH_WORDS: &[&str] = &[
    "music", "musical", "applause", "laughter", "laughs", "laughing",
    "clapping", "cheering", "cheers", "silence", "instrumental",
    "playing", "plays", "outro", "intro", "theme", "song", "singing",
    "sound", "sounds", "noise", "static", "beeping", "upbeat",
    "音乐", "掌声", "拍手", "笑声",
    "blank", "audio", "inaudible", "chirping", "birds", "wind", "blowing",
    "footsteps", "sighs", "breathing", "coughing", "humming", "whistling",
    "speakingforeignlanguage", "foreign", "speaking", "language", "音樂", "笑聲", "掌聲",
];

fn is_non_speech_word(flat: &str) -> bool {
    NON_SPEECH_WORDS.contains(&flat)
}

/// Bracket halves and note glyphs, matched singly so an unclosed one counts.
const ANNOTATION_MARKS: &str = "[]()（）【】♪♫*_-";

/// Words that mean a line is somebody talking, not a caption of a sound.
const FUNCTION_WORDS: &[&str] = &[
    "a", "an", "the", "and", "or", "but", "of", "to", "in", "on", "at", "for",
    "with", "from", "by", "as", "is", "are", "was", "were", "be", "been",
    "i", "we", "you", "he", "she", "it", "they", "this", "that", "these", "those",
    "my", "our", "your", "his", "her", "its", "their", "not", "no", "so", "if",
];

/// How much of a line must be annotation vocabulary for the line to be one.
const NON_SPEECH_SHARE: f64 = 0.6;

fn ends_sentence(text: &str) -> bool {
    text.trim_end().chars().last().is_some_and(|c| ".!?。！？…".contains(c))
}

/// Whether a whole line is the model naming a sound rather than words.
pub fn is_non_speech(text: &str) -> bool {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return true;
    }
    let spaced: String = trimmed.chars().map(|c| if ANNOTATION_MARKS.contains(c) { ' ' } else { c }).collect();
    let words: Vec<String> = spaced.split_whitespace().map(bare).filter(|w| !w.is_empty()).collect();
    if words.is_empty() {
        return true; // brackets and note glyphs only
    }
    // A bracketed annotation is one whatever is inside it: "[BLANK_AUDIO]".
    if (trimmed.starts_with('[') && trimmed.ends_with(']')) && !trimmed[1..trimmed.len() - 1].contains(['[', ']']) {
        return true;
    }
    if ends_sentence(trimmed) {
        return false;
    }
    if words.iter().any(|w| FUNCTION_WORDS.contains(&w.as_str())) {
        return false;
    }
    let known = words.iter().filter(|w| is_non_speech_word(w)).count();
    known > 0 && known as f64 / words.len() as f64 >= NON_SPEECH_SHARE
}

/// Take sound annotations out of the middle of a line.
///
/// whisper.cpp puts them inline -- "[Music] [Music] We have main engine
/// start." and "[Music] This is" -- where the whole-line rule cannot see
/// them. A bracketed run is removed when everything in it is annotation
/// vocabulary (or it is all capitals, which is how whisper.cpp writes its
/// own markers), and so is a run of note glyphs. Anything else in brackets
/// is somebody's words and stays.
pub fn strip_annotations(text: &str) -> String {
    let chars: Vec<char> = text.chars().collect();
    let mut out = String::with_capacity(text.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let close = match c {
            '[' => Some(']'),
            '(' => Some(')'),
            '（' => Some('）'),
            '【' => Some('】'),
            _ => None,
        };
        if let Some(close) = close {
            if let Some(len) = chars[i + 1..].iter().position(|&x| x == close) {
                let inner: String = chars[i + 1..i + 1 + len].iter().collect();
                let words: Vec<String> = inner
                    .split(|ch: char| ch.is_whitespace() || ch == '_' || ch == '-')
                    .map(bare)
                    .filter(|w| !w.is_empty())
                    .collect();
                let all_caps = inner.chars().any(char::is_alphabetic)
                    && inner.chars().filter(|ch| ch.is_alphabetic()).all(char::is_uppercase);
                let annotation = !words.is_empty()
                    && (words.iter().all(|w| is_non_speech_word(w)) || (c == '[' && all_caps));
                if annotation || inner.chars().all(|ch| ch == '♪' || ch == '♫' || ch.is_whitespace()) {
                    i += len + 2;
                    continue;
                }
            }
        }
        if c == '♪' || c == '♫' {
            i += 1;
            continue;
        }
        out.push(c);
        i += 1;
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Cut a loop off the end of a line, with the audio-event word before it:
/// "...pairs of jeans. music you you" keeps "...pairs of jeans.".
pub fn trim_tail(text: &str) -> String {
    let words: Vec<&str> = text.split_whitespace().collect();
    let Some(last) = words.last() else {
        return text.to_string();
    };
    let lower = last.to_lowercase();
    let run = words.iter().rev().take_while(|w| w.to_lowercase() == lower).count();
    if run < 2 || !is_sign_off_word(&bare(last)) {
        return text.to_string();
    }
    let mut kept: Vec<&str> = words[..words.len() - run].to_vec();
    if let Some(w) = kept.last() {
        let b = bare(w);
        if matches!(b.as_str(), "music" | "applause" | "laughter") || (!w.is_empty() && w.chars().all(|c| c == '♪')) {
            kept.pop();
        }
    }
    kept.join(" ").trim().to_string()
}

/// Cut a debris tail -- sign-offs and sound words after the last finished
/// sentence -- off the line a loop is about to continue.
pub fn trim_debris_tail(text: &str) -> String {
    // The end of the last sentence-final mark (plus closing quotes).
    let chars: Vec<char> = text.chars().collect();
    let mut from = 0usize;
    for (i, &c) in chars.iter().enumerate() {
        if ".!?。！？…".contains(c) {
            let mut j = i + 1;
            while j < chars.len() && "\"'”’)）]】".contains(chars[j]) {
                j += 1;
            }
            from = j;
        }
    }
    let head: String = chars[..from].iter().collect();
    let tail: String = chars[from..].iter().collect();
    let tail = tail.trim();
    if tail.is_empty() {
        return text.to_string();
    }
    let debris = tail.split_whitespace().all(|w| {
        let b = bare(w);
        !b.is_empty() && (is_sign_off_word(&b) || is_non_speech_word(&b))
    });
    if debris {
        head.trim().to_string()
    } else {
        text.to_string()
    }
}

/// Shorter than this, a repeat inside one line is a coincidence.
const MIN_ECHO: usize = 6;

/// Cut a phrase the line has already said, when the line ends on it.
pub fn trim_inline_echo(text: &str) -> String {
    let trimmed = text.trim();
    let body: Vec<char> = trimmed.trim_end_matches(|c: char| "。．.!！?？…".contains(c)).chars().collect();
    if body.len() < MIN_ECHO * 2 {
        return text.to_string();
    }
    let mut n = body.len() / 2;
    while n >= MIN_ECHO {
        let tail = &body[body.len() - n..];
        if tail.iter().any(|c| !c.is_whitespace()) {
            let head = &body[..body.len() - n];
            if head.windows(n).any(|w| w == tail) {
                return head.iter().collect::<String>().trim_end().to_string();
            }
        }
        n -= 1;
    }
    text.to_string()
}

/// The longest run of characters two strings share, as a share of the shorter.
fn overlap(a: &[char], b: &[char]) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    let mut best = 0usize;
    let mut prev = vec![0usize; b.len() + 1];
    for i in 1..=a.len() {
        let mut cur = vec![0usize; b.len() + 1];
        for j in 1..=b.len() {
            if a[i - 1] == b[j - 1] {
                cur[j] = prev[j - 1] + 1;
                best = best.max(cur[j]);
            }
        }
        prev = cur;
    }
    best as f64 / a.len().min(b.len()) as f64
}

const MIN_CRAMMED_CHARS: usize = 30;
const MAX_CHARS_PER_SECOND: f64 = 25.0;
const REPEAT_NEAR_S: f64 = 12.0;
const REPEAT_OVERLAP: f64 = 0.6;

/// A span that could not hold the words given to it, where a neighbour
/// already says the same words at a speakable pace.
fn crammed_repeat(segments: &[Segment], texts: &[String], i: usize) -> bool {
    let span = segments[i].end - segments[i].start;
    let flat: Vec<char> = bare(&texts[i]).chars().collect();
    if span <= 0.0 || flat.len() < MIN_CRAMMED_CHARS || (flat.len() as f64 / span) < MAX_CHARS_PER_SECOND {
        return false;
    }
    for j in [i as isize - 2, i as isize - 1, i as isize + 1, i as isize + 2] {
        if j < 0 || j as usize >= texts.len() {
            continue;
        }
        let j = j as usize;
        if (segments[j].start - segments[i].start).abs() > REPEAT_NEAR_S {
            continue;
        }
        let other: Vec<char> = bare(&texts[j]).chars().collect();
        if overlap(&flat, &other) >= REPEAT_OVERLAP {
            return true;
        }
    }
    false
}

/// A line short and plain enough to be swallowed by an annotation block.
fn swallowable(text: &str) -> bool {
    let t = text.trim();
    !t.is_empty() && !ends_sentence(t) && t.split_whitespace().count() <= SWALLOW_WORDS
}
const SWALLOW_WORDS: usize = 3;
const SWALLOW_GAP_S: f64 = 2.0;
const SWALLOW_REACH: usize = 4;

/// Three consecutive segments saying the same thing are a loop.
const LOOP_RUN: usize = 3;
/// How quiet, against the clip's own median segment level, is nothing.
const QUIET_RATIO: f64 = 0.35;
/// Two identical lines further apart than this are two identical lines.
const REPEAT_WINDOW_S: f64 = 30.0;
/// Short enough that repeating it proves nothing.
const MIN_REPEAT_CHARS: usize = 4;

/// Why a segment was taken out, for a caller that wants to say.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reason {
    Annotation,
    Script,
    Stutter,
    SignOff,
    Repeat,
}

#[derive(Debug, Clone, Default)]
pub struct CleanUp {
    pub kept: Vec<Segment>,
    pub removed: Vec<(Segment, Reason)>,
}

fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let m = v.len() / 2;
    if v.len() % 2 == 1 {
        v[m]
    } else {
        (v[m - 1] + v[m]) / 2.0
    }
}

/// Remove the segments that cannot be a transcript of their own audio.
///
/// `level(from, to)` is the RMS of the audio between two times in seconds;
/// `language` is the language being read.
pub fn clean_up(segments: &[Segment], level: impl Fn(f64, f64) -> f64, language: &str) -> CleanUp {
    if segments.is_empty() {
        return CleanUp::default();
    }
    let mut texts: Vec<String> = segments
        .iter()
        .map(|s| trim_inline_echo(&trim_tail(&strip_annotations(&s.text))))
        .collect();

    // Runs of identical consecutive lines.
    let n = texts.len();
    let mut run_start: Vec<usize> = (0..n).collect();
    for i in 1..n {
        let b = bare(&texts[i]);
        if !b.is_empty() && b == bare(&texts[i - 1]) {
            run_start[i] = run_start[i - 1];
        }
    }
    let mut run_length = vec![1usize; n];
    for i in 0..n {
        run_length[run_start[i]] = i - run_start[i] + 1;
    }
    for i in 1..n {
        if i == run_start[i] && run_length[i] >= LOOP_RUN && is_sign_off_word(&bare(&texts[i])) {
            texts[i - 1] = trim_debris_tail(&texts[i - 1]);
        }
    }

    // Annotation blocks, grown over short unpunctuated neighbours.
    let mut annotation: Vec<bool> = texts.iter().map(|t| is_non_speech(t)).collect();
    // A line that was nothing but inline annotations is now empty.
    for (i, t) in texts.iter().enumerate() {
        if t.trim().is_empty() {
            annotation[i] = true;
        }
    }
    for _ in 0..SWALLOW_REACH {
        let mut grew = false;
        for i in 0..n {
            if !annotation[i] {
                continue;
            }
            for j in [i.wrapping_sub(1), i + 1] {
                if j >= n || annotation[j] {
                    continue;
                }
                let gap = if j < i { segments[i].start - segments[j].end } else { segments[j].start - segments[i].end };
                if gap > SWALLOW_GAP_S || !swallowable(&texts[j]) {
                    continue;
                }
                annotation[j] = true;
                grew = true;
            }
        }
        if !grew {
            break;
        }
    }

    let levels: Vec<f64> = segments.iter().map(|s| level(s.start, s.end)).collect();
    let reference = median(levels.iter().copied().filter(|l| *l > 0.0).collect());
    let quiet = |i: usize| reference > 0.0 && levels[i] < reference * QUIET_RATIO;

    let mut out = CleanUp::default();
    let mut kept_at: Vec<usize> = Vec::new();
    for (i, segment) in segments.iter().enumerate() {
        let text = texts[i].clone();
        let drop = |reason| (segment.clone(), reason);
        if text.trim().is_empty() || annotation[i] {
            out.removed.push(drop(Reason::Annotation));
            continue;
        }
        if crammed_repeat(segments, &texts, i) {
            out.removed.push(drop(Reason::Repeat));
            continue;
        }
        if run_length[run_start[i]] >= LOOP_RUN && (is_sign_off_word(&bare(&text)) || i != run_start[i]) {
            out.removed.push(drop(Reason::Repeat));
            continue;
        }
        if !script_fits(language, &text) {
            out.removed.push(drop(Reason::Script));
            continue;
        }
        if let Some(st) = stutter_of(&text) {
            if st.repeats >= LOOP_REPEATS || quiet(i) || is_sign_off_word(&bare(&st.unit)) {
                out.removed.push(drop(Reason::Stutter));
                continue;
            }
        }
        if is_sign_off(&text) && (quiet(i) || foreign_only(language, &text)) {
            out.removed.push(drop(Reason::SignOff));
            continue;
        }
        if let (Some(prev), Some(&prev_i)) = (out.kept.last(), kept_at.last()) {
            let pb = bare(&prev.text);
            if pb.chars().count() >= MIN_REPEAT_CHARS
                && pb == bare(&text)
                && segment.start - prev.end <= REPEAT_WINDOW_S
                && (quiet(i) || quiet(prev_i))
            {
                out.removed.push(drop(Reason::Repeat));
                continue;
            }
        }
        out.kept.push(Segment { start: segment.start, end: segment.end, text });
        kept_at.push(i);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seg(start: f64, end: f64, text: &str) -> Segment {
        Segment { start, end, text: text.into() }
    }

    fn texts(c: &CleanUp) -> Vec<&str> {
        c.kept.iter().map(|s| s.text.as_str()).collect()
    }

    const LOUD: fn(f64, f64) -> f64 = |_, _| 0.1;

    #[test]
    fn whisper_cpp_markers_are_not_subtitles() {
        // What whisper.cpp wrote over silence, room tone and Tears of
        // Steel's intro before these rules ran on the desktop.
        let c = clean_up(
            &[
                seg(0.0, 7.0, "[BLANK_AUDIO]"),
                seg(10.0, 17.0, "[Music]"),
                seg(31.0, 34.0, "[Birds chirping]"),
                seg(40.0, 42.0, "(upbeat music)"),
                seg(50.0, 52.0, "♪ ♪"),
            ],
            LOUD,
            "en",
        );
        assert!(c.kept.is_empty(), "{:?}", texts(&c));
    }

    #[test]
    fn inline_markers_come_out_and_the_words_stay() {
        assert_eq!(strip_annotations("[Music] [Music] We have main engine start."), "We have main engine start.");
        assert_eq!(strip_annotations("[Music] This is"), "This is");
        assert_eq!(strip_annotations("3, 2, 1, [Music]"), "3, 2, 1,");
        // Somebody's words in brackets are kept.
        assert_eq!(strip_annotations("He said (quietly) no."), "He said (quietly) no.");
    }

    #[test]
    fn real_speech_is_kept() {
        let c = clean_up(
            &[seg(23.0, 24.5, "You're a jerk, Thom."), seg(25.0, 27.0, "Look Celia, we have to follow our passions;")],
            LOUD,
            "en",
        );
        assert_eq!(c.kept.len(), 2);
    }

    #[test]
    fn a_wrong_script_is_dropped() {
        let c = clean_up(&[seg(0.0, 3.0, "现在许多人有大恐惧"), seg(60.0, 63.0, "시청해주셔서 감사합니다")], LOUD, "zh");
        assert_eq!(texts(&c), ["现在许多人有大恐惧"]);
    }

    #[test]
    fn a_loop_is_dropped_and_its_first_repeat_cut_off_the_line_before() {
        let c = clean_up(
            &[
                seg(0.0, 4.0, "if not many, pairs of jeans. music you"),
                seg(4.0, 5.0, "you"),
                seg(5.0, 6.0, "you"),
                seg(6.0, 7.0, "you"),
            ],
            LOUD,
            "en",
        );
        assert_eq!(texts(&c), ["if not many, pairs of jeans."]);
    }

    #[test]
    fn a_sign_off_over_quiet_audio_goes_and_over_speech_stays() {
        let level = |from: f64, _to: f64| if from >= 100.0 { 0.001 } else { 0.1 };
        let c = clean_up(
            &[seg(0.0, 3.0, "Today we look at rivers."), seg(4.0, 6.0, "Thank you."), seg(100.0, 102.0, "Thanks for watching!")],
            level,
            "en",
        );
        assert_eq!(texts(&c), ["Today we look at rivers.", "Thank you."]);
    }

    #[test]
    fn stutters_and_echoes() {
        assert_eq!(stutter_of("you you you").unwrap().repeats, 3);
        assert!(stutter_of("no, no, I said no").is_none());
        assert!(stutter_of("哈哈哈").is_none());
        assert_eq!(stutter_of("哈哈哈哈哈哈").unwrap().repeats, 6);
        assert_eq!(
            trim_inline_echo("どうでしたかすみませんはいろいろなときによく使いますどうでしたか?"),
            "どうでしたかすみませんはいろいろなときによく使います"
        );
    }

    #[test]
    fn talking_about_music_is_not_an_annotation() {
        assert!(!is_non_speech("we listened to the music playing"));
        assert!(!is_non_speech("Music."));
        assert!(is_non_speech("OUTRO MUSIC PLAYING [♪ OUTRESO"));
    }
}
