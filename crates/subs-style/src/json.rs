//! Style templates as JSON.
//!
//! `StyleTemplate` has always derived `Serialize`/`Deserialize`, but nothing
//! ever read or wrote one, so the design spec's "template schema" existed
//! only as a derive. This is that schema's actual entry point: export a
//! shipped preset, edit it, load it back.
//!
//! **This module still performs no I/O.** It converts between strings and
//! templates; opening files is the applications' job, which keeps the whole
//! crate testable on literals.

use crate::StyleTemplate;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StyleError {
    /// The text was not valid JSON, or not shaped like a template.
    Malformed(String),
    /// The template parsed but describes something that cannot render.
    Invalid(String),
}

impl fmt::Display for StyleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Malformed(m) => write!(f, "not a style template: {m}"),
            Self::Invalid(m) => write!(f, "invalid style template: {m}"),
        }
    }
}

impl std::error::Error for StyleError {}

/// Parse and validate a template.
///
/// Validation is not optional politeness: ASS silently accepts nonsense.
/// An alignment of 12 or a negative outline produces a document ffmpeg
/// renders without complaint and the user cannot explain, so the error
/// belongs here, naming the field.
pub fn from_json_str(json: &str) -> Result<StyleTemplate, StyleError> {
    let template: StyleTemplate =
        serde_json::from_str(json).map_err(|e| StyleError::Malformed(e.to_string()))?;
    validate(&template)?;
    Ok(template)
}

/// Serialise a template, pretty-printed -- these files are meant to be
/// opened and edited by hand.
pub fn to_json_string(template: &StyleTemplate) -> String {
    // The struct is plain data with no map keys that can fail to serialise,
    // so this cannot realistically fail; falling back to "{}" would hide a
    // bug rather than fix one.
    serde_json::to_string_pretty(template).unwrap_or_else(|e| {
        unreachable!("a StyleTemplate must always serialise, but: {e}");
    })
}

/// Reject templates that would render wrongly or not at all.
pub fn validate(t: &StyleTemplate) -> Result<(), StyleError> {
    let bad = |m: String| Err(StyleError::Invalid(m));

    if t.name.trim().is_empty() {
        return bad("name is empty".into());
    }
    if t.font.trim().is_empty() {
        return bad(format!("{}: font is empty", t.name));
    }
    if !(t.size_pct.is_finite() && t.size_pct > 0.0 && t.size_pct < 20.0) {
        return bad(format!(
            "{}: size_pct is {} -- it is a percentage of video height and must be between 0 and 20",
            t.name, t.size_pct
        ));
    }
    if !(1..=9).contains(&t.alignment) {
        return bad(format!(
            "{}: alignment is {} -- ASS alignments are numpad positions 1-9",
            t.name, t.alignment
        ));
    }
    if !(t.margin_v_pct.is_finite() && (0.0..50.0).contains(&t.margin_v_pct)) {
        return bad(format!(
            "{}: margin_v_pct is {} -- it is a percentage of video height and must be under 50",
            t.name, t.margin_v_pct
        ));
    }
    if !(t.outline.is_finite() && t.outline >= 0.0) {
        return bad(format!("{}: outline must not be negative", t.name));
    }
    if !(t.shadow.is_finite() && t.shadow >= 0.0) {
        return bad(format!("{}: shadow must not be negative", t.name));
    }
    if t.primary.a == 0 {
        return bad(format!("{}: primary colour is fully transparent", t.name));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{preset_by_name, presets};

    #[test]
    fn every_shipped_preset_round_trips_through_json() {
        for p in crate::all_presets() {
            let json = to_json_string(&p);
            let back = from_json_str(&json).expect(&p.name);
            assert_eq!(back.name, p.name);
            assert_eq!(back.font, p.font);
            assert_eq!(back.size_pct, p.size_pct);
            assert_eq!(back.alignment, p.alignment);
            assert_eq!(back.primary, p.primary);
            assert_eq!(back.border_style, p.border_style);
        }
    }

    #[test]
    fn every_shipped_preset_passes_its_own_validator() {
        for p in crate::all_presets() {
            validate(&p).unwrap_or_else(|e| panic!("{} is not valid: {e}", p.name));
        }
    }

    #[test]
    fn a_hand_edited_template_loads() {
        let json = r#"{
            "name": "My Look",
            "font": "Inter",
            "size_pct": 5.0,
            "primary":       {"r": 255, "g": 255, "b": 255, "a": 255},
            "outline_color": {"r": 0,   "g": 0,   "b": 0,   "a": 255},
            "back_color":    {"r": 0,   "g": 0,   "b": 0,   "a": 0},
            "bold": true,
            "italic": false,
            "border_style": "OutlineShadow",
            "outline": 2.5,
            "shadow": 0.0,
            "alignment": 2,
            "margin_v_pct": 7.0
        }"#;
        let t = from_json_str(json).unwrap();
        assert_eq!(t.name, "My Look");
        assert_eq!(t.outline, 2.5);
    }

    #[test]
    fn malformed_json_is_reported_as_malformed() {
        assert!(matches!(
            from_json_str("{ not json"),
            Err(StyleError::Malformed(_))
        ));
        assert!(matches!(
            from_json_str(r#"{"name": "x"}"#),
            Err(StyleError::Malformed(_))
        ));
    }

    #[test]
    fn nonsense_values_are_named_rather_than_rendered() {
        let mut t = preset_by_name("Clean").unwrap();

        t.alignment = 12;
        let e = validate(&t).unwrap_err().to_string();
        assert!(e.contains("alignment"), "{e}");

        t = preset_by_name("Clean").unwrap();
        t.size_pct = 400.0;
        assert!(validate(&t).unwrap_err().to_string().contains("size_pct"));

        t = preset_by_name("Clean").unwrap();
        t.outline = -1.0;
        assert!(validate(&t).unwrap_err().to_string().contains("outline"));

        t = preset_by_name("Clean").unwrap();
        t.primary.a = 0;
        assert!(validate(&t)
            .unwrap_err()
            .to_string()
            .contains("transparent"));

        t = preset_by_name("Clean").unwrap();
        t.font = "  ".into();
        assert!(validate(&t).unwrap_err().to_string().contains("font"));
    }

    #[test]
    fn a_non_finite_number_is_rejected_rather_than_reaching_the_ass_writer() {
        let mut t = presets().remove(0);
        t.size_pct = f64::NAN;
        assert!(validate(&t).is_err());
        t = presets().remove(0);
        t.margin_v_pct = f64::INFINITY;
        assert!(validate(&t).is_err());
    }

    #[test]
    fn the_exported_json_is_readable_enough_to_edit_by_hand() {
        let json = to_json_string(&preset_by_name("Clean").unwrap());
        assert!(json.contains('\n'), "pretty-printing is the point");
        assert!(json.contains("\"size_pct\""));
    }
}
