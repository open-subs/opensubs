//! Golden-assertion CLI. Mirrors openscreenshot's `shot-qa`.
//!
//! Every quality claim in the spec maps to a flag here, so a regression is a
//! failing exit code rather than something a human has to notice.

mod assert;

use assert::{check_eq, check_near, Report};
use std::process::Command;
use subs_media::{probe_args, MediaInfo, Rational};

fn probe(path: &str) -> MediaInfo {
    let out = Command::new("ffprobe")
        .args(probe_args(std::path::Path::new(path)))
        .output()
        .unwrap_or_else(|e| fatal(&format!("failed to run ffprobe: {e}")));
    if !out.status.success() {
        fatal(&format!(
            "ffprobe failed: {}",
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    MediaInfo::from_ffprobe_json(&String::from_utf8_lossy(&out.stdout))
        .unwrap_or_else(|e| fatal(&format!("could not parse ffprobe output: {e}")))
}

/// md5 of the raw audio stream, with no re-encode. Comparing this between
/// source and output proves `-c:a copy` really happened (claim Q1).
fn audio_md5(path: &str) -> Option<String> {
    let out = Command::new("ffmpeg")
        .args([
            "-v", "error", "-i", path, "-map", "0:a", "-c", "copy", "-f", "md5", "-",
        ])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .trim()
        .strip_prefix("MD5=")
        .map(str::to_string)
}

fn fatal(msg: &str) -> ! {
    eprintln!("subs-qa: {msg}");
    std::process::exit(2);
}

fn usage() -> ! {
    eprintln!(
        "usage: subs-qa assert <file> [options]\n\
         \n\
         options:\n\
         \x20 --duration S            expected duration in seconds\n\
         \x20 --tolerance S           duration tolerance (default 0.04)\n\
         \x20 --width N               expected display width\n\
         \x20 --height N              expected display height\n\
         \x20 --fps N/D               expected frame rate\n\
         \x20 --vcodec NAME           expected video codec\n\
         \x20 --pix-fmt FMT           expected pixel format\n\
         \x20 --colorspace CS         expected colour space tag\n\
         \x20 --color-primaries P     expected colour primaries tag\n\
         \x20 --color-trc T           expected transfer characteristics tag\n\
         \x20 --audio-identical-to F  assert the audio stream was copied, not re-encoded"
    );
    std::process::exit(2)
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 2 || args[0] != "assert" {
        usage();
    }
    let path = args[1].clone();
    let info = probe(&path);
    let (dw, dh) = info.display_dimensions();

    let mut r = Report::default();
    let mut tolerance = 0.04f64;
    let mut duration: Option<f64> = None;

    let mut i = 2;
    while i < args.len() {
        let flag = args[i].as_str();
        let val = || -> String {
            args.get(i + 1)
                .cloned()
                .unwrap_or_else(|| fatal(&format!("{flag} needs a value")))
        };
        match flag {
            "--tolerance" => tolerance = val().parse().unwrap_or(0.04),
            "--duration" => duration = val().parse().ok(),
            "--width" => check_eq(&mut r, "width", dw, val().parse().unwrap_or(0)),
            "--height" => check_eq(&mut r, "height", dh, val().parse().unwrap_or(0)),
            "--fps" => {
                let want = Rational::parse(&val())
                    .unwrap_or_else(|| fatal("--fps must look like 30000/1001"));
                check_eq(&mut r, "fps", info.fps, want);
            }
            "--vcodec" => check_eq(
                &mut r,
                "vcodec",
                info.video_codec.clone().unwrap_or_default(),
                val(),
            ),
            "--pix-fmt" => check_eq(&mut r, "pix_fmt", info.pix_fmt.clone(), val()),
            "--colorspace" => check_eq(
                &mut r,
                "colorspace",
                info.color.space.clone().unwrap_or_default(),
                val(),
            ),
            "--color-primaries" => check_eq(
                &mut r,
                "color_primaries",
                info.color.primaries.clone().unwrap_or_default(),
                val(),
            ),
            "--color-trc" => check_eq(
                &mut r,
                "color_trc",
                info.color.transfer.clone().unwrap_or_default(),
                val(),
            ),
            "--audio-identical-to" => {
                let source = val();
                r.checks += 1;
                match (audio_md5(&path), audio_md5(&source)) {
                    (Some(a), Some(b)) if a == b => {}
                    (Some(a), Some(b)) => r.failures.push(format!(
                        "audio was re-encoded: output md5 {a} != source md5 {b}"
                    )),
                    _ => r
                        .failures
                        .push("could not compute audio md5 for both files".into()),
                }
            }
            other => fatal(&format!("unknown flag {other}")),
        }
        i += 2;
    }

    // Duration is checked last so --tolerance can precede or follow it.
    if let Some(d) = duration {
        check_near(&mut r, "duration", info.duration, d, tolerance);
    }

    r.print();
    std::process::exit(r.exit_code());
}
