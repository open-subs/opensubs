/// An exact rational number, used for frame rates.
///
/// Frame rates must not round-trip through `f64`: 29.97 is exactly
/// `30000/1001`, and accumulated error shows up as drift when snapping cue
/// boundaries to frames over a long video.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rational {
    pub num: u32,
    pub den: u32,
}

impl Rational {
    /// Parse ffprobe's `"num/den"` form. Returns `None` for a zero
    /// denominator, which ffprobe emits for streams with no frame rate.
    pub fn parse(s: &str) -> Option<Self> {
        let (n, d) = s.split_once('/')?;
        let num: u32 = n.parse().ok()?;
        let den: u32 = d.parse().ok()?;
        if den == 0 {
            return None;
        }
        Some(Self { num, den })
    }

    pub fn as_f64(&self) -> f64 {
        f64::from(self.num) / f64::from(self.den)
    }

    /// Seconds per frame.
    pub fn frame_duration(&self) -> f64 {
        f64::from(self.den) / f64::from(self.num)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_integer_frame_rate() {
        let r = Rational::parse("30/1").unwrap();
        assert_eq!((r.num, r.den), (30, 1));
        assert_eq!(r.as_f64(), 30.0);
    }

    #[test]
    fn parses_ntsc_frame_rate_exactly() {
        let r = Rational::parse("30000/1001").unwrap();
        assert_eq!((r.num, r.den), (30000, 1001));
        assert!((r.as_f64() - 29.970_029_97).abs() < 1e-9);
    }

    #[test]
    fn frame_duration_is_reciprocal() {
        let r = Rational::parse("30000/1001").unwrap();
        assert!((r.frame_duration() - 1001.0 / 30000.0).abs() < 1e-12);
    }

    #[test]
    fn rejects_zero_denominator_and_garbage() {
        assert!(Rational::parse("30/0").is_none());
        assert!(Rational::parse("0/0").is_none());
        assert!(Rational::parse("").is_none());
        assert!(Rational::parse("30").is_none());
        assert!(Rational::parse("a/b").is_none());
    }
}
