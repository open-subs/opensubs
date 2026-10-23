//! Making finished cues fit a narrow frame.
//!
//! The segmenter cuts spoken words to the frame's line length when it is
//! told it (`SegmentConfig::fitting`). Text that arrives after that -- a
//! translation, which is re-wrapped to the broadcast line length of its own
//! script -- has not been, and a cue of two 20-character lines of Chinese is
//! four lines on a vertical Shorts frame that holds eleven. This pass splits
//! such a cue into consecutive cues over its own time, in proportion to
//! length, so every cue is at most two lines where it is drawn.

use crate::width::{is_cjk_char, is_cjk_dominant, join_tokens, joined_len};
use crate::{wrap_lines, Cue, MAX_LINES};

/// Pieces of `text` a line may break between: words, or for Chinese and
/// Japanese single characters, with punctuation kept on the character
/// before it.
fn pieces(text: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for word in text.split_whitespace() {
        if !word.chars().any(is_cjk_char) {
            out.push(word.to_string());
            continue;
        }
        for c in word.chars() {
            let attach = !is_cjk_char(c) && !c.is_alphanumeric();
            match out.last_mut() {
                Some(prev) if attach => prev.push(c),
                _ => out.push(c.to_string()),
            }
        }
    }
    out
}

fn ends_clause(piece: &str) -> bool {
    piece.chars().last().is_some_and(|c| "，。！？、；：,.!?;:…".contains(c))
}

/// Every cue at most `MAX_LINES` lines of at most `latin`/`cjk` characters.
pub fn fit_cues(cues: &[Cue], latin: usize, cjk: usize) -> Vec<Cue> {
    let mut out = Vec::with_capacity(cues.len());
    for cue in cues {
        let text = cue.text();
        let budget = if is_cjk_dominant(&text) { cjk } else { latin }.max(1);
        let parts = pieces(&text);
        let refs: Vec<&str> = parts.iter().map(String::as_str).collect();
        let total = joined_len(&refs);
        let fits_lines = cue.lines.len() <= MAX_LINES && cue.lines.iter().all(|l| l.chars().count() <= budget);
        if fits_lines || refs.is_empty() {
            out.push(cue.clone());
            continue;
        }
        let rewrapped = wrap_lines(&refs, budget, MAX_LINES);
        if rewrapped.len() <= MAX_LINES && rewrapped.iter().all(|l| l.chars().count() <= budget) {
            out.push(Cue { start: cue.start, end: cue.end, lines: rewrapped });
            continue;
        }

        // Greedy groups of what wraps onto two lines, ending at a clause mark
        // where one falls in the last third of a group.
        let capacity = budget * MAX_LINES;
        let wraps = |g: &[&str]| {
            let lines = wrap_lines(g, budget, MAX_LINES);
            lines.len() <= MAX_LINES && lines.iter().all(|l| l.chars().count() <= budget)
        };
        let mut groups: Vec<Vec<&str>> = Vec::new();
        let mut current: Vec<&str> = Vec::new();
        for (i, p) in refs.iter().enumerate() {
            let mut trial = current.clone();
            trial.push(p);
            if !current.is_empty() && !wraps(&trial) {
                // Step back to a clause end if there is one late in the group.
                let cut = current
                    .iter()
                    .rposition(|q| ends_clause(q))
                    .filter(|&k| joined_len(&current[..=k]) * 3 >= capacity * 2)
                    .map(|k| k + 1)
                    .unwrap_or(current.len());
                let rest = current.split_off(cut);
                groups.push(std::mem::take(&mut current));
                current = rest;
            }
            current.push(refs[i]);
        }
        if !current.is_empty() {
            groups.push(current);
        }

        let span = cue.end - cue.start;
        let mut at = cue.start;
        let n = groups.len();
        for (k, g) in groups.iter().enumerate() {
            let share = joined_len(g) as f64 / total.max(1) as f64;
            let end = if k + 1 == n { cue.end } else { (at + span * share).min(cue.end) };
            let mut lines = wrap_lines(g, budget, MAX_LINES);
            if lines.is_empty() {
                lines = vec![join_tokens(g)];
            }
            out.push(Cue { start: at, end, lines });
            at = end;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cue(start: f64, end: f64, lines: &[&str]) -> Cue {
        Cue { start, end, lines: lines.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn a_cue_that_fits_is_untouched() {
        let c = cue(1.0, 3.0, &["Hello there"]);
        assert_eq!(fit_cues(&[c.clone()], 15, 11), [c]);
    }

    #[test]
    fn long_lines_are_rewrapped_when_the_text_fits_two_shorter_ones() {
        let out = fit_cues(&[cue(0.0, 2.0, &["the keeper wrote it down."])], 15, 11);
        assert_eq!(out.len(), 1);
        assert!(out[0].lines.len() <= 2 && out[0].lines.iter().all(|l| l.chars().count() <= 15), "{:?}", out[0]);
    }

    #[test]
    fn a_translation_too_long_for_the_frame_is_split_over_its_own_time() {
        let out = fit_cues(&[cue(10.0, 16.0, &["我叫小王，今年三十岁，在杭州", "一家软件公司做设计师，"])], 15, 11);
        assert!(out.len() >= 2, "{out:?}");
        assert_eq!(out[0].start, 10.0);
        assert_eq!(out.last().unwrap().end, 16.0);
        for pair in out.windows(2) {
            assert!((pair[0].end - pair[1].start).abs() < 1e-9);
        }
        for c in &out {
            assert!(c.lines.len() <= 2, "{c:?}");
            assert!(c.lines.iter().all(|l| l.chars().count() <= 11), "{c:?}");
        }
        let joined: String = out.iter().map(|c| c.lines.concat()).collect();
        assert_eq!(joined, "我叫小王，今年三十岁，在杭州一家软件公司做设计师，");
    }
}
