//! Reading SRT and WebVTT back into cues.
//!
//! The engine could always *write* both formats and never read either,
//! which was fine while the only entry point was audio. The browser app
//! changes that: a user who already has a transcript should not have to
//! re-transcribe to restyle, retime or translate it, and "open the .srt you
//! already have" is the one path into the product that needs no model, no
//! ffmpeg and no network.
//!
//! Deliberately lenient about the things real files get wrong and strict
//! about the one thing that matters. Cue numbers, byte-order marks, CRLF,
//! blank-line runs, WebVTT cue identifiers, `STYLE`/`NOTE`/`REGION` blocks
//! and trailing whitespace are all tolerated; a timing line that cannot be
//! read is an error rather than a silently dropped cue, because a subtitle
//! file that loses a line on import is worse than one that refuses to open.

use crate::Cue;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseError {
    /// A `-->` line that could not be read, with its 1-indexed line number.
    BadTiming { line: usize, text: String },
    /// A cue whose end is at or before its start.
    Backwards { line: usize },
    /// Nothing cue-shaped in the input at all.
    Empty,
}

impl fmt::Display for ParseError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadTiming { line, text } => {
                write!(f, "line {line}: could not read the timing {text:?}")
            }
            Self::Backwards { line } => {
                write!(f, "line {line}: the cue ends before it starts")
            }
            Self::Empty => write!(f, "no subtitles found in this file"),
        }
    }
}

impl std::error::Error for ParseError {}

/// Parse SubRip or WebVTT. The format is detected from the content, so a
/// mislabelled file extension does not matter.
pub fn parse_subtitles(text: &str) -> Result<Vec<Cue>, ParseError> {
    let mut cues = Vec::new();
    // Strip a UTF-8 BOM: Windows tools write them and the first cue number
    // would otherwise be unrecognisable.
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);

    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0;

    while i < lines.len() {
        let raw = lines[i];
        let line = raw.trim();

        // A timing line is the only anchor that matters. Everything before
        // one -- cue numbers, WebVTT identifiers, the WEBVTT header, blank
        // lines -- is skipped without interpretation.
        if !line.contains("-->") {
            // A metadata block runs to the next blank line and may itself
            // contain no timing, so skip it wholesale rather than scanning
            // into it.
            if is_block_keyword(line) {
                i += 1;
                while i < lines.len() && !lines[i].trim().is_empty() {
                    i += 1;
                }
            }
            i += 1;
            continue;
        }

        let (start, end) = parse_timing(line).ok_or_else(|| ParseError::BadTiming {
            line: i + 1,
            text: line.to_string(),
        })?;
        if end <= start {
            return Err(ParseError::Backwards { line: i + 1 });
        }
        i += 1;

        // Text runs until a blank line or the next timing line -- the
        // latter because files with no blank separator do exist.
        let mut body = Vec::new();
        while i < lines.len() {
            let t = lines[i].trim_end();
            if t.trim().is_empty() || lines[i].contains("-->") {
                break;
            }
            body.push(t.to_string());
            i += 1;
        }

        // A cue number sitting on the line *before* the next timing was
        // swept into this cue's body; it belongs to the next cue.
        if i < lines.len()
            && lines[i].contains("-->")
            && body.last().is_some_and(|l| l.trim().parse::<u32>().is_ok())
        {
            body.pop();
        }

        // Timing with no text at all is legal in the wild and carries
        // nothing; dropping it loses no information.
        if !body.is_empty() {
            cues.push(Cue {
                start,
                end,
                lines: body,
            });
        }
    }

    if cues.is_empty() {
        return Err(ParseError::Empty);
    }

    // Source order is not guaranteed to be time order, and everything
    // downstream (gap enforcement, the ASS writer) assumes it is.
    cues.sort_by(|a, b| a.start.total_cmp(&b.start));
    Ok(cues)
}

/// WebVTT blocks that are not cues and whose bodies must not be read as
/// cue text.
fn is_block_keyword(line: &str) -> bool {
    let head = line.split_whitespace().next().unwrap_or("");
    matches!(head, "NOTE" | "STYLE" | "REGION")
}

/// `00:00:01,500 --> 00:00:03,250` in either separator, with or without
/// the hours field, plus any WebVTT cue settings after the end time.
fn parse_timing(line: &str) -> Option<(f64, f64)> {
    let (a, b) = line.split_once("-->")?;
    let start = parse_timecode(a.trim())?;
    // WebVTT allows `... --> 00:00:03.250 line:90% align:center`; the
    // settings are positioning we do not model, so only the first token
    // is a timecode.
    let end = parse_timecode(b.split_whitespace().next()?)?;
    Some((start, end))
}

/// `HH:MM:SS,mmm` / `HH:MM:SS.mmm` / `MM:SS.mmm`, comma or period.
fn parse_timecode(t: &str) -> Option<f64> {
    let t = t.trim().replace(',', ".");
    let mut parts = t.split(':').rev();

    let seconds: f64 = parts.next()?.parse().ok()?;
    if !seconds.is_finite() || seconds < 0.0 {
        return None;
    }
    let minutes: f64 = match parts.next() {
        Some(m) => m.parse().ok()?,
        None => 0.0,
    };
    let hours: f64 = match parts.next() {
        Some(h) => h.parse().ok()?,
        None => 0.0,
    };
    // A fourth field means this is not a timecode.
    if parts.next().is_some() {
        return None;
    }
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{to_srt, to_vtt};

    #[test]
    fn reads_the_srt_this_crate_writes() {
        let original = vec![
            Cue {
                start: 0.0,
                end: 1.5,
                lines: vec!["Hello".into()],
            },
            Cue {
                start: 2.0,
                end: 3.25,
                lines: vec!["two".into(), "lines".into()],
            },
        ];
        assert_eq!(parse_subtitles(&to_srt(&original)).unwrap(), original);
    }

    #[test]
    fn reads_the_vtt_this_crate_writes() {
        let original = vec![Cue {
            start: 1.0,
            end: 2.0,
            lines: vec!["Round trip".into()],
        }];
        assert_eq!(parse_subtitles(&to_vtt(&original)).unwrap(), original);
    }

    #[test]
    fn accepts_crlf_a_bom_and_ragged_blank_lines() {
        let text = "\u{feff}1\r\n00:00:00,000 --> 00:00:01,000\r\nFirst\r\n\r\n\r\n\
                    2\r\n00:00:01,500 --> 00:00:02,000\r\nSecond\r\n";
        let cues = parse_subtitles(text).unwrap();
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text(), "First");
        assert_eq!(cues[1].text(), "Second");
    }

    #[test]
    fn accepts_both_timecode_separators_and_an_absent_hours_field() {
        let text = "00:01.000 --> 00:02.500\nShort form\n\n\
                    00:00:03,000 --> 00:00:04,000\nComma\n";
        let cues = parse_subtitles(text).unwrap();
        assert_eq!(cues[0].start, 1.0);
        assert_eq!(cues[0].end, 2.5);
        assert_eq!(cues[1].start, 3.0);
    }

    #[test]
    fn ignores_webvtt_headers_identifiers_and_metadata_blocks() {
        let text = "WEBVTT - Some title\n\n\
                    NOTE\nThis is a comment that mentions 00:00:99 and must not become a cue.\n\n\
                    STYLE\n::cue { color: red }\n\n\
                    intro-cue\n00:00:00.000 --> 00:00:01.000\nReal text\n";
        let cues = parse_subtitles(text).unwrap();
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text(), "Real text");
    }

    #[test]
    fn ignores_webvtt_cue_settings_after_the_end_time() {
        let text = "WEBVTT\n\n00:00:00.000 --> 00:00:01.000 line:90% align:center\nPositioned\n";
        let cues = parse_subtitles(text).unwrap();
        assert_eq!(cues[0].end, 1.0);
        assert_eq!(cues[0].text(), "Positioned");
    }

    #[test]
    fn a_cue_number_is_never_swallowed_into_the_previous_cues_text() {
        // No blank line between cues -- a real and common malformation.
        let text =
            "1\n00:00:00,000 --> 00:00:01,000\nFirst\n2\n00:00:02,000 --> 00:00:03,000\nSecond\n";
        let cues = parse_subtitles(text).unwrap();
        assert_eq!(cues.len(), 2);
        assert_eq!(cues[0].text(), "First");
        assert_eq!(cues[1].text(), "Second");
    }

    #[test]
    fn out_of_order_cues_come_back_in_time_order() {
        let text = "00:00:05,000 --> 00:00:06,000\nLater\n\n\
                    00:00:01,000 --> 00:00:02,000\nEarlier\n";
        let cues = parse_subtitles(text).unwrap();
        assert_eq!(cues[0].text(), "Earlier");
        assert_eq!(cues[1].text(), "Later");
    }

    #[test]
    fn multi_line_cue_text_keeps_its_line_breaks() {
        let text = "00:00:00,000 --> 00:00:02,000\nline one\nline two\n";
        assert_eq!(
            parse_subtitles(text).unwrap()[0].lines,
            vec!["line one".to_string(), "line two".to_string()]
        );
    }

    #[test]
    fn an_unreadable_timing_is_an_error_rather_than_a_dropped_cue() {
        // Silently skipping this would lose the user's text without saying
        // so, which is the one failure mode worth being strict about.
        let text = "00:00:00,000 --> banana\nText\n";
        assert!(matches!(
            parse_subtitles(text),
            Err(ParseError::BadTiming { line: 1, .. })
        ));
    }

    #[test]
    fn a_backwards_cue_is_rejected() {
        let text = "00:00:05,000 --> 00:00:02,000\nText\n";
        assert_eq!(
            parse_subtitles(text),
            Err(ParseError::Backwards { line: 1 })
        );
    }

    #[test]
    fn a_file_with_no_cues_says_so() {
        assert_eq!(parse_subtitles("WEBVTT\n\n"), Err(ParseError::Empty));
        assert_eq!(parse_subtitles(""), Err(ParseError::Empty));
        assert_eq!(parse_subtitles("just some prose"), Err(ParseError::Empty));
    }

    #[test]
    fn a_timing_with_no_text_is_dropped_rather_than_becoming_a_blank_cue() {
        let text = "00:00:00,000 --> 00:00:01,000\n\n00:00:02,000 --> 00:00:03,000\nReal\n";
        let cues = parse_subtitles(text).unwrap();
        assert_eq!(cues.len(), 1);
        assert_eq!(cues[0].text(), "Real");
    }

    #[test]
    fn hours_minutes_and_seconds_all_contribute() {
        assert_eq!(parse_timecode("01:02:03.500"), Some(3723.5));
        assert_eq!(parse_timecode("00:00:00,000"), Some(0.0));
        assert_eq!(parse_timecode("1:2:3:4"), None);
        assert_eq!(parse_timecode("nonsense"), None);
    }
}
