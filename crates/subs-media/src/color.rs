use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HdrKind {
    /// SMPTE ST 2084 (PQ) — HDR10, Dolby Vision base layer.
    Pq,
    /// ARIB STD-B67 (Hybrid Log-Gamma) — what iPhones record.
    Hlg,
}

/// Colour metadata as reported by ffprobe. All fields are optional because
/// ffprobe omits them for untagged streams, which is itself meaningful.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct ColorMeta {
    pub space: Option<String>,
    pub primaries: Option<String>,
    pub transfer: Option<String>,
    pub range: Option<String>,
}

impl ColorMeta {
    pub fn hdr_kind(&self) -> Option<HdrKind> {
        match self.transfer.as_deref() {
            Some("smpte2084") => Some(HdrKind::Pq),
            Some("arib-std-b67") => Some(HdrKind::Hlg),
            _ => None,
        }
    }

    pub fn is_hdr(&self) -> bool {
        self.hdr_kind().is_some()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn meta(transfer: Option<&str>) -> ColorMeta {
        ColorMeta {
            space: Some("bt709".into()),
            primaries: Some("bt709".into()),
            transfer: transfer.map(str::to_string),
            range: Some("tv".into()),
        }
    }

    #[test]
    fn sdr_bt709_is_not_hdr() {
        assert!(!meta(Some("bt709")).is_hdr());
        assert_eq!(meta(Some("bt709")).hdr_kind(), None);
    }

    #[test]
    fn pq_is_hdr() {
        assert!(meta(Some("smpte2084")).is_hdr());
        assert_eq!(meta(Some("smpte2084")).hdr_kind(), Some(HdrKind::Pq));
    }

    #[test]
    fn hlg_is_hdr() {
        assert!(meta(Some("arib-std-b67")).is_hdr());
        assert_eq!(meta(Some("arib-std-b67")).hdr_kind(), Some(HdrKind::Hlg));
    }

    #[test]
    fn missing_transfer_is_treated_as_sdr() {
        assert!(!meta(None).is_hdr());
    }
}
