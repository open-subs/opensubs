use crate::trim::TrimRange;
use std::path::Path;

/// Extract an ASR-only audio copy: 16 kHz mono PCM, Whisper's native input.
///
/// This never influences the exported file. The export's audio is
/// stream-copied from the source, so audio quality loss is exactly zero.
///
/// `trim` must be the same range the burn will use: extracting only the
/// kept span is what makes transcript timestamps clip-relative, so the
/// transcript's clock and the exported clip's clock are the same clock.
/// It also means a 20-second cut from an hour-long recording transcribes
/// in seconds rather than minutes.
///
/// The seek goes on the output side for exactly the reason the burn's
/// does (see [`TrimRange::seek_args`]) -- and, more narrowly, so that both
/// land on the same instant. An input-side seek here would start the WAV
/// at the nearest audio packet while the burn started at the exact frame,
/// putting the two clocks tens of milliseconds apart for no gain.
pub fn extract_audio_args(input: &Path, out_wav: &Path, trim: TrimRange) -> Vec<String> {
    let mut a: Vec<String> = vec!["-v".into(), "error".into(), "-y".into()];
    a.extend([
        "-i".into(),
        input.to_string_lossy().into_owned(),
        "-vn".into(),
        "-map".into(),
        "0:a:0".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "16000".into(),
        "-c:a".into(),
        "pcm_s16le".into(),
        "-f".into(),
        "wav".into(),
    ]);
    a.extend(trim.seek_args());
    a.push(out_wav.to_string_lossy().into_owned());
    a
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn extracts_16k_mono_pcm_for_asr() {
        let a = extract_audio_args(Path::new("in.mp4"), Path::new("asr.wav"), TrimRange::FULL);
        let joined = a.join(" ");
        assert!(joined.contains("-vn"));
        assert!(joined.contains("-ac 1"));
        assert!(joined.contains("-ar 16000"));
        assert!(joined.contains("-c:a pcm_s16le"));
        assert!(joined.contains("-map 0:a:0"));
        assert_eq!(a.last().unwrap(), "asr.wav");
        assert!(
            !joined.contains("-ss"),
            "an untrimmed extract must not seek"
        );
        assert!(
            !a.contains(&"-t".to_string()),
            "an untrimmed extract must not cap duration"
        );
    }

    #[test]
    fn a_trim_seeks_before_the_input_and_caps_the_duration() {
        let a = extract_audio_args(
            Path::new("in.mp4"),
            Path::new("asr.wav"),
            TrimRange::new(12.0, Some(20.0)),
        );
        let ss = a.iter().position(|x| x == "-ss").expect("no -ss");
        let i = a.iter().position(|x| x == "-i").expect("no -i");
        assert!(
            ss > i,
            "the seek must follow -i so it lands on the same instant the burn does"
        );
        assert_eq!(a[ss + 1], "12.000");
        let t = a.iter().position(|x| x == "-t").expect("no -t");
        assert_eq!(a[t + 1], "8.000");
        assert_eq!(a.last().unwrap(), "asr.wav");
    }

    #[test]
    fn an_open_ended_trim_seeks_without_capping() {
        let a = extract_audio_args(
            Path::new("in.mp4"),
            Path::new("asr.wav"),
            TrimRange::new(5.0, None),
        );
        assert!(a.contains(&"-ss".to_string()));
        assert!(!a.contains(&"-t".to_string()));
    }
}
