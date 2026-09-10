//! Splitting translated text back into wrappable tokens.
//!
//! The segmenter never needs this: it wraps the ASR's own word list, which
//! arrives pre-tokenised. A translation arrives as one finished string, so
//! before it can be line-broken it has to be cut back into units a line
//! break may fall between -- and where those units are is script-dependent.
//! Latin text breaks at spaces; Chinese, Japanese and Korean have no spaces
//! and break between characters.

use subs_subtitle::is_cjk_char;

/// Characters that must never begin a line: closing punctuation, and the
/// CJK full-width forms of the same. A break before one of these is the
/// most visible line-breaking error in CJK subtitles, so they are glued to
/// the token on their left instead of standing alone.
const NO_LINE_START: &[char] = &[
    ',', '.', '!', '?', ';', ':', ')', ']', '}', '"', '\'', '，', '。', '、', '！', '？', '；',
    '：', '）', '】', '」', '』', '》', '〉', '”', '’', '…', '·', '～',
];

/// Characters that must never end a line: opening punctuation.
const NO_LINE_END: &[char] = &['(', '[', '{', '（', '【', '「', '『', '《', '〈', '“', '‘'];

/// Cut `text` into tokens that a line break may fall between.
///
/// Latin runs stay whole (a word is never split); CJK characters stand
/// alone, since that is where CJK lines legitimately break. Punctuation is
/// attached to whichever neighbour keeps it off a line edge.
pub fn tokenize(text: &str) -> Vec<String> {
    let mut tokens: Vec<String> = Vec::new();
    let mut latin = String::new();

    // A pending opening bracket waits for the token it belongs in front of.
    let mut pending_open = String::new();

    for c in text.chars() {
        if c.is_whitespace() {
            flush(&mut latin, &mut tokens, &mut pending_open);
            continue;
        }

        if NO_LINE_END.contains(&c) {
            flush(&mut latin, &mut tokens, &mut pending_open);
            pending_open.push(c);
            continue;
        }

        if is_cjk_char(c) {
            flush(&mut latin, &mut tokens, &mut pending_open);
            let mut t = std::mem::take(&mut pending_open);
            t.push(c);
            tokens.push(t);
            continue;
        }

        if NO_LINE_START.contains(&c) {
            // Glue to the left. Inside a Latin run (an apostrophe in
            // "don't", a decimal point in "3.5") it is simply part of the
            // word being built.
            if !latin.is_empty() {
                latin.push(c);
            } else if let Some(last) = tokens.last_mut() {
                last.push(c);
            } else {
                latin.push(c);
            }
            continue;
        }

        latin.push(c);
    }

    flush(&mut latin, &mut tokens, &mut pending_open);

    // An opening bracket with nothing after it still has to survive, or the
    // rewrap would silently drop a character.
    if !pending_open.is_empty() {
        match tokens.last_mut() {
            Some(last) => last.push_str(&pending_open),
            None => tokens.push(pending_open),
        }
    }

    tokens
}

fn flush(latin: &mut String, tokens: &mut Vec<String>, pending_open: &mut String) {
    if latin.is_empty() {
        return;
    }
    let mut t = std::mem::take(pending_open);
    t.push_str(latin);
    latin.clear();
    tokens.push(t);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn toks(s: &str) -> Vec<String> {
        tokenize(s)
    }

    #[test]
    fn latin_splits_on_whitespace_and_keeps_words_whole() {
        assert_eq!(
            toks("the quick brown fox"),
            ["the", "quick", "brown", "fox"]
        );
    }

    #[test]
    fn cjk_splits_per_character() {
        assert_eq!(toks("今天天气"), ["今", "天", "天", "气"]);
    }

    #[test]
    fn mixed_script_keeps_latin_runs_whole_between_cjk_characters() {
        assert_eq!(toks("用 OpenSubs 剪辑"), ["用", "OpenSubs", "剪", "辑"]);
    }

    #[test]
    fn closing_punctuation_never_starts_a_token() {
        // A break before "，" is the classic CJK line-breaking error.
        assert_eq!(toks("你好，世界"), ["你", "好，", "世", "界"]);
        assert_eq!(toks("Hello, world"), ["Hello,", "world"]);
    }

    #[test]
    fn opening_punctuation_never_ends_a_token() {
        assert_eq!(toks("说（真的）"), ["说", "（真", "的）"]);
        assert_eq!(toks("a (b)"), ["a", "(b)"]);
    }

    #[test]
    fn punctuation_inside_a_latin_word_stays_inside_it() {
        assert_eq!(toks("don't stop"), ["don't", "stop"]);
        assert_eq!(toks("3.5 seconds"), ["3.5", "seconds"]);
    }

    #[test]
    fn leading_punctuation_is_not_dropped_when_there_is_nothing_to_attach_to() {
        assert_eq!(toks(",hello"), [",hello"]);
        assert_eq!(toks("("), ["("]);
    }

    #[test]
    fn no_character_is_lost_for_any_of_these_inputs() {
        for s in [
            "the quick brown fox",
            "今天天气很好",
            "用 OpenSubs 剪辑，很快。",
            "don't stop (really)",
            "こんにちは、世界！",
            "안녕하세요 여러분",
            "",
            "   ",
        ] {
            let joined: String = tokenize(s).concat();
            let expected: String = s.chars().filter(|c| !c.is_whitespace()).collect();
            assert_eq!(joined, expected, "characters lost tokenising {s:?}");
        }
    }

    #[test]
    fn empty_and_whitespace_only_text_produce_no_tokens() {
        assert!(toks("").is_empty());
        assert!(toks("   \n\t ").is_empty());
    }
}
