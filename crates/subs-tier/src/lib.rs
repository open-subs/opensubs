//! What each capability is, and what it costs the person using it.
//!
//! One catalogue, read by the desktop app's "What's included" panel, the web
//! app's equivalent and the CLI's `features` command, so the three can never
//! describe the product differently.
//!
//! The rule it encodes: **everything that runs on the user's machine is
//! free.** Their CPU does that work whether or not anyone is paid, and the
//! source is open, so a "paid" switch on local work would be a suggestion
//! rather than a price. What can honestly cost money is work done on our
//! backend with a key we hold -- today that is cloud translation, paid for
//! in credits, priced before it runs and charged only when it succeeds.
//!
//! The text in this module is shown to users verbatim. Keep it about what a
//! feature does for them; [`tests::descriptions_are_written_for_users`]
//! refuses internal vocabulary and untranslated text.

use serde::Serialize;

/// What a capability costs the person using it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cost {
    /// Runs on the user's machine. No key, no account, no bill.
    Free,
    /// Free on-device, with a better route through the user's own API key.
    FreeOrOwnKey,
    /// Free on-device, with a better route on our backend, paid in credits.
    FreeOrCredits,
    /// Needs the user's own API key. They pay that provider directly; we
    /// never see the traffic or take a cut.
    OwnKey,
    /// Runs on our backend and is paid in credits.
    Paid,
}

impl Cost {
    /// The badge text.
    pub fn label(self) -> &'static str {
        match self {
            Self::Free => "Free",
            Self::FreeOrOwnKey => "Free, or your own key",
            Self::FreeOrCredits => "Free, or credits",
            Self::OwnKey => "Your own API key",
            Self::Paid => "Credits",
        }
    }

    /// One line explaining the badge, for a caption or a tooltip.
    pub fn explanation(self) -> &'static str {
        match self {
            Self::Free => "Runs on your machine. No key, no account, nothing uploaded.",
            Self::FreeOrOwnKey => {
                "Works for free on this device. Bring an API key for better quality."
            }
            Self::FreeOrCredits => {
                "Free on this device. The cloud option is more fluent and uses credits; \
                 you see the price before it runs."
            }
            Self::OwnKey => {
                "Calls a service with your own key. You pay that provider directly; \
                 the key stays on your device."
            }
            Self::Paid => {
                "Runs on our servers and uses credits. You see the price before it runs, \
                 and a job that fails costs nothing."
            }
        }
    }
}

/// One catalogue row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct FeatureInfo {
    /// Stable machine identifier. Used by the CLI's `features` command and
    /// by the desktop UI; never rename one without updating both.
    pub id: &'static str,
    pub title: &'static str,
    /// What using it costs the person using it.
    pub cost: Cost,
    /// One sentence for the user: what the feature is and what it does.
    pub why: &'static str,
}

impl FeatureInfo {
    const fn free(id: &'static str, title: &'static str, why: &'static str) -> Self {
        Self {
            id,
            title,
            cost: Cost::Free,
            why,
        }
    }

    const fn costing(id: &'static str, title: &'static str, cost: Cost, why: &'static str) -> Self {
        Self {
            id,
            title,
            cost,
            why,
        }
    }
}

const CATALOG: &[FeatureInfo] = &[
    FeatureInfo::free(
        "import",
        "Video import and probe",
        "Open a video and see its length, resolution and audio before you start.",
    ),
    FeatureInfo::free(
        "trim",
        "Trim to a clip",
        "Cut out just the part you want before adding subtitles.",
    ),
    FeatureInfo::free(
        "asr",
        "Automatic subtitle generation",
        "Turns the speech in your video into timed subtitles, on this computer.",
    ),
    FeatureInfo::free(
        "style_presets",
        "Subtitle style presets",
        "Ready-made subtitle looks you can apply with one click.",
    ),
    FeatureInfo::free(
        "burn",
        "Burn-in export",
        "Writes the subtitles into the picture and saves a new MP4.",
    ),
    FeatureInfo::free(
        "sidecar_subtitles",
        "SRT and VTT sidecar files",
        "Saves the subtitles as SRT or VTT files you can edit or upload anywhere.",
    ),
    FeatureInfo::free(
        "no_watermark",
        "No watermark, at any resolution",
        "Your video comes out clean, with nothing added to the picture.",
    ),
    FeatureInfo::free(
        "unlimited_length",
        "Unlimited clip length and no export quota",
        "Videos of any length, and as many exports as you like.",
    ),
    FeatureInfo::free(
        "high_accuracy_asr",
        "Larger speech models",
        "Download a larger speech model for more accurate subtitles. It still runs on this computer.",
    ),
    FeatureInfo::free(
        "export_resolution",
        "Export resolution and encoder control",
        "Choose the output resolution, from the original size down to smaller files.",
    ),
    FeatureInfo::free(
        "advanced_styles",
        "Advanced style pack",
        "A second set of subtitle styles with bolder outlines, boxes and highlights.",
    ),
    FeatureInfo::free(
        "custom_styles",
        "Custom style templates from JSON",
        "Load your own subtitle style from a JSON file.",
    ),
    FeatureInfo::costing(
        "translation",
        "Translated subtitles",
        Cost::FreeOrCredits,
        "Translate the subtitles into another language. On this computer it is free; \
         cloud translation reads more naturally and uses credits.",
    ),
    FeatureInfo::free(
        "batch_cli",
        "Command-line tool",
        "Subtitle videos from scripts and the terminal with the opensubs command.",
    ),
];

/// Every catalogue row.
pub fn catalog() -> Vec<FeatureInfo> {
    CATALOG.to_vec()
}

/// Look a row up by its stable id.
pub fn feature(id: &str) -> Option<FeatureInfo> {
    CATALOG.iter().find(|f| f.id == id).copied()
}

/// One line per row, for `opensubs features`.
pub fn summary_lines() -> Vec<String> {
    catalog()
        .into_iter()
        .map(|f| format!("{:<20} {:<17} {}", f.id, f.cost.label(), f.title))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_unique_and_lookup_is_exact() {
        let mut ids: Vec<&str> = catalog().iter().map(|f| f.id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate feature id");

        assert!(feature("translation").is_some());
        assert!(feature("Translation").is_none());
        assert!(feature("no_such_feature").is_none());
    }

    #[test]
    fn everything_local_is_free() {
        // Only work on our backend may cost credits. If another row starts
        // costing something, this is the place to notice, because the
        // badges in every app come from here.
        let paying: Vec<&str> = catalog()
            .into_iter()
            .filter(|f| f.cost != Cost::Free)
            .map(|f| f.id)
            .collect();
        assert_eq!(paying, ["translation"]);
    }

    #[test]
    fn output_quality_is_never_paid_for() {
        for id in [
            "no_watermark",
            "unlimited_length",
            "burn",
            "asr",
            "export_resolution",
        ] {
            assert_eq!(
                feature(id).unwrap().cost,
                Cost::Free,
                "{id} costs something"
            );
        }
    }

    #[test]
    fn every_row_explains_itself() {
        for f in catalog() {
            assert!(!f.why.is_empty(), "{}: no description", f.id);
            assert!(!f.title.is_empty(), "{}: no title", f.id);
        }
    }

    /// The panel shows these strings to users as they are. Words that only
    /// make sense inside the team, and text in another language inside an
    /// English interface, have no place in them.
    #[test]
    fn descriptions_are_written_for_users() {
        const INTERNAL: &[&str] = &[
            "competitor",
            "study",
            "spec",
            "\u{a7}",
            "conversion",
            "p1 ",
            "tier",
            "premium",
            "captions is",
            "submagic",
            "opus clip",
            "monetis",
            "table stakes",
        ];
        let mut texts: Vec<(&str, &str)> = Vec::new();
        for f in catalog() {
            texts.push((f.id, f.why));
            texts.push((f.id, f.title));
        }
        for cost in [
            Cost::Free,
            Cost::FreeOrOwnKey,
            Cost::FreeOrCredits,
            Cost::OwnKey,
            Cost::Paid,
        ] {
            texts.push(("cost", cost.label()));
            texts.push(("cost", cost.explanation()));
        }
        for (id, text) in texts {
            let lower = text.to_lowercase();
            for word in INTERNAL {
                assert!(!lower.contains(word), "{id}: {word:?} in {text:?}");
            }
            assert!(
                !text.chars().any(|c| ('\u{2e80}'..='\u{9fff}').contains(&c)
                    || ('\u{f900}'..='\u{faff}').contains(&c)
                    || ('\u{ac00}'..='\u{d7af}').contains(&c)),
                "{id}: CJK text in {text:?}"
            );
            assert!(!text.contains("  "), "{id}: doubled space in {text:?}");
        }
    }

    #[test]
    fn summary_has_one_line_per_feature() {
        assert_eq!(summary_lines().len(), catalog().len());
        assert!(summary_lines()
            .iter()
            .any(|l| l.contains("Free, or credits")));
    }

    #[test]
    fn every_cost_explains_itself() {
        for cost in [
            Cost::Free,
            Cost::FreeOrOwnKey,
            Cost::FreeOrCredits,
            Cost::OwnKey,
            Cost::Paid,
        ] {
            assert!(!cost.label().is_empty());
            assert!(!cost.explanation().is_empty());
        }
    }
}
