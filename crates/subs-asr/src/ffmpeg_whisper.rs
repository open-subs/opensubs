//! Real speech recognition via ffmpeg's `af_whisper` audio filter, which
//! wraps whisper.cpp. This is the first `Transcriber` that touches real
//! audio -- `MockTranscriber` only ever replays a fixture.
//!
//! # The on-disk format, verified empirically against ffmpeg 8.1.2 built
//! with `--enable-whisper` (`format=json:destination=<path>`)
//!
//! The `destination` file is **JSON Lines, not a JSON array**: one bare
//! object per line, e.g.
//!
//! ```text
//! {"start":0,"end":1400,"text":"First sentence here."}
//! {"start":1400,"end":3000,"text":"Second sentence follows after."}
//! {"start":2944,"end":5284,"text":"after a pause, and a third one to finish."}
//! ```
//!
//! Three properties matter and are each handled explicitly below:
//!
//! 1. `start`/`end` are **milliseconds**; `Transcript` uses seconds.
//! 2. There are **no word-level timestamps**, only segments, yet
//!    `Transcript.words` drives the entire downstream segmenter. Word
//!    timings are synthesised by splitting each segment's text on
//!    whitespace and distributing the segment's span proportionally to
//!    character count (a long word gets more time than a short one).
//!    `Word::confidence` is set to a constant `1.0` -- `af_whisper` reports
//!    no per-word or per-segment confidence at all, so this is a filler
//!    value, not a real score. Callers must not treat it as one.
//! 3. **Segments can overlap** (see segments 2 and 3 above: 3000 > 2944).
//!    Each segment's start is clamped to at least the previous segment's
//!    end so synthesised word timings never run backwards. The repeated
//!    word "after" in the example is deliberately **not** deduplicated:
//!    whisper.cpp genuinely emitted it twice, and heuristic dedup on
//!    natural-language text risks deleting a real repeated word the
//!    speaker actually said. If overlap-driven repetition ever needs
//!    cleanup, it belongs in a downstream, reviewable pass -- not silently
//!    inside parsing.

use crate::{AsrError, AsrOptions, AudioRef, Segment, Transcriber, Transcript, Word};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};

/// A constant stand-in for a real confidence score. `af_whisper`'s JSON
/// output carries no per-word or per-segment probability, so every
/// synthesised `Word` gets this value verbatim. It is not a measurement.
const NO_REAL_CONFIDENCE: f32 = 1.0;

/// Drives ffmpeg's `af_whisper` filter to transcribe a 16 kHz mono audio
/// file with whisper.cpp.
pub struct FfmpegWhisperTranscriber {
    ffmpeg_bin: PathBuf,
    model_path: PathBuf,
    /// Used when `AsrOptions::language` is `None`. `"auto"` lets
    /// whisper.cpp auto-detect the spoken language.
    default_language: String,
}

impl FfmpegWhisperTranscriber {
    pub fn new(ffmpeg_bin: impl Into<PathBuf>, model_path: impl Into<PathBuf>) -> Self {
        Self {
            ffmpeg_bin: ffmpeg_bin.into(),
            model_path: model_path.into(),
            default_language: "auto".to_string(),
        }
    }

    /// Override the default language used when `AsrOptions::language` is
    /// `None`. Defaults to `"auto"`.
    pub fn with_language(mut self, language: impl Into<String>) -> Self {
        self.default_language = language.into();
        self
    }

    fn destination_path() -> PathBuf {
        // Unique per call within this process: PID plus a monotonic
        // counter, so concurrent transcribe() calls (e.g. parallel tests)
        // never collide on the same temp file.
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!("subs-whisper-{}-{n}.jsonl", std::process::id()))
    }
}

impl Transcriber for FfmpegWhisperTranscriber {
    fn transcribe(&self, audio: &AudioRef, opts: &AsrOptions) -> Result<Transcript, AsrError> {
        let language = opts.language.as_deref().unwrap_or(&self.default_language);
        let destination = Self::destination_path();

        // Both paths are escaped for ffmpeg's filter syntax: see
        // `filter_path`. Every absolute path on Windows needs it.
        let filter = format!(
            "whisper=model={}:language={language}:format=json:destination={}:queue=3",
            filter_path(&self.model_path),
            filter_path(&destination),
        );

        let output = Command::new(&self.ffmpeg_bin)
            .args(["-v", "error", "-i"])
            .arg(&audio.path)
            .args(["-af", &filter, "-f", "null", "-"])
            .output()?;

        if !output.status.success() {
            let _ = std::fs::remove_file(&destination);
            return Err(AsrError::Backend(format!(
                "ffmpeg whisper filter failed (status {}): {}",
                output.status,
                String::from_utf8_lossy(&output.stderr)
            )));
        }

        let raw = std::fs::read_to_string(&destination);
        let _ = std::fs::remove_file(&destination);
        let transcript = parse_whisper_jsonl(&raw?, language)?;
        Ok(transcript)
    }
}

/// A path as the value of a filter option, escaped for both of ffmpeg's
/// parsers: the graph (`\ ' [ ] , ;`) and then the filter's own
/// `key=value:...` list (`\ ' : =`), so the option list is escaped first.
///
/// Every absolute path on Windows needs this (APP-119). The model lives in
/// `C:\Users\<name>\.cache\opensubs-models` and the output in the temp
/// directory, and unescaped the drive colon ended the option while the
/// backslashes were eaten as escapes: "No option name near
/// 'Usersycan4.cacheopensubs-models...'" on every Windows machine. The same
/// function lives in subs-media for the burn's `ass=` paths; the two crates
/// share no dependency to put it in.
fn filter_path(path: &Path) -> String {
    fn escape(text: &str, special: &str) -> String {
        let mut out = String::with_capacity(text.len());
        for c in text.chars() {
            if special.contains(c) {
                out.push('\\');
            }
            out.push(c);
        }
        out
    }
    escape(&escape(&path.to_string_lossy(), "\\':="), "\\'[],;")
}

/// One raw line of `af_whisper`'s `format=json` output. Field names match
/// the emitted JSON exactly.
#[derive(serde::Deserialize)]
struct WhisperLine {
    start: f64,
    end: f64,
    text: String,
}

/// Build a canonical [`Transcript`] from segment-level output, synthesising
/// word timings.
///
/// Shared by every backend that reports sentences rather than words, which
/// so far is all of them: ffmpeg's `af_whisper` emits no word timestamps,
/// and the ONNX Whisper exports the browser runs cannot either unless they
/// were built with `output_attentions=True`, which the small quantised ones
/// are not. Both therefore land here, so the desktop and the web app derive
/// identical word timings from identical segments -- and when a backend
/// that *does* report real word timings arrives, only it changes.
///
/// `segments` carry seconds; the synthesis works in milliseconds because
/// that is what `af_whisper` reports and rounding twice would be worse.
pub fn transcript_from_segments(segments: Vec<Segment>, language: &str) -> Transcript {
    let mut words = Vec::new();
    let mut duration: f64 = 0.0;
    let mut previous_end = f64::NEG_INFINITY;

    for segment in &segments {
        // Segments can overlap (whisper.cpp genuinely emits that); clamp so
        // synthesised words never run backwards.
        let start = segment.start.max(previous_end);
        let end = segment.end.max(start);
        previous_end = end;
        duration = duration.max(end);
        words.extend(synthesize_words(
            &segment.text,
            start * 1000.0,
            end * 1000.0,
        ));
    }

    Transcript {
        language: language.to_string(),
        duration,
        words,
        segments,
    }
}

/// Parse `af_whisper`'s JSONL `destination` output into a canonical
/// [`Transcript`], synthesising word timings (see module docs for the
/// full rationale). Pure and ffmpeg-free, so it is unit-testable on
/// literal strings.
///
/// `language` becomes `Transcript::language` verbatim -- whisper.cpp's
/// JSON output never reports which language it actually detected, so this
/// is simply the language that was requested (which may be `"auto"`).
pub fn parse_whisper_jsonl(jsonl: &str, language: &str) -> Result<Transcript, AsrError> {
    let mut segments = Vec::new();
    let mut words = Vec::new();
    // Monotonic floor: the furthest point any segment has reached so far,
    // in milliseconds. Used both to clamp a new segment's start and to
    // guarantee that floor itself never regresses across a fully-nested
    // overlap (a segment whose raw end is earlier than a previous one's).
    let mut floor_ms: f64 = 0.0;

    for line in jsonl.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let parsed: WhisperLine = serde_json::from_str(line)?;

        let clamped_start_ms = parsed.start.max(floor_ms);
        // Guard against a degenerate/adversarial line where clamping pushes
        // the start past the segment's own raw end -- produces a
        // zero-length segment instead of a negative-duration one.
        let end_ms = parsed.end.max(clamped_start_ms);
        floor_ms = floor_ms.max(end_ms);

        let seg_start_s = clamped_start_ms / 1000.0;
        let seg_end_s = end_ms / 1000.0;

        segments.push(Segment {
            start: seg_start_s,
            end: seg_end_s,
            text: parsed.text.trim().to_string(),
        });

        words.extend(synthesize_words(&parsed.text, clamped_start_ms, end_ms));
    }

    let duration = segments.last().map(|s| s.end).unwrap_or(0.0);

    Ok(Transcript {
        language: language.to_string(),
        duration,
        words,
        segments,
    })
}

/// Split `text` on whitespace and distribute `[start_ms, end_ms]`
/// proportionally to each word's character count, so a longer word claims
/// more of the span than a shorter one. The final word's end is pinned to
/// exactly `end_ms` to absorb floating-point drift from the running
/// cursor.
pub fn synthesize_words(text: &str, start_ms: f64, end_ms: f64) -> Vec<Word> {
    let raw_words: Vec<&str> = text.split_whitespace().collect();
    if raw_words.is_empty() {
        return Vec::new();
    }

    let total_chars: usize = raw_words.iter().map(|w| w.chars().count()).sum();
    if total_chars == 0 {
        return Vec::new();
    }

    let span_ms = end_ms - start_ms;
    let mut cursor_ms = start_ms;
    let mut out = Vec::with_capacity(raw_words.len());
    for (i, w) in raw_words.iter().enumerate() {
        let is_last = i + 1 == raw_words.len();
        let share = w.chars().count() as f64 / total_chars as f64;
        let w_start_ms = cursor_ms;
        let w_end_ms = if is_last {
            end_ms
        } else {
            cursor_ms + share * span_ms
        };
        cursor_ms = w_end_ms;
        out.push(Word {
            start: w_start_ms / 1000.0,
            end: w_end_ms / 1000.0,
            text: (*w).to_string(),
            confidence: NO_REAL_CONFIDENCE,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// APP-119: the model and output paths from the report, as ffmpeg must
    /// be handed them. Unescaped, this was "No option name near
    /// 'Usersycan4.cacheopensubs-models...'" on every Windows machine.
    #[test]
    fn windows_paths_are_escaped_for_the_filter() {
        assert_eq!(
            filter_path(Path::new(
                r"C:\Users\ycan4\.cache\opensubs-models\ggml-base.en.bin"
            )),
            r"C\\:\\\\Users\\\\ycan4\\\\.cache\\\\opensubs-models\\\\ggml-base.en.bin"
        );
        assert_eq!(
            filter_path(Path::new("/tmp/plain/model.bin")),
            "/tmp/plain/model.bin"
        );
    }

    #[test]
    fn empty_input_yields_an_empty_transcript() {
        let t = parse_whisper_jsonl("", "en").unwrap();
        assert_eq!(t.words.len(), 0);
        assert_eq!(t.segments.len(), 0);
        assert_eq!(t.duration, 0.0);
        assert_eq!(t.language, "en");
    }

    #[test]
    fn blank_lines_are_tolerated() {
        let jsonl = "\n  \n{\"start\":0,\"end\":1000,\"text\":\"hi\"}\n\n";
        let t = parse_whisper_jsonl(jsonl, "en").unwrap();
        assert_eq!(t.segments.len(), 1);
        assert_eq!(t.words.len(), 1);
    }

    #[test]
    fn malformed_line_yields_an_error_not_a_panic() {
        let err = parse_whisper_jsonl("not json at all", "en").unwrap_err();
        assert!(matches!(err, AsrError::Json(_)));
    }

    #[test]
    fn one_malformed_line_among_valid_ones_still_errors() {
        let jsonl = "{\"start\":0,\"end\":500,\"text\":\"ok\"}\n{broken\n";
        assert!(parse_whisper_jsonl(jsonl, "en").is_err());
    }

    #[test]
    fn milliseconds_convert_to_seconds() {
        let jsonl = r#"{"start":1400,"end":3000,"text":"hi there"}"#;
        let t = parse_whisper_jsonl(jsonl, "en").unwrap();
        assert_eq!(t.segments.len(), 1);
        assert!((t.segments[0].start - 1.4).abs() < 1e-9);
        assert!((t.segments[0].end - 3.0).abs() < 1e-9);
        assert!((t.duration - 3.0).abs() < 1e-9);
    }

    #[test]
    fn word_synthesis_distributes_proportionally_to_character_count() {
        // "a" (1 char) and "bbbb" (4 chars) over a 1000ms/5-char span:
        // "a" should get 1/5 = 200ms, "bbbb" should get 4/5 = 800ms.
        let jsonl = r#"{"start":0,"end":1000,"text":"a bbbb"}"#;
        let t = parse_whisper_jsonl(jsonl, "en").unwrap();
        assert_eq!(t.words.len(), 2);
        assert_eq!(t.words[0].text, "a");
        assert!((t.words[0].start - 0.0).abs() < 1e-9);
        assert!((t.words[0].end - 0.2).abs() < 1e-9, "{:?}", t.words[0]);
        assert_eq!(t.words[1].text, "bbbb");
        assert!((t.words[1].start - 0.2).abs() < 1e-9, "{:?}", t.words[1]);
        assert!((t.words[1].end - 1.0).abs() < 1e-9, "{:?}", t.words[1]);
        // Constant filler confidence, documented as not a real score.
        assert_eq!(t.words[0].confidence, NO_REAL_CONFIDENCE);
    }

    #[test]
    fn word_timings_cover_the_full_segment_span_with_no_gap_or_overrun() {
        let jsonl = r#"{"start":2000,"end":5000,"text":"one two three four"}"#;
        let t = parse_whisper_jsonl(jsonl, "en").unwrap();
        assert!((t.words.first().unwrap().start - 2.0).abs() < 1e-9);
        assert!((t.words.last().unwrap().end - 5.0).abs() < 1e-9);
        // Contiguous: each word's start equals the previous word's end.
        for pair in t.words.windows(2) {
            assert!((pair[0].end - pair[1].start).abs() < 1e-9);
        }
    }

    #[test]
    fn overlapping_segments_are_clamped_so_words_never_run_backwards() {
        // Matches the module doc example: segment 2 ends at 3000ms,
        // segment 3 claims to start at 2944ms.
        let jsonl = "\
            {\"start\":0,\"end\":1400,\"text\":\"first sentence here\"}\n\
            {\"start\":1400,\"end\":3000,\"text\":\"second sentence follows after\"}\n\
            {\"start\":2944,\"end\":5284,\"text\":\"after a pause and a third one\"}\n";
        let t = parse_whisper_jsonl(jsonl, "en").unwrap();
        assert_eq!(t.segments.len(), 3);
        // Segment 3's start is clamped up to segment 2's end.
        assert!(
            (t.segments[2].start - 3.0).abs() < 1e-9,
            "{:?}",
            t.segments[2]
        );
        // The clamp did not touch its (later) end.
        assert!((t.segments[2].end - 5.284).abs() < 1e-9);
        // The duplicated "after" text is preserved verbatim, not
        // deduplicated -- see module docs.
        assert!(t.segments[1].text.contains("after"));
        assert!(t.segments[2].text.starts_with("after"));

        // No word anywhere starts before the previous word's end.
        for pair in t.words.windows(2) {
            assert!(
                pair[1].start + 1e-9 >= pair[0].end,
                "word timings ran backwards: {:?} -> {:?}",
                pair[0],
                pair[1]
            );
        }
    }

    #[test]
    fn severely_overlapping_segment_does_not_produce_negative_duration() {
        // Raw start (9000) is clamped up to the floor (5000), which here
        // lands past the raw end (5100) too -- must not go negative.
        let jsonl = "\
            {\"start\":0,\"end\":5000,\"text\":\"a\"}\n\
            {\"start\":9000,\"end\":5100,\"text\":\"b\"}\n";
        let t = parse_whisper_jsonl(jsonl, "en").unwrap();
        assert!(t.segments[1].end >= t.segments[1].start);
    }

    #[test]
    fn segment_with_only_whitespace_text_yields_no_words_but_is_kept() {
        let jsonl = r#"{"start":0,"end":500,"text":"   "}"#;
        let t = parse_whisper_jsonl(jsonl, "en").unwrap();
        assert_eq!(t.segments.len(), 1);
        assert_eq!(t.words.len(), 0);
    }

    #[test]
    fn language_is_recorded_verbatim() {
        let t = parse_whisper_jsonl("", "fr").unwrap();
        assert_eq!(t.language, "fr");
    }

    #[test]
    fn segments_become_a_transcript_with_synthesised_words() {
        let t = transcript_from_segments(
            vec![
                Segment {
                    start: 0.0,
                    end: 2.0,
                    text: "hello world".into(),
                },
                Segment {
                    start: 2.5,
                    end: 4.0,
                    text: "again".into(),
                },
            ],
            "en",
        );
        assert_eq!(t.words.len(), 3);
        assert_eq!(t.words[0].text, "hello");
        assert_eq!(t.words[2].text, "again");
        assert_eq!(t.duration, 4.0);
        assert_eq!(t.segments.len(), 2);
        // Longer words get proportionally more of the span.
        assert!(t.words[1].end > t.words[0].end);
        assert_eq!(t.words[1].end, 2.0, "the last word pins to the segment end");
    }

    #[test]
    fn overlapping_segments_never_produce_backwards_words() {
        // whisper.cpp genuinely emits overlapping segments.
        let t = transcript_from_segments(
            vec![
                Segment {
                    start: 0.0,
                    end: 3.0,
                    text: "first".into(),
                },
                Segment {
                    start: 2.944,
                    end: 5.284,
                    text: "second".into(),
                },
            ],
            "en",
        );
        for pair in t.words.windows(2) {
            assert!(
                pair[1].start >= pair[0].start,
                "words ran backwards: {:?}",
                pair
            );
        }
    }

    #[test]
    fn the_browser_and_the_desktop_derive_the_same_words_from_the_same_segments() {
        // The JSONL path and the segment path must not diverge, or the web
        // app and the desktop would break lines differently for identical
        // speech.
        let jsonl = "{\"start\":0,\"end\":2000,\"text\":\"hello world\"}";
        let from_jsonl = parse_whisper_jsonl(jsonl, "en").unwrap();
        let from_segments = transcript_from_segments(
            vec![Segment {
                start: 0.0,
                end: 2.0,
                text: "hello world".into(),
            }],
            "en",
        );
        assert_eq!(from_jsonl.words, from_segments.words);
    }

    #[test]
    fn no_segments_is_an_empty_transcript_rather_than_an_error() {
        let t = transcript_from_segments(Vec::new(), "en");
        assert!(t.words.is_empty());
        assert_eq!(t.duration, 0.0);
    }
}
