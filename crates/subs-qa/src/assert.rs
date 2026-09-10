/// Accumulates assertion failures so one run reports every problem rather
/// than stopping at the first.
#[derive(Default)]
pub struct Report {
    pub failures: Vec<String>,
    pub checks: usize,
}

impl Report {
    pub fn exit_code(&self) -> i32 {
        i32::from(!self.failures.is_empty())
    }

    pub fn print(&self) {
        for f in &self.failures {
            eprintln!("FAIL: {f}");
        }
        if self.failures.is_empty() {
            println!("ok: {} checks passed", self.checks);
        } else {
            eprintln!("{} of {} checks failed", self.failures.len(), self.checks);
        }
    }
}

pub fn check_eq<T: std::fmt::Debug + PartialEq>(
    r: &mut Report,
    name: &str,
    actual: T,
    expected: T,
) {
    r.checks += 1;
    if actual != expected {
        r.failures
            .push(format!("{name}: got {actual:?}, expected {expected:?}"));
    }
}

pub fn check_near(r: &mut Report, name: &str, actual: f64, expected: f64, tol: f64) {
    r.checks += 1;
    if (actual - expected).abs() > tol {
        r.failures.push(format!(
            "{name}: got {actual}, expected {expected} (tolerance {tol})"
        ));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_within_tolerance_passes() {
        let mut r = Report::default();
        check_near(&mut r, "duration", 10.02, 10.0, 0.04);
        assert!(r.failures.is_empty());
    }

    #[test]
    fn duration_outside_tolerance_fails_with_both_values() {
        let mut r = Report::default();
        check_near(&mut r, "duration", 10.5, 10.0, 0.04);
        assert_eq!(r.failures.len(), 1);
        assert!(r.failures[0].contains("duration"));
        assert!(r.failures[0].contains("10.5"));
        assert!(r.failures[0].contains("10"));
    }

    #[test]
    fn equality_check_reports_the_mismatch() {
        let mut r = Report::default();
        check_eq(&mut r, "vcodec", "hevc", "h264");
        assert_eq!(r.failures.len(), 1);
        assert!(r.failures[0].contains("hevc"));
        assert!(r.failures[0].contains("h264"));
    }

    #[test]
    fn a_report_with_no_failures_exits_zero() {
        assert_eq!(Report::default().exit_code(), 0);
    }

    #[test]
    fn a_report_with_failures_exits_nonzero() {
        let mut r = Report::default();
        check_eq(&mut r, "x", "a", "b");
        assert_ne!(r.exit_code(), 0);
    }
}
