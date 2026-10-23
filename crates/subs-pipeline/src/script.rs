//! Which Chinese script the subtitles come out in.
//!
//! Whisper has one Chinese, `<|zh|>`, and which script it writes is decided
//! by the audio, not by anything a caller can set. Measured on the same
//! Mandarin reader: one chapter came back Simplified, the next Traditional,
//! and putting ten seconds of silence in front of the second turned it
//! Simplified. Asking for a translation into Simplified did not help either:
//! with Chinese in and Chinese out the offline translator has nothing to do
//! and hands the text back as it came.
//!
//! So the script is set here, deterministically, after transcription and
//! after any translation, with OpenCC's dictionaries (Apache-2.0, compiled
//! into the binary by `ferrous-opencc`; nothing is fetched). Phrase by
//! phrase rather than character by character, so 頭髮 and 發展 each become
//! the right Simplified word. Traditional is Taiwan's standard forms and
//! vocabulary (OpenCC's `s2twp`), which is what OpenDub writes too.

use std::sync::OnceLock;

use ferrous_opencc::{config::BuiltinConfig, OpenCC};
use subs_subtitle::Cue;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChineseScript {
    Simplified,
    Traditional,
}

impl ChineseScript {
    /// The script a language code names, if it names one: `zh-Hans`,
    /// `zh-CN` and `zh-SG` are Simplified; `zh-Hant`, `zh-TW`, `zh-HK` and
    /// `zh-MO` are Traditional; bare `zh`, and anything not Chinese, is `None`.
    pub fn of_code(code: &str) -> Option<Self> {
        let c = code.to_ascii_lowercase().replace('_', "-");
        if !(c == "zh" || c.starts_with("zh-")) {
            return None;
        }
        if c.contains("hant") || c.ends_with("-tw") || c.ends_with("-hk") || c.ends_with("-mo") {
            Some(Self::Traditional)
        } else if c.contains("hans") || c.ends_with("-cn") || c.ends_with("-sg") {
            Some(Self::Simplified)
        } else {
            None
        }
    }

    /// `"simplified"` / `"traditional"`, as the desktop app and the CLI
    /// spell the setting.
    pub fn parse(name: &str) -> Option<Self> {
        match name.trim().to_ascii_lowercase().as_str() {
            "simplified" | "hans" | "zh-hans" => Some(Self::Simplified),
            "traditional" | "hant" | "zh-hant" => Some(Self::Traditional),
            _ => None,
        }
    }

    fn converter(self) -> Option<&'static OpenCC> {
        static T2S: OnceLock<Option<OpenCC>> = OnceLock::new();
        static S2TWP: OnceLock<Option<OpenCC>> = OnceLock::new();
        let (cell, config) = match self {
            Self::Simplified => (&T2S, BuiltinConfig::T2s),
            Self::Traditional => (&S2TWP, BuiltinConfig::S2twp),
        };
        cell.get_or_init(|| OpenCC::from_config(config).ok()).as_ref()
    }

    /// `text` in this script. Text holding kana or hangul is Japanese or
    /// Korean, whose kanji/hanja are not a script choice, and is left alone,
    /// as is text with no Han characters at all.
    pub fn apply(self, text: &str) -> String {
        let has_han = text.chars().any(|c| matches!(c as u32, 0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF));
        let not_chinese = text
            .chars()
            .any(|c| matches!(c as u32, 0x3040..=0x30FF | 0x31F0..=0x31FF | 0xAC00..=0xD7AF | 0x1100..=0x11FF));
        if !has_han || not_chinese {
            return text.to_string();
        }
        match self.converter() {
            Some(cc) => cc.convert(text),
            None => text.to_string(),
        }
    }

    /// Every line of every cue in this script, timings untouched.
    pub fn apply_to_cues(self, cues: &[Cue]) -> Vec<Cue> {
        cues.iter()
            .map(|c| Cue { start: c.start, end: c.end, lines: c.lines.iter().map(|l| self.apply(l)).collect() })
            .collect()
    }
}

/// Which script the burned cues must be in.
///
/// A translation into a named script always gets that script -- the user
/// picked it from a list that says 简体 or 繁體. Untranslated Chinese speech
/// gets the user's setting. Anything else is not Chinese and is left alone.
pub fn script_for(translate_to: Option<&str>, spoken: &str, setting: Option<ChineseScript>) -> Option<ChineseScript> {
    match translate_to {
        Some(target) => ChineseScript::of_code(target),
        None if spoken.to_ascii_lowercase().starts_with("zh") => setting,
        None => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A sentence as Whisper writes it in Traditional, punctuation and all.
    const TRADITIONAL: &str = "我叫小王, 今年 30 歲, 在杭州一家軟件公司做設計師。";

    #[test]
    fn simplified_is_simplified() {
        assert_eq!(ChineseScript::Simplified.apply(TRADITIONAL), "我叫小王, 今年 30 岁, 在杭州一家软件公司做设计师。");
        // Already Simplified stays as it is.
        let s = "今天早上七点，我们从北京出发。";
        assert_eq!(ChineseScript::Simplified.apply(s), s);
        // Phrase by phrase: 頭髮 and 發展 are different characters in Simplified.
        assert_eq!(ChineseScript::Simplified.apply("頭髮和發展"), "头发和发展");
    }

    #[test]
    fn traditional_is_taiwan_traditional() {
        let out = ChineseScript::Traditional.apply("我叫小王，在杭州一家软件公司做设计师。");
        assert_eq!(out, "我叫小王，在杭州一家軟體公司做設計師。");
        // Mixed input comes out in one script.
        assert_eq!(ChineseScript::Traditional.apply("会議"), "會議");
    }

    #[test]
    fn japanese_korean_and_latin_are_left_alone() {
        for t in ["時間が見える", "한국어 漢字", "Hello, world"] {
            assert_eq!(ChineseScript::Simplified.apply(t), t);
            assert_eq!(ChineseScript::Traditional.apply(t), t);
        }
    }

    #[test]
    fn the_target_decides_when_translating_and_the_setting_otherwise() {
        use ChineseScript::*;
        assert_eq!(script_for(Some("zh-Hans"), "zh", Some(Traditional)), Some(Simplified));
        assert_eq!(script_for(Some("zh-Hant"), "en", Some(Simplified)), Some(Traditional));
        assert_eq!(script_for(Some("ja"), "zh", Some(Simplified)), None);
        assert_eq!(script_for(None, "zh", Some(Traditional)), Some(Traditional));
        assert_eq!(script_for(None, "en", Some(Simplified)), None);
        assert_eq!(script_for(None, "zh", None), None);
    }

    #[test]
    fn codes_name_scripts() {
        use ChineseScript::*;
        assert_eq!(ChineseScript::of_code("zh-Hans"), Some(Simplified));
        assert_eq!(ChineseScript::of_code("zh_TW"), Some(Traditional));
        assert_eq!(ChineseScript::of_code("zh-HK"), Some(Traditional));
        assert_eq!(ChineseScript::of_code("zh"), None);
        assert_eq!(ChineseScript::of_code("zu"), None);
        assert_eq!(ChineseScript::parse("Traditional"), Some(Traditional));
    }
}
