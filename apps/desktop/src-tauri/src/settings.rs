//! Tiny on-disk settings: today this holds exactly one field, the last
//! whisper model path the user picked, so it does not need to be re-chosen
//! every launch. Deliberately hand-rolled JSON on disk rather than a
//! plugin -- one field does not justify a dependency.

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
pub struct DesktopSettings {
    pub model_path: Option<String>,
}

/// Load settings from `path`, falling back to defaults when the file is
/// missing or unparseable. A corrupt settings file must never block the app
/// from starting.
pub fn load(path: &Path) -> DesktopSettings {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

pub fn save(path: &Path, settings: &DesktopSettings) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(settings)
        .expect("DesktopSettings serialization is infallible");
    std::fs::write(path, json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn load_returns_default_when_file_is_missing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("does-not-exist.json");
        assert_eq!(load(&path), DesktopSettings::default());
    }

    #[test]
    fn load_returns_default_when_file_is_malformed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, "not json at all").unwrap();
        assert_eq!(load(&path), DesktopSettings::default());
    }

    #[test]
    fn save_then_load_round_trips_the_model_path() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("nested").join("settings.json");
        let settings = DesktopSettings {
            model_path: Some("/models/ggml-tiny.en.bin".to_string()),
        };
        save(&path, &settings).unwrap();
        assert_eq!(load(&path), settings);
    }

    #[test]
    fn save_creates_missing_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir
            .path()
            .join("a")
            .join("b")
            .join("c")
            .join("settings.json");
        save(&path, &DesktopSettings::default()).unwrap();
        assert!(path.exists());
    }
}
