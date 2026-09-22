//! Checking the ffmpeg on this machine, and installing one that works, for
//! both apps: the desktop's banner and the CLI's prompt (see
//! `job::ffmpeg_binary` for where ffmpeg is looked for). Shared here rather
//! than duplicated per app because streaming a child process's combined
//! stdout/stderr live is nontrivial to get right.
//!
//! OpenSubs needs two filters from ffmpeg: `whisper`, which transcribes, and
//! `ass` (libass), which burns. The install is per platform, because the
//! only thing that used to be offered was Homebrew -- a macOS package
//! manager, shown to Windows users as the one way forward (APP-120).

use std::io::BufRead;
use std::path::{Path, PathBuf};
use std::process::{Command as Process, Stdio};
use std::sync::mpsc;
use std::thread;

use crate::paths::{find_binary, homebrew_dirs};

/// The filters OpenSubs cannot run without, and what each is for.
pub const REQUIRED_FILTERS: [(&str, &str); 2] = [
    ("whisper", "transcribes the audio"),
    ("ass", "burns the subtitles in (libass)"),
];

/// Which of [`REQUIRED_FILTERS`] a `ffmpeg -filters` listing lacks. Split
/// from [`missing_filters`] so it can be tested without a process.
pub fn missing_from_listing(listing: &str) -> Vec<&'static str> {
    let present: Vec<&str> = listing
        .lines()
        .filter_map(|l| l.split_whitespace().nth(1))
        .collect();
    REQUIRED_FILTERS
        .iter()
        .map(|(name, _)| *name)
        .filter(|name| !present.contains(name))
        .collect()
}

/// Which required filters `ffmpeg_bin` lacks; empty means it can do the
/// whole job. `Err` means it could not be run at all -- most often, not
/// installed.
pub fn missing_filters(ffmpeg_bin: &Path) -> Result<Vec<&'static str>, String> {
    let out = Process::new(ffmpeg_bin)
        .arg("-filters")
        .output()
        .map_err(|e| format!("failed to run {} -filters: {e}", ffmpeg_bin.display()))?;
    Ok(missing_from_listing(&String::from_utf8_lossy(&out.stdout)))
}

/// How ffmpeg gets installed on this platform, for the button and for the
/// command shown beside it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InstallMethod {
    /// What the install button says.
    pub label: &'static str,
    /// The same install, as a command someone can run themselves.
    pub command: &'static str,
    /// What gets installed, in a sentence.
    pub note: &'static str,
}

/// Homebrew's `ffmpeg-full` carries both filters; the plain `ffmpeg`
/// formula carries neither.
const HOMEBREW: InstallMethod = InstallMethod {
    label: "Install ffmpeg-full via Homebrew",
    command: "brew install ffmpeg-full",
    note: "The button installs Homebrew's ffmpeg-full, which has both; the plain ffmpeg formula has neither.",
};

/// Gyan.dev's full build, the one winget installs as `Gyan.FFmpeg`: it has
/// both filters, where the essentials build has libass and no whisper. It
/// installs as a portable zip whose `ffmpeg.exe` winget links from its
/// `Links` directory, which `paths::windows_dirs` checks, so the app finds
/// it without a restart. Windows 11 ships winget.
const WINGET: InstallMethod = InstallMethod {
    label: "Install FFmpeg with winget",
    command: "winget install --id Gyan.FFmpeg --exact",
    note: "The button installs Gyan.dev's full build (GPLv3), which has both; \
           its essentials build has no whisper.",
};

/// The install this platform offers, or `None` where there is no one
/// command to give (Linux: the distributions differ, and few ship an
/// ffmpeg with whisper yet).
pub fn install_method() -> Option<InstallMethod> {
    if cfg!(target_os = "macos") {
        Some(HOMEBREW)
    } else if cfg!(windows) {
        Some(WINGET)
    } else {
        None
    }
}

/// Locates the `brew` executable itself. `None` means Homebrew genuinely
/// isn't installed anywhere this checks (as opposed to just not being on
/// this process's `PATH` -- see `paths` module docs).
pub fn brew_binary() -> Option<PathBuf> {
    find_binary("brew", homebrew_dirs())
}

/// Locates `winget.exe`. It lives in the user's `WindowsApps` directory,
/// which is on `PATH` for a normal login.
fn winget_binary() -> Option<PathBuf> {
    let apps = std::env::var_os("LOCALAPPDATA")
        .map(|d| PathBuf::from(d).join("Microsoft").join("WindowsApps"));
    find_binary("winget.exe", apps)
}

/// Installs a working ffmpeg the way [`install_method`] describes, calling
/// `on_line` with each line of output as it streams in (stdout and stderr
/// merged, in roughly the order they arrive). Returns `Err` with a message
/// meant to be shown to the user directly.
pub fn install_ffmpeg_full(on_line: impl FnMut(&str)) -> Result<(), String> {
    if cfg!(windows) {
        let winget = winget_binary().ok_or_else(|| {
            "winget isn't available. Install \"App Installer\" from the Microsoft Store, \
             or download the full build from https://www.gyan.dev/ffmpeg/builds/ and put \
             its bin folder on PATH."
                .to_string()
        })?;
        return run_streaming(
            &winget,
            &[
                "install",
                "--id",
                "Gyan.FFmpeg",
                "--exact",
                "--silent",
                "--accept-source-agreements",
                "--accept-package-agreements",
            ],
            on_line,
        );
    }
    let brew = brew_binary().ok_or_else(|| {
        "Homebrew isn't installed. Install it from https://brew.sh, then run \
         `brew install ffmpeg-full` yourself."
            .to_string()
    })?;
    run_streaming(&brew, &["install", "ffmpeg-full"], on_line)
}

fn run_streaming(
    program: &Path,
    args: &[&str],
    mut on_line: impl FnMut(&str),
) -> Result<(), String> {
    let mut child = Process::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", program.display()))?;

    let stdout = child.stdout.take().expect("stdout was piped");
    let stderr = child.stderr.take().expect("stderr was piped");

    // Two reader threads feed one channel so lines from either stream reach
    // `on_line` roughly as they're produced, instead of dumping one stream
    // only after the other has closed. The channel closes itself once both
    // threads finish and their `Sender`s drop.
    let (tx, rx) = mpsc::channel::<String>();
    let tx_err = tx.clone();
    let out_thread = thread::spawn(move || {
        for line in std::io::BufReader::new(stdout)
            .lines()
            .map_while(Result::ok)
        {
            let _ = tx.send(line);
        }
    });
    let err_thread = thread::spawn(move || {
        for line in std::io::BufReader::new(stderr)
            .lines()
            .map_while(Result::ok)
        {
            let _ = tx_err.send(line);
        }
    });
    for line in rx {
        // winget redraws a progress bar in place with carriage returns;
        // keep the last state of each line, not every frame of it.
        let line = line
            .rsplit('\r')
            .find(|s| !s.trim().is_empty())
            .unwrap_or("");
        if !line.trim().is_empty() {
            on_line(line);
        }
    }
    let _ = out_thread.join();
    let _ = err_thread.join();

    let status = child
        .wait()
        .map_err(|e| format!("failed to wait on {}: {e}", program.display()))?;
    if !status.success() {
        return Err(format!(
            "{} {} exited with {status}",
            program.display(),
            args.first().copied().unwrap_or("")
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEADER: &str = "Filters:\n  T.. = Timeline support\n  ------\n";

    #[test]
    fn a_full_build_is_missing_nothing() {
        let listing = format!(
            "{HEADER} ... ass               V->V       Render ASS subtitles.\n \
             ... whisper           A->A       Transcribe audio using whisper.cpp.\n"
        );
        assert!(missing_from_listing(&listing).is_empty());
    }

    #[test]
    fn an_essentials_build_is_missing_whisper() {
        // Gyan.dev's essentials build: libass, no whisper.
        let listing = format!("{HEADER} ... ass               V->V       Render ASS subtitles.\n");
        assert_eq!(missing_from_listing(&listing), vec!["whisper"]);
    }

    #[test]
    fn a_plain_build_is_missing_both() {
        let listing = format!("{HEADER} ... scale             V->V       Scale the input video.\n");
        assert_eq!(missing_from_listing(&listing), vec!["whisper", "ass"]);
    }

    #[test]
    fn a_filter_named_in_a_description_does_not_count() {
        // Only the name column counts: "ass" appearing in another filter's
        // description is not the ass filter.
        let listing = format!("{HEADER} ... subtitles         V->V       Render text subtitles onto input video using the libass library.\n");
        assert_eq!(missing_from_listing(&listing), vec!["whisper", "ass"]);
    }

    #[test]
    fn windows_is_offered_winget_and_the_full_build() {
        // The build that has whisper; Gyan.FFmpeg.Essentials does not.
        assert_eq!(WINGET.command, "winget install --id Gyan.FFmpeg --exact");
        assert!(!WINGET.label.contains("Homebrew"));
        if cfg!(windows) {
            assert_eq!(install_method(), Some(WINGET));
        }
        if cfg!(target_os = "macos") {
            assert_eq!(install_method(), Some(HOMEBREW));
        }
    }
}
