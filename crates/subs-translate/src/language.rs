//! The target languages offered in the UI.
//!
//! Deliberately a curated list rather than every code Claude can handle:
//! a picker with 100 entries is worse than one with 20, and an unlisted
//! code still works -- [`resolve`] passes anything through, so the CLI's
//! `--translate-to` is not limited to this list.

/// One offered target.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Language {
    /// BCP-47-ish code, as sent to the model and stored in filenames.
    pub code: &'static str,
    /// English name, for logs and the CLI.
    pub name: &'static str,
    /// The name in the language itself, for the picker -- a reader looking
    /// for their own language scans for its endonym, not for "Japanese".
    pub endonym: &'static str,
}

const LANGUAGES: &[Language] = &[
    Language {
        code: "en",
        name: "English",
        endonym: "English",
    },
    Language {
        code: "zh-Hans",
        name: "Chinese (Simplified)",
        endonym: "简体中文",
    },
    Language {
        code: "zh-Hant",
        name: "Chinese (Traditional)",
        endonym: "繁體中文",
    },
    Language {
        code: "ja",
        name: "Japanese",
        endonym: "日本語",
    },
    Language {
        code: "ko",
        name: "Korean",
        endonym: "한국어",
    },
    Language {
        code: "es",
        name: "Spanish",
        endonym: "Español",
    },
    Language {
        code: "pt",
        name: "Portuguese",
        endonym: "Português",
    },
    Language {
        code: "fr",
        name: "French",
        endonym: "Français",
    },
    Language {
        code: "de",
        name: "German",
        endonym: "Deutsch",
    },
    Language {
        code: "it",
        name: "Italian",
        endonym: "Italiano",
    },
    Language {
        code: "ru",
        name: "Russian",
        endonym: "Русский",
    },
    Language {
        code: "ar",
        name: "Arabic",
        endonym: "العربية",
    },
    Language {
        code: "hi",
        name: "Hindi",
        endonym: "हिन्दी",
    },
    Language {
        code: "id",
        name: "Indonesian",
        endonym: "Bahasa Indonesia",
    },
    Language {
        code: "th",
        name: "Thai",
        endonym: "ไทย",
    },
    Language {
        code: "vi",
        name: "Vietnamese",
        endonym: "Tiếng Việt",
    },
    Language {
        code: "tr",
        name: "Turkish",
        endonym: "Türkçe",
    },
    Language {
        code: "pl",
        name: "Polish",
        endonym: "Polski",
    },
    Language {
        code: "nl",
        name: "Dutch",
        endonym: "Nederlands",
    },
    Language {
        code: "uk",
        name: "Ukrainian",
        endonym: "Українська",
    },
];

/// Every offered target.
pub fn languages() -> &'static [Language] {
    LANGUAGES
}

/// Look up a code, case-insensitively.
pub fn find(code: &str) -> Option<Language> {
    LANGUAGES
        .iter()
        .find(|l| l.code.eq_ignore_ascii_case(code))
        .copied()
}

/// The name to put in a prompt for `code`.
///
/// An unknown code is passed through verbatim rather than rejected: the
/// curated list exists to keep the picker short, not to limit what the
/// model may be asked for.
pub fn resolve(code: &str) -> String {
    find(code).map_or_else(|| code.to_string(), |l| l.name.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codes_are_unique() {
        let mut codes: Vec<&str> = languages().iter().map(|l| l.code).collect();
        let n = codes.len();
        codes.sort_unstable();
        codes.dedup();
        assert_eq!(codes.len(), n, "duplicate language code");
    }

    #[test]
    fn lookup_ignores_case() {
        assert_eq!(find("ZH-HANS").unwrap().name, "Chinese (Simplified)");
        assert_eq!(find("ja").unwrap().endonym, "日本語");
    }

    #[test]
    fn an_unlisted_code_still_resolves_to_something_usable() {
        assert_eq!(resolve("sv"), "sv");
        assert_eq!(resolve("es"), "Spanish");
    }

    #[test]
    fn every_entry_is_filled_in() {
        for l in languages() {
            assert!(!l.code.is_empty());
            assert!(!l.name.is_empty());
            assert!(!l.endonym.is_empty());
        }
    }
}
