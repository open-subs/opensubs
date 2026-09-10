use serde::{Deserialize, Serialize};

/// One displayed subtitle: at most two lines, shown between `start` and `end`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub lines: Vec<String>,
}

impl Cue {
    pub fn duration(&self) -> f64 {
        self.end - self.start
    }

    /// Lines rejoined with spaces, for reading-speed measurement.
    pub fn text(&self) -> String {
        self.lines.join(" ")
    }

    pub fn char_count(&self) -> usize {
        self.text().chars().count()
    }

    /// The same cue, moved by `seconds` along the timeline.
    ///
    /// Exact rather than approximate: a constant offset applied to both
    /// ends, changing nothing about the cue's duration or its relationship
    /// to any other cue. Used to put cue times back on the *source*
    /// timeline for a trimmed burn -- see `subs_pipeline::plan_job`.
    pub fn shifted(&self, seconds: f64) -> Self {
        Self {
            start: self.start + seconds,
            end: self.end + seconds,
            lines: self.lines.clone(),
        }
    }

    /// Characters per second. Infinite for a zero-length cue, which the
    /// segmenter must then reject rather than emit.
    pub fn cps(&self) -> f64 {
        let d = self.duration();
        if d <= 0.0 {
            f64::INFINITY
        } else {
            self.char_count() as f64 / d
        }
    }
}

/// Split a timestamp into (hours, minutes, seconds, fractional units),
/// quantising to `units_per_sec` FIRST so a rounded-up fraction carries
/// into the seconds instead of overflowing its field.
fn split(t: f64, units_per_sec: u64) -> (u64, u64, u64, u64) {
    let total_units = (t.max(0.0) * units_per_sec as f64).round() as u64;
    let secs = total_units / units_per_sec;
    (
        secs / 3600,
        (secs % 3600) / 60,
        secs % 60,
        total_units % units_per_sec,
    )
}

/// `HH:MM:SS,mmm`
pub fn fmt_srt(t: f64) -> String {
    let (h, m, s, ms) = split(t, 1000);
    format!("{h:02}:{m:02}:{s:02},{ms:03}")
}

/// `HH:MM:SS.mmm`
pub fn fmt_vtt(t: f64) -> String {
    let (h, m, s, ms) = split(t, 1000);
    format!("{h:02}:{m:02}:{s:02}.{ms:03}")
}

/// `H:MM:SS.cc` — ASS uses a single-digit hour and centiseconds.
pub fn fmt_ass(t: f64) -> String {
    let (h, m, s, cs) = split(t, 100);
    format!("{h}:{m:02}:{s:02}.{cs:02}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn srt_timecode_uses_comma_and_milliseconds() {
        assert_eq!(fmt_srt(0.0), "00:00:00,000");
        assert_eq!(fmt_srt(1.5), "00:00:01,500");
        assert_eq!(fmt_srt(3661.234), "01:01:01,234");
    }

    #[test]
    fn vtt_timecode_uses_a_period() {
        assert_eq!(fmt_vtt(1.5), "00:00:01.500");
        assert_eq!(fmt_vtt(3661.234), "01:01:01.234");
    }

    #[test]
    fn ass_timecode_uses_single_digit_hour_and_centiseconds() {
        assert_eq!(fmt_ass(0.0), "0:00:00.00");
        assert_eq!(fmt_ass(1.5), "0:00:01.50");
        assert_eq!(fmt_ass(3661.234), "1:01:01.23");
    }

    #[test]
    fn cue_reports_duration_text_and_reading_speed() {
        let c = Cue {
            start: 1.0,
            end: 3.0,
            lines: vec!["Hello".into(), "world".into()],
        };
        assert!((c.duration() - 2.0).abs() < 1e-9);
        assert_eq!(c.text(), "Hello world");
        assert_eq!(c.char_count(), 11);
        assert!((c.cps() - 5.5).abs() < 1e-9);
    }

    #[test]
    fn zero_duration_cue_reports_infinite_cps_rather_than_dividing_by_zero() {
        let c = Cue {
            start: 1.0,
            end: 1.0,
            lines: vec!["x".into()],
        };
        assert!(c.cps().is_infinite());
    }

    #[test]
    fn srt_carry_millisecond_into_seconds() {
        // Rounding 999.5 ms to the nearest millisecond should produce
        // a whole second (1000 ms carries to +1s).
        assert_eq!(fmt_srt(0.9999), "00:00:01,000");
        assert_eq!(fmt_srt(1.9996), "00:00:02,000");
    }

    #[test]
    fn srt_carry_seconds_into_minutes() {
        assert_eq!(fmt_srt(59.9996), "00:01:00,000");
    }

    #[test]
    fn srt_carry_minutes_into_hours() {
        assert_eq!(fmt_srt(3599.9999), "01:00:00,000");
    }

    #[test]
    fn vtt_carry_millisecond_into_seconds() {
        assert_eq!(fmt_vtt(0.9999), "00:00:01.000");
    }

    #[test]
    fn ass_carry_centisecond_into_seconds() {
        // Rounding 99.5 cs to the nearest centisecond produces a whole second.
        assert_eq!(fmt_ass(0.9999), "0:00:01.00");
    }

    #[test]
    fn shifting_moves_both_ends_and_keeps_the_duration() {
        let c = Cue {
            start: 1.5,
            end: 3.25,
            lines: vec!["text".into()],
        };
        let moved = c.shifted(4.0);
        assert_eq!(moved.start, 5.5);
        assert_eq!(moved.end, 7.25);
        assert_eq!(moved.duration(), c.duration());
        assert_eq!(moved.lines, c.lines);
    }

    #[test]
    fn shifting_by_zero_changes_nothing() {
        let c = Cue {
            start: 1.0,
            end: 2.0,
            lines: vec!["a".into(), "b".into()],
        };
        assert_eq!(c.shifted(0.0), c);
    }
}
