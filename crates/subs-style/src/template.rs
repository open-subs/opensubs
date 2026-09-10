use crate::Rgba;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum BorderStyle {
    /// Outline plus drop shadow. ASS value 1.
    OutlineShadow,
    /// Opaque box behind the text. ASS value 3.
    OpaqueBox,
}

impl BorderStyle {
    pub fn ass_value(self) -> u8 {
        match self {
            Self::OutlineShadow => 1,
            Self::OpaqueBox => 3,
        }
    }
}

/// A named subtitle look.
///
/// Sizes and margins are percentages of video height, not absolute pixels,
/// so one template renders correctly at every resolution.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StyleTemplate {
    pub name: String,
    pub font: String,
    /// Font size as a percentage of video height.
    pub size_pct: f64,
    pub primary: Rgba,
    pub outline_color: Rgba,
    pub back_color: Rgba,
    pub bold: bool,
    pub italic: bool,
    pub border_style: BorderStyle,
    pub outline: f64,
    pub shadow: f64,
    /// Numpad alignment: 2 = bottom centre, 5 = middle centre, 8 = top centre.
    pub alignment: u8,
    /// Vertical margin as a percentage of video height.
    pub margin_v_pct: f64,
}
