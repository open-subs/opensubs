//! A `Command` for the tools the apps run in the background.

use std::ffi::OsStr;
use std::process::Command;

/// `Command::new(program)`, minus the console window Windows gives a console
/// program started from a GUI app. The desktop app has no console of its own
/// (`windows_subsystem = "windows"`), so every ffmpeg, ffprobe and reg it ran
/// opened a terminal over it until the child exited. Output is unaffected:
/// piped streams still reach the parent.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    #[allow(unused_mut)]
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}
