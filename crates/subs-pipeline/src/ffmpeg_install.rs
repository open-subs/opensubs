//! One-click(ish) `ffmpeg-full` install via Homebrew, offered by both apps
//! when `ffmpeg` is missing or lacks libass (see `job::ffmpeg_binary` and
//! `commands.rs`/`main.rs`'s `has_ass_filter`). Shared here rather than
//! duplicated per app because streaming a child process's combined
//! stdout/stderr live is nontrivial to get right, unlike the one-line
//! process-spawning helpers (`has_ass_filter`) that already are duplicated.

use std::io::BufRead;
use std::path::PathBuf;
use std::process::{Command as Process, Stdio};
use std::sync::mpsc;
use std::thread;

use crate::paths::{find_binary, homebrew_dirs};

/// Locates the `brew` executable itself. `None` means Homebrew genuinely
/// isn't installed anywhere this checks (as opposed to just not being on
/// this process's `PATH` -- see `paths` module docs).
pub fn brew_binary() -> Option<PathBuf> {
    find_binary("brew", homebrew_dirs())
}

/// Runs `brew install ffmpeg-full`, calling `on_line` with each line of
/// output as it streams in (stdout and stderr merged, in roughly the order
/// they arrive -- brew splits its own progress across both, and the caller
/// just wants a readable log, not stream provenance). Returns `Err` with a
/// message meant to be shown to the user directly, either because Homebrew
/// isn't installed or because the install itself failed.
pub fn install_ffmpeg_full(mut on_line: impl FnMut(&str)) -> Result<(), String> {
    let brew = brew_binary().ok_or_else(|| {
        "Homebrew isn't installed. Install it from https://brew.sh, then run \
         `brew install ffmpeg-full` yourself."
            .to_string()
    })?;

    let mut child = Process::new(&brew)
        .args(["install", "ffmpeg-full"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("failed to spawn {}: {e}", brew.display()))?;

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
        on_line(&line);
    }
    let _ = out_thread.join();
    let _ = err_thread.join();

    let status = child
        .wait()
        .map_err(|e| format!("failed to wait on {}: {e}", brew.display()))?;
    if !status.success() {
        return Err(format!(
            "{} install ffmpeg-full exited with {status}",
            brew.display()
        ));
    }
    Ok(())
}
