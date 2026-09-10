use crate::{BorderStyle, Rgba, StyleTemplate};

const WHITE: Rgba = Rgba {
    r: 255,
    g: 255,
    b: 255,
    a: 255,
};
const BLACK: Rgba = Rgba {
    r: 0,
    g: 0,
    b: 0,
    a: 255,
};
const CLEAR: Rgba = Rgba {
    r: 0,
    g: 0,
    b: 0,
    a: 0,
};
const BOX_BG: Rgba = Rgba {
    r: 0,
    g: 0,
    b: 0,
    a: 180,
};
const YELLOW: Rgba = Rgba {
    r: 255,
    g: 214,
    b: 10,
    a: 255,
};

fn base(name: &str, font: &str, size_pct: f64) -> StyleTemplate {
    StyleTemplate {
        name: name.into(),
        font: font.into(),
        size_pct,
        primary: WHITE,
        outline_color: BLACK,
        back_color: CLEAR,
        bold: true,
        italic: false,
        border_style: BorderStyle::OutlineShadow,
        outline: 2.0,
        shadow: 0.0,
        alignment: 2,
        margin_v_pct: 6.0,
    }
}

/// The six shipped looks. Aesthetics require human sign-off; structural
/// validity is asserted in this module's tests.
pub fn presets() -> Vec<StyleTemplate> {
    vec![
        // Understated: thin outline, standard broadcast position.
        base("Clean", "Inter", 4.5),
        // Heavy outline for busy footage.
        StyleTemplate {
            outline: 4.0,
            ..base("Bold", "Inter", 5.5)
        },
        // Opaque box for maximum legibility over any background.
        StyleTemplate {
            border_style: BorderStyle::OpaqueBox,
            back_color: BOX_BG,
            outline: 0.0,
            ..base("Boxed", "Inter", 4.5)
        },
        // Short-form vertical: large, high, thumb-clear of the UI chrome.
        StyleTemplate {
            size_pct: 6.5,
            margin_v_pct: 18.0,
            outline: 3.0,
            ..base("Shorts", "Inter", 6.5)
        },
        // High-contrast yellow, the classic caption look.
        StyleTemplate {
            primary: YELLOW,
            ..base("Caption", "Inter", 4.5)
        },
        // CJK-safe: a font with full coverage, extra margin for tall glyphs.
        StyleTemplate {
            margin_v_pct: 8.0,
            ..base("CJK", "Noto Sans CJK SC", 5.0)
        },
    ]
}

/// Look up a preset by exact name, across both packs.
pub fn preset_by_name(name: &str) -> Option<StyleTemplate> {
    crate::all_presets().into_iter().find(|s| s.name == name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use subs_subtitle::Cue;

    #[test]
    fn ships_exactly_six_uniquely_named_presets() {
        let p = presets();
        assert_eq!(p.len(), 6);
        let mut names: Vec<&str> = p.iter().map(|s| s.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), 6, "preset names must be unique");
    }

    #[test]
    fn every_preset_is_structurally_valid() {
        for s in presets() {
            assert!(!s.font.is_empty(), "{}: empty font", s.name);
            assert!(s.size_pct > 0.0 && s.size_pct < 20.0, "{}: size", s.name);
            assert!((1..=9).contains(&s.alignment), "{}: alignment", s.name);
            assert!(
                s.margin_v_pct >= 0.0 && s.margin_v_pct < 50.0,
                "{}: margin",
                s.name
            );
            assert!(s.primary.a > 0, "{}: invisible text", s.name);
        }
    }

    #[test]
    fn every_preset_renders_a_parseable_ass_document() {
        let cues = vec![Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["Test".into()],
        }];
        for s in presets() {
            let out = crate::to_ass(&cues, &s, (1080, 1920));
            assert!(out.contains("[V4+ Styles]"), "{}", s.name);
            assert!(out.contains("PlayResX: 1080"), "{}", s.name);
            assert!(out.contains("Dialogue: 0,"), "{}", s.name);
        }
    }

    #[test]
    fn lookup_by_name_is_exact() {
        assert!(preset_by_name("Clean").is_some());
        assert!(preset_by_name("clean").is_none());
        assert!(preset_by_name("nope").is_none());
    }

    #[test]
    fn lookup_reaches_the_advanced_pack_too() {
        assert!(preset_by_name("Neon").is_some());
        assert_eq!(crate::pack_of("Neon"), Some(crate::Pack::Advanced));
        assert_eq!(crate::pack_of("Clean"), Some(crate::Pack::Core));
        assert_eq!(crate::pack_of("nope"), None);
    }

    #[test]
    fn all_presets_is_both_packs_with_unique_names() {
        let all = crate::all_presets();
        assert_eq!(all.len(), presets().len() + crate::advanced_presets().len());
        let mut names: Vec<&str> = all.iter().map(|s| s.name.as_str()).collect();
        let n = names.len();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), n, "a duplicate name would hide a preset");
    }
}
