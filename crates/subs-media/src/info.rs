use crate::{ColorMeta, Rational};
use serde::Deserialize;

#[derive(Debug, thiserror::Error)]
pub enum MediaError {
    #[error("ffprobe output was not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no video stream found")]
    NoVideoStream,
    #[error("video stream has no usable frame rate")]
    NoFrameRate,
    #[error("video stream is missing width or height")]
    MalformedVideoStream,
}

#[derive(Deserialize)]
struct ProbeRoot {
    streams: Vec<ProbeStream>,
    format: ProbeFormat,
}

#[derive(Deserialize)]
struct ProbeFormat {
    duration: Option<String>,
    #[serde(default)]
    start_time: Option<String>,
}

#[derive(Deserialize)]
struct ProbeStream {
    codec_type: String,
    codec_name: Option<String>,
    width: Option<u32>,
    height: Option<u32>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    pix_fmt: Option<String>,
    color_space: Option<String>,
    color_primaries: Option<String>,
    color_transfer: Option<String>,
    color_range: Option<String>,
    #[serde(default)]
    side_data_list: Vec<SideData>,
}

#[derive(Deserialize)]
struct SideData {
    #[serde(default)]
    rotation: Option<f64>,
}

/// Everything downstream quality decisions depend on.
#[derive(Debug, Clone)]
pub struct MediaInfo {
    /// Stored width, before rotation is applied.
    pub width: u32,
    /// Stored height, before rotation is applied.
    pub height: u32,
    pub fps: Rational,
    pub duration: f64,
    pub pix_fmt: String,
    pub video_codec: Option<String>,
    pub color: ColorMeta,
    /// Normalised clockwise display rotation: 0, 90, 180 or 270.
    pub rotation: u32,
    pub has_audio: bool,
    pub audio_codec: Option<String>,
    pub start_time: f64,
}

impl MediaInfo {
    pub fn from_ffprobe_json(json: &str) -> Result<Self, MediaError> {
        let root: ProbeRoot = serde_json::from_str(json)?;

        let video = root
            .streams
            .iter()
            .find(|s| s.codec_type == "video")
            .ok_or(MediaError::NoVideoStream)?;

        let audio = root.streams.iter().find(|s| s.codec_type == "audio");

        let fps = video
            .r_frame_rate
            .as_deref()
            .and_then(Rational::parse)
            .or_else(|| video.avg_frame_rate.as_deref().and_then(Rational::parse))
            .ok_or(MediaError::NoFrameRate)?;

        // ffprobe reports a -90 display matrix for video that must be rotated
        // 90 degrees clockwise for display. rem_euclid on the raw (signed)
        // value wraps negatives into [0, 360): -90 -> 270.
        let rotation = video
            .side_data_list
            .iter()
            .find_map(|sd| sd.rotation)
            .map(|deg| (deg as i64).rem_euclid(360) as u32)
            .unwrap_or(0);

        Ok(Self {
            width: video.width.ok_or(MediaError::MalformedVideoStream)?,
            height: video.height.ok_or(MediaError::MalformedVideoStream)?,
            fps,
            duration: root
                .format
                .duration
                .as_deref()
                .and_then(|d| d.parse().ok())
                .unwrap_or(0.0),
            pix_fmt: video.pix_fmt.clone().unwrap_or_default(),
            video_codec: video.codec_name.clone(),
            color: ColorMeta {
                space: video.color_space.clone(),
                primaries: video.color_primaries.clone(),
                transfer: video.color_transfer.clone(),
                range: video.color_range.clone(),
            },
            rotation,
            has_audio: audio.is_some(),
            audio_codec: audio.and_then(|a| a.codec_name.clone()),
            start_time: root
                .format
                .start_time
                .as_deref()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0.0),
        })
    }

    /// Dimensions as the viewer sees them, with rotation applied.
    ///
    /// **Always use this for ASS `PlayResX`/`PlayResY`.** Using the stored
    /// dimensions on rotated phone footage renders subtitles sideways.
    pub fn display_dimensions(&self) -> (u32, u32) {
        match self.rotation {
            90 | 270 => (self.height, self.width),
            _ => (self.width, self.height),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const LANDSCAPE_720P30: &str = r#"{
      "streams": [
        {"index":0,"codec_type":"video","codec_name":"h264","width":1280,"height":720,
         "r_frame_rate":"30/1","avg_frame_rate":"30/1","pix_fmt":"yuv420p",
         "color_space":"bt709","color_primaries":"bt709","color_transfer":"bt709",
         "color_range":"tv","start_time":"0.000000"},
        {"index":1,"codec_type":"audio","codec_name":"aac","start_time":"0.000000"}
      ],
      "format": {"duration":"10.000000","start_time":"0.000000"}
    }"#;

    const PORTRAIT_ROTATED: &str = r#"{
      "streams": [
        {"index":0,"codec_type":"video","codec_name":"h264","width":1920,"height":1080,
         "r_frame_rate":"30000/1001","avg_frame_rate":"30000/1001","pix_fmt":"yuv420p",
         "color_transfer":"arib-std-b67","start_time":"0.000000",
         "side_data_list":[{"side_data_type":"Display Matrix","rotation":-90}]}
      ],
      "format": {"duration":"5.500000","start_time":"0.000000"}
    }"#;

    #[test]
    fn parses_landscape_video() {
        let info = MediaInfo::from_ffprobe_json(LANDSCAPE_720P30).unwrap();
        assert_eq!((info.width, info.height), (1280, 720));
        assert_eq!(info.fps, Rational { num: 30, den: 1 });
        assert_eq!(info.duration, 10.0);
        assert_eq!(info.pix_fmt, "yuv420p");
        assert_eq!(info.video_codec.as_deref(), Some("h264"));
        assert_eq!(info.rotation, 0);
        assert!(info.has_audio);
        assert_eq!(info.audio_codec.as_deref(), Some("aac"));
        assert!(!info.color.is_hdr());
    }

    #[test]
    fn unrotated_display_dimensions_match_storage() {
        let info = MediaInfo::from_ffprobe_json(LANDSCAPE_720P30).unwrap();
        assert_eq!(info.display_dimensions(), (1280, 720));
    }

    #[test]
    fn rotation_is_normalised_to_positive_degrees() {
        let info = MediaInfo::from_ffprobe_json(PORTRAIT_ROTATED).unwrap();
        assert_eq!(info.rotation, 270);
    }

    #[test]
    fn rotated_video_reports_transposed_display_dimensions() {
        let info = MediaInfo::from_ffprobe_json(PORTRAIT_ROTATED).unwrap();
        // Stored 1920x1080, displayed portrait. PlayRes must follow the
        // display size or subtitles render sideways.
        assert_eq!(info.display_dimensions(), (1080, 1920));
    }

    #[test]
    fn detects_hdr_and_missing_audio() {
        let info = MediaInfo::from_ffprobe_json(PORTRAIT_ROTATED).unwrap();
        assert!(info.color.is_hdr());
        assert!(!info.has_audio);
        assert_eq!(info.audio_codec, None);
    }

    #[test]
    fn errors_when_no_video_stream() {
        let json = r#"{"streams":[{"index":0,"codec_type":"audio","codec_name":"aac"}],
                       "format":{"duration":"1.0"}}"#;
        assert!(matches!(
            MediaInfo::from_ffprobe_json(json),
            Err(MediaError::NoVideoStream)
        ));
    }

    #[test]
    fn errors_when_video_stream_missing_dimensions() {
        let json = r#"{"streams":[{"index":0,"codec_type":"video","codec_name":"h264",
                       "r_frame_rate":"30/1","avg_frame_rate":"30/1"}],
                       "format":{"duration":"1.0"}}"#;
        assert!(matches!(
            MediaInfo::from_ffprobe_json(json),
            Err(MediaError::MalformedVideoStream)
        ));
    }
}
