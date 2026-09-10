/// Netflix timed-text guidance for Latin scripts.
pub const MAX_CHARS_LATIN: usize = 42;
/// Full-width characters are far denser; 20 is the readable ceiling.
pub const MAX_CHARS_CJK: usize = 20;

/// Whether a single character belongs to a script written without spaces
/// between words.
///
/// Public so the joining rules below and their callers share exactly one
/// copy of these ranges; duplicating them is how the budget and the joiner
/// drift apart.
pub fn is_cjk_char(c: char) -> bool {
    matches!(
        c as u32,
        0x3040..=0x309F |   // Hiragana
        0x30A0..=0x30FF |   // Katakana
        0x3400..=0x4DBF |   // CJK Ext A
        0x4E00..=0x9FFF |   // CJK Unified
        0xF900..=0xFAFF |   // CJK Compatibility
        0xAC00..=0xD7AF |   // Hangul syllables
        0x1100..=0x11FF |   // Hangul Jamo
        0x20000..=0x2A6DF   // CJK Ext B
    )
}

/// Whether a character sits at a boundary that takes no space.
///
/// Wider than [`is_cjk_char`] on purpose, and used only for spacing.
/// `is_cjk_char` answers "is this a CJK *letter*" -- which is what the
/// line-budget majority and the karaoke beat splitter need, and where
/// counting punctuation would be wrong. Spacing is a different question,
/// and the two were sharing one answer.
///
/// The visible cost of conflating them: a translation coming back as
/// `你好，世界。第二行、完毕。` was re-wrapped into
/// `你好， 世界。 第二行、 完毕。`. The tokens either side of `，` are both
/// Chinese, but `，` is U+FF0C and `。` is U+3002 -- both below the
/// U+3040 floor of `is_cjk_char` -- so the joiner decided the boundary was
/// not CJK and inserted a space. Chinese typography has no space there,
/// and it appeared in every burned frame.
pub fn is_cjk_spacing(c: char) -> bool {
    is_cjk_char(c)
        || matches!(
            c as u32,
            0x3000..=0x303F |    // CJK symbols and punctuation: 、。〈〉「」…
            0xFF00..=0xFF60 |    // Fullwidth forms: ，！？：；（）
            0xFFE0..=0xFFE6 |    // Fullwidth currency and signs
            0x2018..=0x201F |    // Curly quotes, set unspaced in CJK
            0x2E80..=0x2EFF |    // CJK radicals
            0x31C0..=0x31EF      // CJK strokes
        )
}

/// Whether a cue should use the dense-script line budget.
///
/// Decided by a majority of *alphabetic* characters, so digits, spaces and
/// punctuation cannot flip a short line into the wrong budget.
pub fn is_cjk_dominant(text: &str) -> bool {
    let mut cjk = 0usize;
    let mut letters = 0usize;
    for c in text.chars() {
        if is_cjk_char(c) {
            cjk += 1;
            letters += 1;
        } else if c.is_alphabetic() {
            letters += 1;
        }
    }
    letters > 0 && cjk * 2 > letters
}

pub fn line_budget(text: &str) -> usize {
    if is_cjk_dominant(text) {
        MAX_CHARS_CJK
    } else {
        MAX_CHARS_LATIN
    }
}

/// Whether a space belongs between two adjacent tokens.
///
/// Chinese and Japanese are written with no space between words, so joining
/// ASR tokens unconditionally with `" "` renders `字幕 工具 视频 时间` where
/// the text must read `字幕工具视频时间`. That is wrong on *every* subtitle
/// in the product's primary market, and a line-length check cannot see it.
///
/// The rule is per-boundary, not per-cue, so mixed script does the sensible
/// thing: a space is still correct between a CJK token and a Latin one
/// (`工具 CapCut 视频`), and only a CJK/CJK boundary is closed up.
pub fn needs_space_between(left: &str, right: &str) -> bool {
    match (left.chars().next_back(), right.chars().next()) {
        (Some(a), Some(b)) => !(is_cjk_spacing(a) && is_cjk_spacing(b)),
        // An empty token has no boundary to speak of; never invent a space
        // next to one, or it shows up as a double space.
        _ => false,
    }
}

/// Join tokens into displayable text using [`needs_space_between`].
pub fn join_tokens(tokens: &[&str]) -> String {
    let mut out = String::new();
    for (i, t) in tokens.iter().enumerate() {
        if i > 0 && needs_space_between(&out, t) {
            out.push(' ');
        }
        out.push_str(t);
    }
    out
}

/// Character count of [`join_tokens`]'s output, without building it.
///
/// Line budgeting and the reading-speed check both need this, and both were
/// previously assuming exactly one separator per gap.
///
/// Mirrors [`join_tokens`] exactly, including how it treats empty tokens
/// (the last *character* emitted decides the boundary, not the last token),
/// so `joined_len(t) == join_tokens(t).chars().count()` always holds. That
/// equality is property-tested below.
pub fn joined_len(tokens: &[&str]) -> usize {
    let mut len = 0usize;
    let mut last: Option<char> = None;
    for (i, t) in tokens.iter().enumerate() {
        let space = i > 0
            && match (last, t.chars().next()) {
                (Some(a), Some(b)) => !(is_cjk_spacing(a) && is_cjk_spacing(b)),
                _ => false,
            };
        if space {
            len += 1;
        }
        len += t.chars().count();
        if let Some(c) = t.chars().next_back() {
            last = Some(c);
        }
    }
    len
}

#[cfg(test)]
mod tests {

    #[test]
    fn chinese_punctuation_takes_no_space_after_it() {
        // Straight from a burned frame: the translation came back as
        // "你好，世界。" and was re-wrapped with a space after every mark.
        assert_eq!(
            join_tokens(&["你", "好，", "世", "界。", "第", "二", "行、", "完", "毕。"]),
            "你好，世界。第二行、完毕。"
        );
        assert_eq!(
            join_tokens(&["说", "（真", "的）", "吗", "？"]),
            "说（真的）吗？"
        );
    }

    #[test]
    fn latin_punctuation_still_takes_a_space_after_it() {
        // The fix must not close up English, where the comma is U+002C.
        assert_eq!(join_tokens(&["Hello,", "world"]), "Hello, world");
        assert_eq!(join_tokens(&["one.", "Two"]), "one. Two");
    }

    #[test]
    fn a_space_survives_between_cjk_and_latin() {
        // Only a boundary that is CJK on *both* sides closes up.
        assert_eq!(
            join_tokens(&["用", "OpenSubs", "剪", "辑"]),
            "用 OpenSubs 剪辑"
        );
        assert_eq!(join_tokens(&["界。", "OpenSubs"]), "界。 OpenSubs");
    }

    #[test]
    fn punctuation_does_not_count_as_a_letter_for_the_line_budget() {
        // `is_cjk_spacing` is deliberately wider than `is_cjk_char`, and
        // the budget must keep using the narrow one: a line of Latin words
        // with CJK quotes around it is still Latin.
        assert!(!is_cjk_dominant("“Hello there,” he said。"));
        assert!(is_cjk_dominant("你好世界"));
    }
    use super::*;

    #[test]
    fn latin_text_gets_the_latin_budget() {
        assert!(!is_cjk_dominant("Hello world"));
        assert_eq!(line_budget("Hello world"), MAX_CHARS_LATIN);
    }

    #[test]
    fn chinese_text_gets_the_cjk_budget() {
        assert!(is_cjk_dominant("只做单点闭环"));
        assert_eq!(line_budget("只做单点闭环"), MAX_CHARS_CJK);
    }

    #[test]
    fn japanese_and_korean_count_as_cjk() {
        assert!(is_cjk_dominant("こんにちは世界"));
        assert!(is_cjk_dominant("안녕하세요"));
    }

    #[test]
    fn mixed_text_follows_the_majority_of_letters() {
        // Mostly Latin with a stray CJK term stays on the Latin budget.
        assert!(!is_cjk_dominant("The CapCut 字幕 tool is slow"));
        // Mostly CJK with a stray Latin term uses the CJK budget.
        assert!(is_cjk_dominant("这个 CapCut 工具很慢很难用"));
    }

    #[test]
    fn punctuation_and_digits_do_not_decide_the_script() {
        assert!(!is_cjk_dominant("123 ... !!!"));
    }

    #[test]
    fn cjk_tokens_are_joined_with_no_space_at_all() {
        // The bug this exists for: joining unconditionally with " " renders
        // "字幕 工具 视频 时间", which is wrong on every Chinese subtitle.
        assert_eq!(
            join_tokens(&["字幕", "工具", "视频", "时间"]),
            "字幕工具视频时间"
        );
    }

    #[test]
    fn latin_tokens_keep_their_spaces() {
        assert_eq!(
            join_tokens(&["Hello", "world", "again"]),
            "Hello world again"
        );
    }

    #[test]
    fn a_cjk_latin_boundary_still_takes_a_space() {
        // Only a CJK/CJK boundary closes up; mixed script reads correctly
        // only with the space kept.
        assert_eq!(join_tokens(&["这个", "CapCut", "工具"]), "这个 CapCut 工具");
        assert!(needs_space_between("这个", "CapCut"));
        assert!(needs_space_between("CapCut", "工具"));
        assert!(!needs_space_between("这个", "工具"));
    }

    #[test]
    fn the_boundary_is_decided_per_character_not_per_token() {
        // Only the two characters either side of the gap matter, not the
        // script of the tokens as a whole. A mixed token ending in CJK
        // closes up against a following CJK token...
        assert!(!needs_space_between("yy字幕", "工具"));
        assert!(!needs_space_between("字幕", "工具yy"));
        // ...but one ending in Latin still takes a space.
        assert!(needs_space_between("字幕yy", "工具"));
        assert_eq!(join_tokens(&["yy字幕", "工具"]), "yy字幕工具");
        assert_eq!(join_tokens(&["字幕yy", "工具"]), "字幕yy 工具");
    }

    #[test]
    fn japanese_and_korean_join_like_chinese() {
        assert_eq!(join_tokens(&["こんにちは", "世界"]), "こんにちは世界");
        assert_eq!(join_tokens(&["안녕", "하세요"]), "안녕하세요");
    }

    #[test]
    fn joined_len_always_agrees_with_join_tokens() {
        // These two must not drift: one decides line budgets and reading
        // speed, the other decides what is actually rendered.
        let cases: [&[&str]; 8] = [
            &[],
            &["solo"],
            &["Hello", "world"],
            &["字幕", "工具"],
            &["这个", "CapCut", "工具"],
            &["yy字幕", "工具", "x"],
            &["", "字幕", ""],
            &["a", "", "b"],
        ];
        for c in cases {
            assert_eq!(
                joined_len(c),
                join_tokens(c).chars().count(),
                "disagreed on {c:?}"
            );
        }
    }

    #[test]
    fn empty_tokens_never_produce_a_stray_space() {
        assert_eq!(join_tokens(&["a", "", "b"]), "a b");
        assert_eq!(join_tokens(&["字幕", "", "工具"]), "字幕工具");
    }
}
