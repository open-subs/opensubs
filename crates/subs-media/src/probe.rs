use std::path::Path;

/// ffprobe arguments producing the JSON `MediaInfo::from_ffprobe_json` parses.
pub fn probe_args(input: &Path) -> Vec<String> {
    vec![
        "-v".into(),
        "error".into(),
        "-print_format".into(),
        "json".into(),
        "-show_format".into(),
        "-show_streams".into(),
        "-show_entries".into(),
        "stream_side_data=rotation".into(),
        input.to_string_lossy().into_owned(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn probe_requests_json_streams_format_and_rotation() {
        let a = probe_args(Path::new("in.mp4"));
        assert!(a.contains(&"-print_format".to_string()));
        assert!(a.contains(&"json".to_string()));
        assert!(a.contains(&"-show_streams".to_string()));
        assert!(a.contains(&"-show_format".to_string()));
        // Rotation lives in stream side data; without this the display
        // matrix is invisible and rotated video renders sideways.
        assert!(a.contains(&"stream_side_data=rotation".to_string()));
        assert_eq!(a.last().unwrap(), "in.mp4");
    }
}
