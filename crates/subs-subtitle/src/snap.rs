use crate::Cue;
use subs_media::Rational;

/// Consecutive cues need visible separation or they read as one block.
pub const MIN_GAP_FRAMES: u32 = 2;

/// Round a timestamp to the nearest frame boundary.
///
/// Cue edges falling mid-frame produce a one-frame flicker where the
/// subtitle appears or vanishes a frame early on some players.
pub fn snap_to_frame(t: f64, fps: Rational) -> f64 {
    let frame = (t * fps.as_f64()).round();
    frame * fps.frame_duration()
}

/// Ensure every adjacent pair is separated by at least `min_gap_frames`.
///
/// Only the earlier cue's end is pulled back, never the later cue's start,
/// so a cue is never delayed past the speech it transcribes. A cue is never
/// inverted: the end will not be pulled before its own start.
pub fn enforce_gaps(cues: &mut [Cue], fps: Rational, min_gap_frames: u32) {
    let gap = f64::from(min_gap_frames) * fps.frame_duration();
    for i in 0..cues.len().saturating_sub(1) {
        let next_start = cues[i + 1].start;
        if next_start - cues[i].end < gap {
            let pulled = snap_to_frame(next_start - gap, fps);
            cues[i].end = pulled.max(cues[i].start);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use subs_media::Rational;

    fn fps30() -> Rational {
        Rational { num: 30, den: 1 }
    }

    fn cue(start: f64, end: f64) -> Cue {
        Cue {
            start,
            end,
            lines: vec!["x".into()],
        }
    }

    #[test]
    fn snaps_to_the_nearest_frame_boundary() {
        // 1/30 = 0.0333...; 0.040 is nearer frame 1 than frame 2.
        assert!((snap_to_frame(0.040, fps30()) - 1.0 / 30.0).abs() < 1e-9);
        assert!((snap_to_frame(0.0, fps30()) - 0.0).abs() < 1e-9);
    }

    #[test]
    fn already_aligned_times_are_unchanged() {
        let t = 5.0 / 30.0;
        assert!((snap_to_frame(t, fps30()) - t).abs() < 1e-12);
    }

    #[test]
    fn snapping_is_exact_for_ntsc_rates() {
        let ntsc = Rational {
            num: 30000,
            den: 1001,
        };
        let one_frame = 1001.0 / 30000.0;
        assert!((snap_to_frame(one_frame, ntsc) - one_frame).abs() < 1e-9);
    }

    #[test]
    fn pulls_back_a_cue_end_that_crowds_the_next_start() {
        let mut cues = vec![cue(0.0, 1.0), cue(1.0, 2.0)];
        enforce_gaps(&mut cues, fps30(), 2);
        let gap = cues[1].start - cues[0].end;
        assert!(gap >= 2.0 / 30.0 - 1e-9, "gap was {gap}");
    }

    #[test]
    fn leaves_adequately_separated_cues_alone() {
        let mut cues = vec![cue(0.0, 1.0), cue(2.0, 3.0)];
        let before = cues.clone();
        enforce_gaps(&mut cues, fps30(), 2);
        assert_eq!(cues, before);
    }

    #[test]
    fn never_inverts_a_cue_while_closing_a_gap() {
        let mut cues = vec![cue(0.0, 0.02), cue(0.02, 1.0)];
        enforce_gaps(&mut cues, fps30(), 2);
        for c in &cues {
            assert!(c.end >= c.start, "cue inverted: {c:?}");
        }
    }
}
