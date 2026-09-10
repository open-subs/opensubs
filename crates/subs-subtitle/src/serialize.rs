use crate::{fmt_srt, fmt_vtt, Cue};
use std::fmt::Write as _;

/// SubRip. Cue numbers are 1-indexed and timecodes use a comma separator.
pub fn to_srt(cues: &[Cue]) -> String {
    let mut out = String::new();
    for (i, c) in cues.iter().enumerate() {
        let _ = write!(
            out,
            "{}\n{} --> {}\n{}\n\n",
            i + 1,
            fmt_srt(c.start),
            fmt_srt(c.end),
            c.lines.join("\n")
        );
    }
    out
}

/// WebVTT. Requires the `WEBVTT` header; timecodes use a period separator.
pub fn to_vtt(cues: &[Cue]) -> String {
    let mut out = String::from("WEBVTT\n\n");
    for c in cues {
        let _ = write!(
            out,
            "{} --> {}\n{}\n\n",
            fmt_vtt(c.start),
            fmt_vtt(c.end),
            c.lines.join("\n")
        );
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cues() -> Vec<Cue> {
        vec![
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
        ]
    }

    #[test]
    fn srt_is_one_indexed_with_comma_timecodes() {
        assert_eq!(
            to_srt(&cues()),
            "1\n00:00:00,000 --> 00:00:01,500\nHello\n\n\
             2\n00:00:02,000 --> 00:00:03,250\ntwo\nlines\n\n"
        );
    }

    #[test]
    fn vtt_has_the_required_header_and_period_timecodes() {
        let out = to_vtt(&cues());
        assert!(out.starts_with("WEBVTT\n\n"));
        assert!(out.contains("00:00:00.000 --> 00:00:01.500"));
        assert!(out.contains("two\nlines"));
    }

    #[test]
    fn empty_input_still_produces_a_valid_vtt_header() {
        assert_eq!(to_srt(&[]), "");
        assert_eq!(to_vtt(&[]), "WEBVTT\n\n");
    }
}
