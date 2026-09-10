//! Which capabilities are free, which are premium, and what is unlocked
//! right now.
//!
//! The competitor study (`市场洞察与竞品研究 - 产品竞争格局调研`, §5.2) split
//! this category's features into a free acquisition set and three paid
//! conversion points, and the design spec (§7) then constrained where a gate
//! may ever fall: **volume and automation, never quality.** Those two
//! documents disagree on two rows -- the study assumes the industry-standard
//! watermark and length cap on the free tier, which §7 forbids outright --
//! and this module is where that disagreement is resolved in code rather
//! than in prose. See [`PREMIUM_UNLOCKED`].
//!
//! Nothing here gates anything. Every call site asks [`is_unlocked`] and is
//! told `true`, because [`PREMIUM_UNLOCKED`] is `true`. The point of routing
//! the question through a single function anyway is that the day a gate does
//! arrive, it arrives *here*, with the whole catalogue visible in one screen
//! -- rather than as a scatter of `if paid` scattered through the pipeline,
//! which is how the billing complaints in §5.3 start.

use serde::Serialize;

/// **Premium features are unlocked for every user.**
///
/// Flipping this to `false` is deliberately not enough to ship a paywall:
/// there is no licence check, no account, and no entitlement source behind
/// it. It exists so that the catalogue can answer "is this gated?" honestly
/// today, and so that the eventual gate has exactly one place to live.
pub const PREMIUM_UNLOCKED: bool = true;

/// What a capability actually costs the person using it, today.
///
/// Distinct from [`Tier`], which says where revenue *would* come from.
/// A user does not care about that; they care whether pressing the button
/// costs them anything, and if so, whom they pay. Keeping the two separate
/// is what lets the interface be honest about both at once.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Cost {
    /// Runs on the user's machine. No key, no account, no bill.
    Free,
    /// Free on-device, with a better paid route available if they want it.
    FreeOrOwnKey,
    /// Needs the user's own API key. They pay that provider directly; we
    /// never see the traffic or take a cut.
    OwnKey,
    /// Billed by us, through our own backend. Free during testing.
    Paid,
}

impl Cost {
    /// The badge text.
    pub fn label(self) -> &'static str {
        match self {
            Self::Free => "Free",
            Self::FreeOrOwnKey => "Free, or your own key",
            Self::OwnKey => "Your own API key",
            Self::Paid => "Paid",
        }
    }

    /// One line explaining the badge, for a caption or a tooltip.
    pub fn explanation(self) -> &'static str {
        match self {
            Self::Free => "Runs on your machine. No key, no account, nothing uploaded.",
            Self::FreeOrOwnKey => {
                "Works for free on this device. Bring an API key for better quality."
            }
            Self::OwnKey => {
                "Calls a service with your own key. You pay that provider directly;                  the key stays in this tab."
            }
            Self::Paid => "Runs on our backend. Free while we are testing.",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Tier {
    /// Free forever, per design spec §7. Gating any of these would make the
    /// product the thing its own thesis is a reaction to.
    Free,
    /// Positioned as paid by the competitor study, shipped unlocked today.
    Premium,
}

impl Tier {
    pub fn label(self) -> &'static str {
        match self {
            Self::Free => "Free",
            Self::Premium => "Premium",
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
    pub tier: Tier,
    /// What using it costs the person using it, right now.
    pub cost: Cost,
    /// Why it sits in that tier -- the finding, not a marketing line.
    pub why: &'static str,
    /// Whether this build actually lets the user have it.
    pub unlocked: bool,
}

impl FeatureInfo {
    const fn free(id: &'static str, title: &'static str, why: &'static str) -> Self {
        Self {
            id,
            title,
            tier: Tier::Free,
            cost: Cost::Free,
            why,
            unlocked: true,
        }
    }

    const fn premium(id: &'static str, title: &'static str, why: &'static str) -> Self {
        Self {
            id,
            title,
            tier: Tier::Premium,
            cost: Cost::Free,
            unlocked: PREMIUM_UNLOCKED,
            why,
        }
    }

    /// A premium row that costs the user something to actually run.
    const fn premium_costing(
        id: &'static str,
        title: &'static str,
        cost: Cost,
        why: &'static str,
    ) -> Self {
        Self {
            id,
            title,
            tier: Tier::Premium,
            cost,
            unlocked: PREMIUM_UNLOCKED,
            why,
        }
    }
}

/// The free acquisition set: the study's §5.2 "user actually uses it, and
/// every direct competitor gives it away" rows, plus the two the design
/// spec's §7 promotes out of premium.
const FREE: &[FeatureInfo] = &[
    FeatureInfo::free(
        "import",
        "Video import and probe",
        "Every one of the twelve competitors surveyed gives basic import away; \
         it is an entry ticket, not a differentiator.",
    ),
    FeatureInfo::free(
        "trim",
        "Trim to a clip",
        "The study's headline scenario is 裁剪切片 -- cutting a clip out of a \
         longer take. Charging for the scenario's first step would be charging \
         for the product.",
    ),
    FeatureInfo::free(
        "asr",
        "Automatic subtitle generation",
        "Accuracy is the category's entry expectation (6 of 9 competitors are \
         praised for it by name in store reviews), so it cannot be the gate.",
    ),
    FeatureInfo::free(
        "style_presets",
        "Subtitle style presets",
        "Basic templates are table stakes; Captions is criticised in its own \
         reviews for shipping too few of them.",
    ),
    FeatureInfo::free(
        "burn",
        "Burn-in export",
        "The closed loop has to close, or the free tier is a demo rather than \
         a product.",
    ),
    FeatureInfo::free(
        "sidecar_subtitles",
        "SRT and VTT sidecar files",
        "Pure text serialisation of work already done. Withholding the user's \
         own transcript is a hostage tactic, not a feature.",
    ),
    FeatureInfo::free(
        "no_watermark",
        "No watermark, at any resolution",
        "The study reports the whole category monetises here (free = watermark, \
         paid = clean). Design spec §7 refuses: gating output quality is the \
         one move that would collapse the positioning.",
    ),
    FeatureInfo::free(
        "unlimited_length",
        "Unlimited clip length and no export quota",
        "Same refusal. Submagic's 3-videos-a-month cap and Opus Clip's \
         expiring exports are the top-cited free-tier grievances in §5.3.",
    ),
];

/// The paid set. Every row here is shipped working and unlocked; the tier is
/// a statement about where revenue would come from, not about what this
/// build withholds.
const PREMIUM: &[FeatureInfo] = &[
    FeatureInfo::premium(
        "high_accuracy_asr",
        "Large ASR models",
        "The study's first conversion point. Larger models cost real compute, \
         which is the honest kind of thing to charge for -- so it is priced \
         here, and given away today.",
    ),
    FeatureInfo::premium(
        "export_resolution",
        "Export resolution and encoder control",
        "The study's second conversion point (\"unlock HD\"). Inverted here: \
         the control is offered rather than the quality withheld.",
    ),
    FeatureInfo::premium(
        "advanced_styles",
        "Advanced style pack",
        "The study's third conversion point, and the one gate design spec §7 \
         endorses outright -- a style pack takes design labour and withholding \
         it degrades nobody's output.",
    ),
    FeatureInfo::premium(
        "custom_styles",
        "Custom style templates from JSON",
        "Automation, which §7 names as fair to charge for.",
    ),
    FeatureInfo::premium_costing(
        "translation",
        "Translated subtitles",
        Cost::FreeOrOwnKey,
        "P1 differentiator in the study; all four competitors offering it \
         charge for it. Costs a per-request API call, so it is priced with the \
         cost.",
    ),
    FeatureInfo::premium(
        "batch_cli",
        "Scriptable CLI",
        "§7's structural differentiator: automation and volume, the two things \
         a per-export competitor cannot give away.",
    ),
];

/// Every catalogue row, free first.
pub fn catalog() -> Vec<FeatureInfo> {
    FREE.iter().chain(PREMIUM.iter()).copied().collect()
}

/// Look a row up by its stable id.
pub fn feature(id: &str) -> Option<FeatureInfo> {
    FREE.iter()
        .chain(PREMIUM.iter())
        .find(|f| f.id == id)
        .copied()
}

/// Whether this build lets the user have `id`.
///
/// An unknown id is **not** unlocked: a typo in a call site must fail
/// closed and loudly in tests, rather than silently granting whatever it
/// meant to ask about.
pub fn is_unlocked(id: &str) -> bool {
    feature(id).is_some_and(|f| f.unlocked)
}

/// One line per row, for `opensubs features` and for the release notes.
pub fn summary_lines() -> Vec<String> {
    catalog()
        .into_iter()
        .map(|f| {
            let state = if f.unlocked { "unlocked" } else { "locked" };
            format!(
                "{:<20} {:<8} {state:<9} {:<22} {}",
                f.id,
                f.tier.label(),
                f.cost.label(),
                f.title
            )
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_feature_is_unlocked_in_this_build() {
        for f in catalog() {
            assert!(f.unlocked, "{} is gated", f.id);
            assert!(is_unlocked(f.id), "{} reports as gated", f.id);
        }
    }

    #[test]
    fn ids_are_unique_and_lookup_is_exact() {
        let mut ids: Vec<&str> = catalog().iter().map(|f| f.id).collect();
        let count = ids.len();
        ids.sort_unstable();
        ids.dedup();
        assert_eq!(ids.len(), count, "duplicate feature id");

        assert!(feature("translation").is_some());
        assert!(feature("Translation").is_none());
    }

    #[test]
    fn an_unknown_feature_fails_closed() {
        assert!(!is_unlocked("no_such_feature"));
        assert!(feature("no_such_feature").is_none());
    }

    #[test]
    fn output_quality_is_never_a_premium_row() {
        // Design spec §7: the free tier is any length, any resolution, no
        // watermark. If either of these ever moves to Premium the thesis is
        // gone, so the move has to break a test on the way out.
        for id in ["no_watermark", "unlimited_length", "burn", "asr"] {
            assert_eq!(
                feature(id).unwrap().tier,
                Tier::Free,
                "{id} left the free tier"
            );
        }
    }

    #[test]
    fn every_row_explains_itself() {
        for f in catalog() {
            assert!(!f.why.is_empty(), "{}: no rationale", f.id);
            assert!(!f.title.is_empty(), "{}: no title", f.id);
        }
    }

    #[test]
    fn summary_has_one_line_per_feature() {
        assert_eq!(summary_lines().len(), catalog().len());
    }

    #[test]
    fn every_free_tier_row_is_free_to_run() {
        // A "free forever" feature that costs money to use would be a
        // contradiction the interface could not explain away.
        for f in catalog() {
            if f.tier == Tier::Free {
                assert_eq!(
                    f.cost,
                    Cost::Free,
                    "{} is free-tier but costs {:?}",
                    f.id,
                    f.cost
                );
            }
        }
    }

    #[test]
    fn only_translation_costs_the_user_anything_today() {
        // Everything else runs locally. If that changes, this test is the
        // place to notice, because the badges in the UI come from here.
        let paying: Vec<&str> = catalog()
            .into_iter()
            .filter(|f| f.cost != Cost::Free)
            .map(|f| f.id)
            .collect();
        assert_eq!(paying, ["translation"]);
    }

    #[test]
    fn every_cost_explains_itself() {
        for cost in [Cost::Free, Cost::FreeOrOwnKey, Cost::OwnKey, Cost::Paid] {
            assert!(!cost.label().is_empty());
            assert!(!cost.explanation().is_empty());
        }
    }

    #[test]
    fn the_summary_names_the_cost() {
        assert!(summary_lines().iter().any(|l| l.contains("Free")));
        assert!(summary_lines()
            .iter()
            .any(|l| l.contains("Free, or your own key")));
    }
}
