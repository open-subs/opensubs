//! Export resolution.
//!
//! The competitor study's second conversion point is "free is capped at
//! 720p, pay to unlock HD". This inverts it: nothing is capped, and the
//! resolution becomes a control the user drives -- most usefully *downward*,
//! since a 4K source cut for a phone feed is a large upload for no visible
//! gain.
//!
//! The one rule that matters here is that subtitles are rendered *after*
//! any scale, at the final output size. Rendering first and scaling the
//! result resamples glyph edges twice and is exactly the soft, badly-scaled
//! subtitle look the design spec §3.4 blames on mismatched `PlayRes`.

/// What resolution to export at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum OutputSize {
    /// Leave the picture alone. The default, and the only option that adds
    /// no filter to the chain.
    #[default]
    Source,
    /// Fit to this height, preserving the source's aspect ratio.
    Height(u32),
    /// Exactly these dimensions, aspect ratio be damned.
    Exact(u32, u32),
}

impl OutputSize {
    /// Resolve against the source's *display* dimensions (rotation already
    /// applied) to the dimensions actually encoded.
    ///
    /// Both axes are rounded to even numbers because the output is
    /// `yuv420p`, whose chroma planes are half-resolution: an odd dimension
    /// makes libx264 fail outright rather than round for you.
    pub fn resolve(self, display: (u32, u32)) -> (u32, u32) {
        let (sw, sh) = display;
        match self {
            Self::Source => (even(sw), even(sh)),
            Self::Exact(w, h) => (even(w), even(h)),
            Self::Height(h) => {
                if sh == 0 {
                    return (even(sw), even(h));
                }
                let w = (sw as f64 * (h as f64 / sh as f64)).round() as u32;
                (even(w), even(h))
            }
        }
    }

    /// True when resolving would leave the picture untouched, so the caller
    /// can skip the filter entirely.
    pub fn is_noop(self, display: (u32, u32)) -> bool {
        matches!(self, Self::Source) || self.resolve(display) == (even(display.0), even(display.1))
    }
}

/// Round down to an even number, never below 2.
fn even(n: u32) -> u32 {
    if n < 2 {
        2
    } else {
        n - (n % 2)
    }
}

/// The scale filter for a resolved target.
///
/// Lanczos because this is the quality path; `bicubic` (ffmpeg's default)
/// is softer at exactly the edges subtitles are made of.
pub fn scale_filter(target: (u32, u32)) -> String {
    format!("scale={}:{}:flags=lanczos", target.0, target.1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn source_size_passes_the_display_dimensions_through() {
        assert_eq!(OutputSize::Source.resolve((1920, 1080)), (1920, 1080));
        assert!(OutputSize::Source.is_noop((1920, 1080)));
    }

    #[test]
    fn fitting_a_height_preserves_the_aspect_ratio() {
        assert_eq!(OutputSize::Height(720).resolve((1920, 1080)), (1280, 720));
        assert_eq!(OutputSize::Height(1080).resolve((1080, 1920)), (608, 1080));
    }

    #[test]
    fn both_axes_come_out_even_for_yuv420p() {
        // 1080x2340 is a real phone aspect; the fitted width lands odd.
        let (w, h) = OutputSize::Height(720).resolve((1080, 2340));
        assert_eq!(w % 2, 0, "width {w} is odd");
        assert_eq!(h % 2, 0, "height {h} is odd");
        // An odd source dimension must not survive either.
        assert_eq!(OutputSize::Source.resolve((1921, 1081)), (1920, 1080));
    }

    #[test]
    fn exact_size_ignores_the_aspect_ratio_on_purpose() {
        assert_eq!(
            OutputSize::Exact(1080, 1080).resolve((1920, 1080)),
            (1080, 1080)
        );
    }

    #[test]
    fn a_target_equal_to_the_source_is_recognised_as_a_noop() {
        assert!(OutputSize::Height(1080).is_noop((1920, 1080)));
        assert!(!OutputSize::Height(720).is_noop((1920, 1080)));
    }

    #[test]
    fn a_zero_height_source_does_not_divide_by_zero() {
        assert_eq!(OutputSize::Height(720).resolve((1920, 0)), (1920, 720));
    }

    #[test]
    fn never_scales_below_two_pixels() {
        assert_eq!(OutputSize::Exact(1, 1).resolve((1920, 1080)), (2, 2));
    }

    #[test]
    fn the_filter_names_lanczos_and_the_resolved_size() {
        assert_eq!(scale_filter((1280, 720)), "scale=1280:720:flags=lanczos");
    }
}
