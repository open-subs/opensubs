use crate::width::{join_tokens, joined_len};

/// Subtitles never exceed two lines: a third line covers too much picture.
pub const MAX_LINES: usize = 2;

/// Rendered width of a run of tokens, counting only the separators that are
/// actually emitted -- CJK/CJK boundaries take none.
fn width(words: &[&str]) -> usize {
    joined_len(words)
}

/// Wrap words into at most `max_lines` lines of at most `budget` characters.
///
/// Chooses the split minimising the longest line, so breaks come out balanced
/// rather than greedy: "aaa bbb / ccc ddd" instead of "aaa bbb ccc / ddd".
/// Returns all words even when they cannot fit -- the caller (the segmenter)
/// is responsible for splitting a cue that overflows, and dropping words here
/// would violate the no-text-loss invariant.
pub fn wrap_lines(words: &[&str], budget: usize, max_lines: usize) -> Vec<String> {
    if words.is_empty() {
        return Vec::new();
    }
    if width(words) <= budget || max_lines <= 1 {
        return vec![join_tokens(words)];
    }

    // Single word cannot be split across lines regardless of budget.
    if words.len() == 1 {
        return vec![words[0].to_string()];
    }

    // Two-line case: pick the split point minimising the longer half.
    let mut best = 1usize;
    let mut best_cost = usize::MAX;
    for split in 1..words.len() {
        let (a, b) = words.split_at(split);
        let cost = width(a).max(width(b));
        if cost < best_cost {
            best_cost = cost;
            best = split;
        }
    }

    let (a, b) = words.split_at(best);
    let left = join_tokens(a);
    let right = join_tokens(b);

    // Never emit empty lines.
    if left.is_empty() || right.is_empty() {
        return vec![join_tokens(words)];
    }

    vec![left, right]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn short_text_stays_on_one_line() {
        let out = wrap_lines(&["Hello", "world"], 42, 2);
        assert_eq!(out, vec!["Hello world"]);
    }

    #[test]
    fn overlong_text_wraps_to_two_lines() {
        let words: Vec<&str> = "the quick brown fox jumps over the lazy dog again and again"
            .split(' ')
            .collect();
        let out = wrap_lines(&words, 30, 2);
        assert_eq!(out.len(), 2);
        for line in &out {
            assert!(line.chars().count() <= 30, "line too long: {line}");
        }
    }

    #[test]
    fn never_exceeds_max_lines_even_when_text_does_not_fit() {
        let words = vec!["word"; 60];
        let out = wrap_lines(&words, 20, 2);
        assert!(out.len() <= 2);
    }

    #[test]
    fn breaks_are_balanced_rather_than_greedy() {
        // Greedy packing would give "aaa bbb ccc" / "ddd"; balanced is nicer.
        let out = wrap_lines(&["aaa", "bbb", "ccc", "ddd"], 12, 2);
        assert_eq!(out, vec!["aaa bbb", "ccc ddd"]);
    }

    #[test]
    fn loses_no_words() {
        let words = ["alpha", "beta", "gamma", "delta", "epsilon"];
        let out = wrap_lines(&words, 15, 2);
        let joined: Vec<String> = out.join(" ").split(' ').map(str::to_string).collect();
        assert_eq!(joined, words);
    }

    #[test]
    fn empty_input_produces_no_lines() {
        assert!(wrap_lines(&[], 42, 2).is_empty());
    }

    #[test]
    fn single_word_overflow_returns_one_line() {
        let out = wrap_lines(&["supercalifragilisticexpialidocious"], 10, 2);
        assert_eq!(out.len(), 1);
        assert_eq!(out[0], "supercalifragilisticexpialidocious");
    }

    #[test]
    fn no_line_is_ever_empty() {
        let words = vec!["word"; 60];
        let out = wrap_lines(&words, 20, 2);
        for (i, line) in out.iter().enumerate() {
            assert!(!line.is_empty(), "line {i} is empty");
        }
    }
}
