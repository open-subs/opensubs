//! Style templates and ASS document generation. Performs no I/O.

pub mod advanced;
pub mod ass;
pub mod color;
pub mod json;
pub mod presets;
pub mod template;

pub use advanced::advanced_presets;
pub use ass::{merge_bilingual, to_ass, EffectOn};
pub use color::Rgba;
pub use json::{from_json_str, to_json_string, StyleError};
pub use presets::{preset_by_name, presets};
pub use template::{BorderStyle, StyleTemplate};

/// Which pack a preset belongs to.
///
/// Both packs ship unlocked; the split exists so the tiering stays visible
/// (see `subs-tier`) and so the UI can group them.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Pack {
    /// The six free looks.
    Core,
    /// The six advanced looks.
    Advanced,
}

impl Pack {
    pub fn label(self) -> &'static str {
        match self {
            Self::Core => "Core",
            Self::Advanced => "Advanced",
        }
    }
}

/// Every shipped preset, core pack first.
pub fn all_presets() -> Vec<StyleTemplate> {
    let mut all = presets();
    all.extend(advanced_presets());
    all
}

/// Which pack a preset name belongs to, or `None` if no preset has it.
pub fn pack_of(name: &str) -> Option<Pack> {
    if presets().iter().any(|p| p.name == name) {
        Some(Pack::Core)
    } else if advanced_presets().iter().any(|p| p.name == name) {
        Some(Pack::Advanced)
    } else {
        None
    }
}
