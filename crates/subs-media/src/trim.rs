//! Clip selection -- the 裁剪切片 half of the product's stated scenario.
//!
//! A `TrimRange` names a span of the *source* timeline. Everything
//! downstream works on the trimmed clip's own timeline, which starts at
//! zero: the ASR audio is extracted from the same span, so transcript
//! timestamps are already clip-relative and need no further correction.
//! That equivalence is the whole reason trimming lives here, next to the
//! argv builders, rather than as a post-processing step on cue times --
//! shifting cues after the fact is how subtitle tools drift out of sync.

use std::fmt;

/// A span of the source timeline, in seconds. `end: None` means "to the
/// end of the source".
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TrimRange {
    pub start: f64,
    pub end: Option<f64>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrimError {
    /// A negative or non-finite start.
    BadStart,
    /// An end at or before the start, or non-finite.
    EndBeforeStart,
    /// The range begins at or after the end of the source media.
    StartsPastEnd,
}

impl fmt::Display for TrimError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BadStart => write!(f, "trim start must be zero or a positive number of seconds"),
            Self::EndBeforeStart => write!(f, "trim end must be later than the trim start"),
            Self::StartsPastEnd => write!(f, "trim start is at or past the end of the video"),
        }
    }
}

impl std::error::Error for TrimError {}

impl Default for TrimRange {
    fn default() -> Self {
        Self::FULL
    }
}

impl TrimRange {
    /// The whole source, untrimmed.
    pub const FULL: Self = Self {
        start: 0.0,
        end: None,
    };

    pub fn new(start: f64, end: Option<f64>) -> Self {
        Self { start, end }
    }

    /// From a start and a wanted length, which is how a "cut me 30 seconds
    /// from here" request usually arrives.
    pub fn from_duration(start: f64, duration: f64) -> Self {
        Self {
            start,
            end: Some(start + duration),
        }
    }

    /// True when this range asks for nothing to be cut. The argv builders
    /// emit no seek flags at all in that case, so an untrimmed export is
    /// byte-for-byte the command it was before trimming existed.
    pub fn is_full(&self) -> bool {
        self.start <= 0.0 && self.end.is_none()
    }

    /// Reject a range that cannot produce a clip, before any ffmpeg runs.
    ///
    /// `source_duration` of zero or less is treated as unknown and skips
    /// only the past-the-end check -- `ffprobe` reports no duration for
    /// some streams, and a missing probe value must not block a trim the
    /// user can see is valid.
    pub fn validate(&self, source_duration: f64) -> Result<(), TrimError> {
        if !self.start.is_finite() || self.start < 0.0 {
            return Err(TrimError::BadStart);
        }
        if let Some(end) = self.end {
            if !end.is_finite() || end <= self.start {
                return Err(TrimError::EndBeforeStart);
            }
        }
        if source_duration > 0.0 && self.start >= source_duration {
            return Err(TrimError::StartsPastEnd);
        }
        Ok(())
    }

    /// How long the resulting clip is, given the source's own duration.
    ///
    /// Used for progress reporting, which would otherwise show a 30-second
    /// clip cut from an hour-long source creeping to 1%.
    pub fn clip_duration(&self, source_duration: f64) -> f64 {
        let end = match (self.end, source_duration > 0.0) {
            (Some(e), true) => e.min(source_duration),
            (Some(e), false) => e,
            (None, true) => source_duration,
            // Nothing known bounds it; callers use this only for progress.
            (None, false) => return 0.0,
        };
        (end - self.start).max(0.0)
    }

    /// The seek flags, which must be placed **after** `-i`.
    ///
    /// # Why output-side seek, despite the cost
    ///
    /// The fast idiom is `-ss` *before* `-i`: ffmpeg jumps to the nearest
    /// keyframe instead of decoding the skipped span. It is wrong here, and
    /// the reason was found by running it rather than by reading about it.
    ///
    /// With an input seek, the frames entering a `-filter_complex` graph
    /// keep their **source** timestamps, while a stream-copied audio track
    /// is rebased to zero. Cutting a clip from 4s therefore produced video
    /// whose PTS began at 4.046 against audio beginning at 0 -- four
    /// seconds of A/V desync -- and a container whose duration was the
    /// union of the two, 10s for a 6s clip. Worse for this product
    /// specifically: the `ass` filter matches cue times against frame PTS,
    /// so every subtitle in the clip was addressed to a timestamp that
    /// never arrived.
    ///
    /// Neither obvious repair works. `setpts=PTS-STARTPTS` does not rebase
    /// the muxed result, and `-copyts -start_at_zero` truncated the video
    /// to 2s of a 6s request. An output-side seek produces exactly the
    /// right thing on the first try: video from 0, audio from 0, container
    /// duration equal to the clip.
    ///
    /// The cost is real and worth stating: ffmpeg decodes and discards
    /// everything before the start point, so cutting from deep inside a
    /// long recording spends time proportional to the *offset*, not to the
    /// clip. That is the price of a clip that is actually in sync, and it
    /// is the right way round -- the alternative is fast and broken.
    ///
    /// `-t` (a duration) rather than `-to` (an endpoint), because the seek
    /// rebases the output clock to zero.
    pub fn seek_args(&self) -> Vec<String> {
        let mut a = Vec::new();
        if self.start > 0.0 {
            a.push("-ss".into());
            a.push(format_seconds(self.start));
        }
        if let Some(end) = self.end {
            let d = end - self.start;
            if d > 0.0 {
                a.push("-t".into());
                a.push(format_seconds(d));
            }
        }
        a
    }
}

/// Seconds with millisecond resolution and no exponent, which is the only
/// form ffmpeg's time parser accepts for every magnitude. `{}` on an f64
/// would emit `1e-7` for a tiny value and a 17-digit tail for many others.
fn format_seconds(t: f64) -> String {
    format!("{t:.3}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_full_range_emits_no_flags_at_all() {
        let t = TrimRange::FULL;
        assert!(t.is_full());
        assert!(t.seek_args().is_empty());
    }

    #[test]
    fn a_start_only_trim_seeks_but_sets_no_duration() {
        assert_eq!(TrimRange::new(3.5, None).seek_args(), vec!["-ss", "3.500"]);
    }

    #[test]
    fn an_end_becomes_a_duration_because_the_seek_restarts_the_clock() {
        assert_eq!(
            TrimRange::new(10.0, Some(14.0)).seek_args(),
            vec!["-ss", "10.000", "-t", "4.000"]
        );
    }

    #[test]
    fn a_trim_starting_at_zero_still_caps_the_duration() {
        assert_eq!(
            TrimRange::new(0.0, Some(5.0)).seek_args(),
            vec!["-t", "5.000"]
        );
    }

    #[test]
    fn from_duration_is_the_same_range_as_the_equivalent_endpoint() {
        assert_eq!(
            TrimRange::from_duration(2.0, 5.0),
            TrimRange::new(2.0, Some(7.0))
        );
    }

    #[test]
    fn seconds_never_reach_ffmpeg_in_exponent_form() {
        assert_eq!(format_seconds(0.0000001), "0.000");
        assert_eq!(format_seconds(1.0 / 3.0), "0.333");
        assert_eq!(format_seconds(3661.5), "3661.500");
    }

    #[test]
    fn clip_duration_prefers_the_explicit_end_but_never_exceeds_the_source() {
        assert_eq!(TrimRange::new(1.0, Some(4.0)).clip_duration(60.0), 3.0);
        assert_eq!(TrimRange::new(1.0, None).clip_duration(10.0), 9.0);
        // An end past the source is clamped, not trusted.
        assert_eq!(TrimRange::new(0.0, Some(99.0)).clip_duration(10.0), 10.0);
    }

    #[test]
    fn clip_duration_is_zero_when_nothing_bounds_the_range() {
        assert_eq!(TrimRange::FULL.clip_duration(0.0), 0.0);
    }

    #[test]
    fn validation_rejects_the_ranges_that_cannot_produce_a_clip() {
        assert_eq!(
            TrimRange::new(-1.0, None).validate(10.0),
            Err(TrimError::BadStart)
        );
        assert_eq!(
            TrimRange::new(f64::NAN, None).validate(10.0),
            Err(TrimError::BadStart)
        );
        assert_eq!(
            TrimRange::new(5.0, Some(5.0)).validate(10.0),
            Err(TrimError::EndBeforeStart)
        );
        assert_eq!(
            TrimRange::new(5.0, Some(2.0)).validate(10.0),
            Err(TrimError::EndBeforeStart)
        );
        assert_eq!(
            TrimRange::new(12.0, None).validate(10.0),
            Err(TrimError::StartsPastEnd)
        );
        assert_eq!(TrimRange::new(1.0, Some(9.0)).validate(10.0), Ok(()));
    }

    #[test]
    fn an_unknown_source_duration_does_not_block_a_valid_trim() {
        // ffprobe reports no duration for some streams; that must not
        // reject a trim the user can plainly see is inside the clip.
        assert_eq!(TrimRange::new(12.0, Some(20.0)).validate(0.0), Ok(()));
    }
}
