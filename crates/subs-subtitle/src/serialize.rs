use crate::{fmt_srt, fmt_vtt, join_tokens, Cue};
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

/// A pause at least this long between two cues starts a new paragraph in
/// the plain-text transcript, in seconds.
pub const TXT_PARAGRAPH_GAP: f64 = 2.0;

/// A cue's words as one line of plain text: the line breaks undone (they
/// are a display decision, not part of what was said), markup removed,
/// and the lines joined with a space -- or with none between two CJK
/// characters, as [`join_tokens`] does everywhere else.
fn plain(lines: &[String]) -> String {
    let lines: Vec<String> = lines.iter().map(|l| strip_markup(l)).collect();
    let words: Vec<&str> = lines
        .iter()
        .flat_map(|l| l.split_whitespace())
        .collect();
    join_tokens(&words)
}

/// Remove the inline markup a subtitle file can carry -- `<i>`, `</b>`,
/// `<font …>`, WebVTT's `<c.x>` and `<00:00:01.000>`, and ASS overrides
/// such as `{\an8}` -- which belongs to a player, not to a transcript.
/// A `<` not followed by a tag name (`<3`, `a < b`) is text and stays.
fn strip_markup(line: &str) -> String {
    let mut out = String::with_capacity(line.len());
    let mut rest = line;
    while let Some(c) = rest.chars().next() {
        let tag_end = match c {
            '<' => {
                let after = &rest[1..];
                let after = after.strip_prefix('/').unwrap_or(after);
                match after.chars().next() {
                    Some(n) if n.is_ascii_alphanumeric() => rest.find('>'),
                    _ => None,
                }
            }
            '{' if rest[1..].starts_with('\\') => rest.find('}'),
            _ => None,
        };
        match tag_end {
            Some(end) => rest = &rest[end + 1..],
            None => {
                out.push(c);
                rest = &rest[c.len_utf8()..];
            }
        }
    }
    out
}

/// Plain text: the words only, with no cue numbers and no timecodes, to
/// read, quote or paste into a document.
///
/// Cues run on as prose, because a speaker's sentence routinely spans two
/// or three of them. A pause of [`TXT_PARAGRAPH_GAP`] or more between two
/// cues starts a new paragraph, which is where a pause in speech usually
/// is. Cues with no words are skipped.
pub fn to_txt(cues: &[Cue]) -> String {
    let mut paragraphs: Vec<Vec<String>> = Vec::new();
    let mut last_end: Option<f64> = None;
    for c in cues {
        let text = plain(&c.lines);
        if text.is_empty() {
            continue;
        }
        let pause = last_end.is_some_and(|end| c.start - end >= TXT_PARAGRAPH_GAP);
        match paragraphs.last_mut() {
            Some(p) if !pause => p.push(text),
            _ => paragraphs.push(vec![text]),
        }
        last_end = Some(c.end);
    }
    paragraphs
        .iter()
        .map(|p| {
            let parts: Vec<&str> = p.iter().map(String::as_str).collect();
            join_tokens(&parts) + "\n"
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Plain text with one paragraph per cue and each line kept on its own:
/// for bilingual subtitles, where a cue's lines are two languages and
/// running them on as prose would interleave the two.
pub fn to_txt_by_cue(cues: &[Cue]) -> String {
    cues.iter()
        .filter_map(|c| {
            let lines: Vec<String> = c
                .lines
                .iter()
                .map(|l| plain(std::slice::from_ref(l)))
                .filter(|l| !l.is_empty())
                .collect();
            (!lines.is_empty()).then(|| lines.join("\n") + "\n")
        })
        .collect::<Vec<_>>()
        .join("\n")
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

    fn cue(start: f64, end: f64, lines: &[&str]) -> Cue {
        Cue {
            start,
            end,
            lines: lines.iter().map(|l| l.to_string()).collect(),
        }
    }

    #[test]
    fn txt_has_no_numbers_or_timecodes_and_runs_cues_on_as_prose() {
        let out = to_txt(&cues());
        assert_eq!(out, "Hello two lines\n");
        assert!(!out.contains("-->"));
        assert!(!out.contains("00:00"));
    }

    #[test]
    fn txt_starts_a_paragraph_at_a_pause() {
        let out = to_txt(&[
            cue(0.0, 1.0, &["We start"]),
            cue(1.2, 2.0, &["here."]),
            cue(4.0, 5.0, &["After a pause,"]),
            cue(5.1, 6.0, &["a new paragraph."]),
        ]);
        assert_eq!(out, "We start here.\n\nAfter a pause, a new paragraph.\n");
    }

    #[test]
    fn txt_puts_no_space_between_cjk_cues_or_lines() {
        let out = to_txt(&[cue(0.0, 1.0, &["你好，", "世界。"]), cue(1.1, 2.0, &["第二句。"])]);
        assert_eq!(out, "你好，世界。第二句。\n");
    }

    #[test]
    fn txt_drops_markup_but_keeps_angle_brackets_that_are_text() {
        let out = to_txt(&[
            cue(0.0, 1.0, &["{\\an8}<i>Quiet</i> <font color=\"red\">now</font>"]),
            cue(1.0, 2.0, &["I <3 this, and 2 < 3"]),
        ]);
        assert_eq!(out, "Quiet now I <3 this, and 2 < 3\n");
    }

    #[test]
    fn txt_skips_empty_cues_and_is_empty_for_none() {
        assert_eq!(to_txt(&[]), "");
        assert_eq!(to_txt(&[cue(0.0, 1.0, &["  "]), cue(1.0, 2.0, &["Word"])]), "Word\n");
        assert_eq!(to_txt_by_cue(&[]), "");
    }

    #[test]
    fn txt_by_cue_keeps_each_line_and_separates_cues() {
        let out = to_txt_by_cue(&[
            cue(0.0, 1.0, &["Hello there.", "你好。"]),
            cue(1.0, 2.0, &["<b>Goodbye.</b>", "再见。"]),
        ]);
        assert_eq!(out, "Hello there.\n你好。\n\nGoodbye.\n再见。\n");
    }
}
