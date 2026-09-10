//! The advanced style pack.
//!
//! The competitor study's third conversion point, and the only gate the
//! design spec's §7 endorses without argument: a style pack is design
//! labour, and withholding one degrades nobody's output. It ships unlocked
//! (see `subs-tier`) but it is tiered separately so that stays a decision
//! rather than an accident.
//!
//! Two constraints shaped these six, and both are worth stating because
//! they rule out the obvious flashy options:
//!
//! 1. **No word-level karaoke.** The differentiator the spec wants most
//!    (§7.2) needs real per-word timestamps. The shipped ASR backend
//!    (`af_whisper`) emits none -- `FfmpegWhisperTranscriber` synthesises
//!    word timings by splitting a segment proportionally to character
//!    count. A karaoke preset built on those would drift exactly the way
//!    the spec criticises CapCut for drifting, so the pack contains none
//!    until the `Aligner` seam is filled in.
//! 2. **No font the user may not have.** Nothing ships fonts yet, so
//!    libass resolves names through fontconfig and silently substitutes
//!    what it finds. A preset whose whole identity is a font is therefore a
//!    preset that looks like a bug on the machines that lack it. These
//!    differentiate on weight, scale, colour, position and border instead
//!    -- all of which render identically everywhere.

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

/// Near-black at 70% opacity. Softer than the free `Boxed` preset's slab,
/// which is what makes it usable full-time rather than only over busy
/// footage.
const SOFT_BOX: Rgba = Rgba {
    r: 12,
    g: 12,
    b: 16,
    a: 178,
};

const CYAN: Rgba = Rgba {
    r: 34,
    g: 245,
    b: 220,
    a: 255,
};
const MAGENTA: Rgba = Rgba {
    r: 190,
    g: 24,
    b: 160,
    a: 255,
};
const INK: Rgba = Rgba {
    r: 16,
    g: 18,
    b: 24,
    a: 255,
};
const CREAM: Rgba = Rgba {
    r: 245,
    g: 240,
    b: 228,
    a: 255,
};
const SHADOW_SOFT: Rgba = Rgba {
    r: 0,
    g: 0,
    b: 0,
    a: 140,
};

fn base(name: &str, size_pct: f64) -> StyleTemplate {
    StyleTemplate {
        name: name.into(),
        font: "Inter".into(),
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

/// The six advanced looks.
pub fn advanced_presets() -> Vec<StyleTemplate> {
    vec![
        // Cyan on magenta: reads at a glance on a muted phone feed, which
        // is the only thing the colour is doing here.
        StyleTemplate {
            primary: CYAN,
            outline_color: MAGENTA,
            outline: 3.5,
            shadow: 1.0,
            back_color: SHADOW_SOFT,
            ..base("Neon", 5.5)
        },
        // Top-anchored, for talking-head footage whose lower third is
        // already occupied by a name card or a platform's own chrome.
        StyleTemplate {
            alignment: 8,
            margin_v_pct: 8.0,
            border_style: BorderStyle::OpaqueBox,
            back_color: SOFT_BOX,
            outline: 0.0,
            ..base("Podcast", 4.5)
        },
        // Restrained and letterbox-friendly: smaller, lighter, sitting low
        // and wide the way film subtitles do.
        StyleTemplate {
            primary: CREAM,
            bold: false,
            outline: 1.5,
            shadow: 1.0,
            margin_v_pct: 9.0,
            ..base("Cinema", 4.0)
        },
        // Centre-screen and very large: hook text for the first seconds of
        // a short, where the subtitle *is* the composition.
        StyleTemplate {
            alignment: 5,
            size_pct: 8.5,
            outline: 5.0,
            shadow: 1.5,
            margin_v_pct: 0.0,
            ..base("Punch", 8.5)
        },
        // Almost no treatment: thin dark text for clean, bright, well-lit
        // footage where a heavy outline is just noise.
        StyleTemplate {
            primary: INK,
            outline_color: WHITE,
            bold: false,
            outline: 1.0,
            shadow: 0.5,
            ..base("Minimal", 4.0)
        },
        // Vertical-safe box: high enough to clear the caption and comment
        // UI of every short-form feed, boxed for busy backgrounds.
        StyleTemplate {
            size_pct: 6.0,
            margin_v_pct: 20.0,
            border_style: BorderStyle::OpaqueBox,
            back_color: SOFT_BOX,
            outline: 0.0,
            ..base("Reel Box", 6.0)
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{json::validate, presets};
    use subs_subtitle::Cue;

    #[test]
    fn ships_six_uniquely_named_advanced_presets() {
        let p = advanced_presets();
        assert_eq!(p.len(), 6);
        let mut names: Vec<&str> = p.iter().map(|s| s.name.as_str()).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), 6);
    }

    #[test]
    fn no_advanced_name_collides_with_a_free_preset() {
        // `preset_by_name` searches both packs, so a collision would make
        // one preset unreachable.
        for a in advanced_presets() {
            assert!(
                !presets().iter().any(|f| f.name == a.name),
                "{} exists in both packs",
                a.name
            );
        }
    }

    #[test]
    fn every_advanced_preset_is_valid() {
        for s in advanced_presets() {
            validate(&s).unwrap_or_else(|e| panic!("{}: {e}", s.name));
        }
    }

    #[test]
    fn every_advanced_preset_renders_a_parseable_ass_document() {
        let cues = vec![Cue {
            start: 0.0,
            end: 1.0,
            lines: vec!["Test".into()],
        }];
        for s in advanced_presets() {
            let out = crate::to_ass(&cues, &s, (1080, 1920));
            assert!(out.contains("[V4+ Styles]"), "{}", s.name);
            assert!(out.contains("Dialogue: 0,"), "{}", s.name);
        }
    }

    #[test]
    fn every_advanced_preset_uses_a_font_the_free_pack_already_relies_on() {
        // Nothing bundles fonts yet, so a preset naming a font the machine
        // lacks renders as a silent fontconfig substitution.
        let known: Vec<String> = presets().into_iter().map(|p| p.font).collect();
        for s in advanced_presets() {
            assert!(
                known.contains(&s.font),
                "{} introduces the unbundled font {:?}",
                s.name,
                s.font
            );
        }
    }

    #[test]
    fn a_boxed_preset_carries_a_visible_box_and_no_competing_outline() {
        for s in advanced_presets() {
            if s.border_style == BorderStyle::OpaqueBox {
                assert!(s.back_color.a > 0, "{}: invisible box", s.name);
                assert_eq!(s.outline, 0.0, "{}: outline fights the box", s.name);
            }
        }
    }
}
