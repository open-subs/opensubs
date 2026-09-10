/// One progress update parsed from ffmpeg's `-progress pipe:1` stream.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ProgressEvent {
    /// Output timestamp reached, in seconds.
    pub out_time_s: f64,
    /// True for the terminal `progress=end` marker.
    pub done: bool,
}

impl ProgressEvent {
    /// Completion percentage against a known total duration.
    pub fn percent_of(&self, total_s: f64) -> f64 {
        if total_s <= 0.0 {
            return 0.0;
        }
        (self.out_time_s / total_s * 100.0).clamp(0.0, 100.0)
    }
}

pub trait ProgressSink {
    fn on_progress(&mut self, event: &ProgressEvent);
}

/// A no-op sink, for tests and headless runs.
pub struct NullSink;

impl ProgressSink for NullSink {
    fn on_progress(&mut self, _event: &ProgressEvent) {}
}

/// Incremental parser for ffmpeg's `key=value` progress stream.
///
/// ffmpeg emits a block of keys then a `progress=` marker terminating it, so
/// values are accumulated and an event is emitted only at the marker.
#[derive(Default)]
pub struct ProgressParser {
    out_time_us: Option<u64>,
}

impl ProgressParser {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn feed_line(&mut self, line: &str) -> Option<ProgressEvent> {
        let (key, value) = line.trim().split_once('=')?;
        match key {
            "out_time_us" => {
                if let Ok(v) = value.parse() {
                    self.out_time_us = Some(v);
                }
                // A malformed value is ignored; the last known-good position stands,
                // so progress holds rather than jumping backwards to zero.
                None
            }
            "progress" => Some(ProgressEvent {
                out_time_s: self.out_time_us.unwrap_or(0) as f64 / 1_000_000.0,
                done: value == "end",
            }),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use crate::progress::ProgressParser;

    #[test]
    fn emits_an_event_at_each_progress_marker() {
        let mut p = ProgressParser::new();
        assert!(p.feed_line("frame=30").is_none());
        assert!(p.feed_line("out_time_us=1000000").is_none());
        let e = p.feed_line("progress=continue").unwrap();
        assert!((e.out_time_s - 1.0).abs() < 1e-9);
        assert!(!e.done);
    }

    #[test]
    fn marks_the_final_event_as_done() {
        let mut p = ProgressParser::new();
        p.feed_line("out_time_us=10000000");
        let e = p.feed_line("progress=end").unwrap();
        assert!((e.out_time_s - 10.0).abs() < 1e-9);
        assert!(e.done);
    }

    #[test]
    fn ignores_unrelated_and_malformed_lines() {
        let mut p = ProgressParser::new();
        assert!(p.feed_line("bitrate=N/A").is_none());
        assert!(p.feed_line("garbage without equals").is_none());
        assert!(p.feed_line("out_time_us=not_a_number").is_none());
    }

    #[test]
    fn a_percentage_can_be_derived_from_a_known_duration() {
        let mut p = ProgressParser::new();
        p.feed_line("out_time_us=5000000");
        let e = p.feed_line("progress=continue").unwrap();
        assert!((e.percent_of(10.0) - 50.0).abs() < 1e-6);
        // A zero or unknown duration must not divide by zero.
        assert_eq!(e.percent_of(0.0), 0.0);
    }

    #[test]
    fn malformed_values_do_not_discard_prior_state() {
        let mut p = ProgressParser::new();
        // Accumulate a good value.
        assert!(p.feed_line("out_time_us=5000000").is_none());
        // Feed a malformed value for the same key.
        assert!(p.feed_line("out_time_us=not_a_number").is_none());
        // The parser should still report the last known-good value, not jump back to zero.
        let e = p.feed_line("progress=continue").unwrap();
        assert!((e.out_time_s - 5.0).abs() < 1e-9);
    }
}
