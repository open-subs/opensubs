use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub struct Rgba {
    pub r: u8,
    pub g: u8,
    pub b: u8,
    pub a: u8,
}

impl Rgba {
    /// Render as an ASS colour literal: `&HAABBGGRR`.
    ///
    /// Two traps, both silent if got wrong:
    /// - channels are **BGR**, not RGB
    /// - alpha is **inverted**: `00` is fully opaque, `FF` fully transparent
    pub fn to_ass(&self) -> String {
        format!(
            "&H{:02X}{:02X}{:02X}{:02X}",
            255 - self.a,
            self.b,
            self.g,
            self.r
        )
    }

    /// Parse `#RRGGBB`, `RRGGBB`, `#RRGGBBAA` or `RRGGBBAA`.
    pub fn from_hex(s: &str) -> Option<Self> {
        let h = s.strip_prefix('#').unwrap_or(s);
        if !h.is_ascii() || (h.len() != 6 && h.len() != 8) {
            return None;
        }
        let byte = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
        Some(Self {
            r: byte(0)?,
            g: byte(2)?,
            b: byte(4)?,
            a: if h.len() == 8 { byte(6)? } else { 255 },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_white_is_all_zeros_then_ffffff() {
        let c = Rgba {
            r: 255,
            g: 255,
            b: 255,
            a: 255,
        };
        assert_eq!(c.to_ass(), "&H00FFFFFF");
    }

    #[test]
    fn channel_order_is_bgr_not_rgb() {
        // Pure red: R=FF must land in the LAST byte pair.
        let red = Rgba {
            r: 255,
            g: 0,
            b: 0,
            a: 255,
        };
        assert_eq!(red.to_ass(), "&H000000FF");
        // Pure blue: B=FF must land in the FIRST colour byte pair.
        let blue = Rgba {
            r: 0,
            g: 0,
            b: 255,
            a: 255,
        };
        assert_eq!(blue.to_ass(), "&H00FF0000");
    }

    #[test]
    fn alpha_is_inverted_relative_to_every_other_format() {
        // Fully transparent in ASS is FF, not 00.
        let clear = Rgba {
            r: 0,
            g: 0,
            b: 0,
            a: 0,
        };
        assert_eq!(clear.to_ass(), "&HFF000000");
        // Half transparent.
        let half = Rgba {
            r: 0,
            g: 0,
            b: 0,
            a: 128,
        };
        assert_eq!(half.to_ass(), "&H7F000000");
    }

    #[test]
    fn parses_css_style_hex() {
        assert_eq!(
            Rgba::from_hex("#FF8800"),
            Some(Rgba {
                r: 255,
                g: 136,
                b: 0,
                a: 255
            })
        );
        assert_eq!(
            Rgba::from_hex("FF8800"),
            Some(Rgba {
                r: 255,
                g: 136,
                b: 0,
                a: 255
            })
        );
        assert_eq!(
            Rgba::from_hex("#FF880080"),
            Some(Rgba {
                r: 255,
                g: 136,
                b: 0,
                a: 128
            })
        );
    }

    #[test]
    fn rejects_malformed_hex() {
        assert_eq!(Rgba::from_hex("#FFF"), None);
        assert_eq!(Rgba::from_hex("nope"), None);
        assert_eq!(Rgba::from_hex(""), None);
    }

    #[test]
    fn rejects_utf8_multibyte_characters_and_does_not_panic() {
        // Six-byte string: a + € (3 bytes) + a + a.
        // Panicked under old code at &h[0..2] which splits the euro sign at byte 1.
        assert_eq!(Rgba::from_hex("a€aa"), None);

        // Eight-byte string: ff88 + a + € (3 bytes).
        // Panicked under old code at &h[6..8] which splits the euro sign at byte 6.
        // This exercises a different slice offset than the 6-byte case.
        assert_eq!(Rgba::from_hex("ff88a€"), None);

        // Eight-byte string: ff88aa + é (2 bytes).
        // No slice boundary violation (é occupies bytes 6–7 exactly), so old code
        // returned None gracefully. New code still returns None via ASCII guard.
        // Documents that not every multi-byte string was a panic risk.
        assert_eq!(Rgba::from_hex("ff88aaé"), None);

        // Valid ASCII parse still works
        assert_eq!(
            Rgba::from_hex("#FF8800"),
            Some(Rgba {
                r: 255,
                g: 136,
                b: 0,
                a: 255
            })
        );
    }
}
