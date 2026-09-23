//! Shared binary-location helpers, used by `ffmpeg_binary` (job.rs) and
//! the installers' own lookups (ffmpeg_install.rs). Not exported outside
//! the crate.

use std::path::PathBuf;

/// Homebrew's two real install prefixes (Apple Silicon, Intel). A GUI app
/// launched by double-clicking in Finder -- as opposed to a terminal -- is
/// started by `launchd` with a minimal default `PATH`
/// (`/usr/bin:/bin:/usr/sbin:/sbin`) that excludes both, so a bare-name
/// `PATH` search silently fails to find a binary that IS installed. This is
/// the actual fix, not just a nice-to-have fallback: checking these two
/// directories directly is what makes ffmpeg (and brew, for the install
/// flow) resolve correctly from a Finder-launched app.
const HOMEBREW_PREFIXES: [&str; 2] = ["/opt/homebrew/bin", "/usr/local/bin"];

pub(crate) fn homebrew_dirs() -> impl Iterator<Item = PathBuf> {
    HOMEBREW_PREFIXES.iter().map(PathBuf::from)
}

/// Where Windows package managers put `ffmpeg.exe`, for the same reason:
/// the app's `PATH` was fixed when it started, so an ffmpeg installed from
/// its own banner (APP-120) is not on it until the app restarts.
///
/// - winget links a portable package's commands from `Links`, per user or
///   machine-wide by install scope -- `Gyan.FFmpeg` is one;
/// - Chocolatey shims into `%ProgramData%\chocolatey\bin`;
/// - Scoop into `%USERPROFILE%\scoop\shims`.
///
/// Built from environment variables, so on macOS and Linux, where none of
/// them is set, it is empty.
pub(crate) fn windows_dirs() -> Vec<PathBuf> {
    let env = |name: &str| std::env::var_os(name).map(PathBuf::from);
    [
        env("LOCALAPPDATA").map(|d| d.join("Microsoft").join("WinGet").join("Links")),
        env("ProgramFiles").map(|d| d.join("WinGet").join("Links")),
        env("ProgramData").map(|d| d.join("chocolatey").join("bin")),
        env("USERPROFILE").map(|d| d.join("scoop").join("shims")),
    ]
    .into_iter()
    .flatten()
    .chain(winget_package_bins())
    .chain(registry_path_dirs())
    .collect()
}

/// Where winget unpacks a portable package when it cannot make links.
///
/// On an account without administrator rights and without developer mode,
/// winget creates no `Links` shortcut at all: it unpacks into
/// `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_<source>\
/// ffmpeg-<version>-full_build\bin` and adds that to the user's `PATH` in
/// the registry. An app that had already started -- the one that pressed the
/// install button -- has neither, and reported that it still could not burn
/// (APP-120, retested). Both are searched now.
fn winget_package_bins() -> Vec<PathBuf> {
    let Some(local) = std::env::var_os("LOCALAPPDATA") else {
        return Vec::new();
    };
    let packages = PathBuf::from(local)
        .join("Microsoft")
        .join("WinGet")
        .join("Packages");
    let Ok(entries) = std::fs::read_dir(&packages) else {
        return Vec::new();
    };
    let mut found = Vec::new();
    for package in entries.flatten() {
        if !package
            .file_name()
            .to_string_lossy()
            .starts_with("Gyan.FFmpeg")
        {
            continue;
        }
        // One build directory inside, named for the version.
        if let Ok(inner) = std::fs::read_dir(package.path()) {
            for build in inner.flatten() {
                found.push(build.path().join("bin"));
            }
        }
    }
    found
}

/// The `PATH` as the registry has it now, which is where an installer writes
/// it -- not the copy this process was started with. Windows only: `reg.exe`
/// is not there to run anywhere else.
fn registry_path_dirs() -> Vec<PathBuf> {
    if !cfg!(windows) {
        return Vec::new();
    }
    const KEYS: [&str; 2] = [
        "HKCU\\Environment",
        "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment",
    ];
    let mut dirs = Vec::new();
    for key in KEYS {
        let Ok(out) = std::process::Command::new("reg")
            .args(["query", key, "/v", "Path"])
            .output()
        else {
            continue;
        };
        let text = String::from_utf8_lossy(&out.stdout);
        dirs.extend(
            parse_reg_path(&text)
                .into_iter()
                .map(|d| PathBuf::from(expand_env(&d, |n| std::env::var(n).ok()))),
        );
    }
    dirs
}

/// The directories in a `reg query ... /v Path` listing.
///
/// The line is `    Path    REG_EXPAND_SZ    C:\dir;C:\other`, with the value
/// after the third run of whitespace and semicolons between entries.
pub(crate) fn parse_reg_path(output: &str) -> Vec<String> {
    for line in output.lines() {
        let mut parts = line.split_whitespace();
        if parts.next() != Some("Path") {
            continue;
        }
        let kind = parts.next().unwrap_or("");
        if !kind.starts_with("REG_") {
            continue;
        }
        // Split off the value itself, which may contain spaces.
        let value = line.split_once(kind).map(|(_, v)| v.trim()).unwrap_or("");
        return value
            .split(';')
            .map(str::trim)
            .filter(|d| !d.is_empty())
            .map(str::to_string)
            .collect();
    }
    Vec::new()
}

/// `%LOCALAPPDATA%\...` with the variables filled in. An unknown variable is
/// left as it is, which simply fails to resolve as a directory.
pub(crate) fn expand_env(text: &str, get: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) => {
                let name = &after[..end];
                match get(name) {
                    Some(value) => out.push_str(&value),
                    None => {
                        out.push('%');
                        out.push_str(name);
                        out.push('%');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// First existing `<dir>/<name>` among `dirs`. A pure filesystem check, no
/// `PATH` env var involved -- split out purely for testability, the same
/// way `commands.rs`'s `parse_filters_output` is split from `has_ass_filter`
/// so the logic can be tested without depending on process environment.
pub(crate) fn first_existing(
    name: &str,
    dirs: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    dirs.into_iter().map(|d| d.join(name)).find(|p| p.is_file())
}

/// First existing `<dir>/<name>` among the real `PATH` env var's entries.
fn find_on_path(name: &str) -> Option<PathBuf> {
    std::env::var_os("PATH").and_then(|paths| {
        std::env::split_paths(&paths).find_map(|dir| {
            let candidate = dir.join(name);
            candidate.is_file().then_some(candidate)
        })
    })
}

/// Locates `name`: first among `extra_dirs` (checked explicitly, regardless
/// of what `PATH` the current process happens to have), then via `PATH`
/// search. `None` means genuinely not found anywhere.
pub(crate) fn find_binary(
    name: &str,
    extra_dirs: impl IntoIterator<Item = PathBuf>,
) -> Option<PathBuf> {
    first_existing(name, extra_dirs).or_else(|| find_on_path(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    /// A scratch directory under `std::env::temp_dir()`, removed on drop --
    /// this crate has no `tempfile` dependency, so this is hand-rolled.
    struct ScratchDir(PathBuf);

    impl ScratchDir {
        fn new(tag: &str) -> Self {
            let dir = std::env::temp_dir().join(format!(
                "subs-pipeline-test-{tag}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            fs::create_dir_all(&dir).unwrap();
            ScratchDir(dir)
        }
    }

    impl Drop for ScratchDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// APP-120, retested: on an account without administrator rights winget
    /// makes no Links shortcut. It unpacks the package and puts that bin
    /// directory on the user's PATH in the registry, which the already
    /// running app does not have.
    #[test]
    fn the_registry_path_is_read_as_a_list_of_directories() {
        let out = "\r\nHKEY_CURRENT_USER\\Environment\r\n    Path    REG_EXPAND_SZ                %USERPROFILE%\\AppData\\Local\\Microsoft\\WindowsApps;            C:\\Users\\ycan4\\AppData\\Local\\Microsoft\\WinGet\\Packages\\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\\ffmpeg-9.0.2-full_build\\bin\r\n\r\n";
        let dirs = parse_reg_path(out);
        assert_eq!(dirs.len(), 2, "{dirs:?}");
        assert!(
            dirs[1].ends_with("ffmpeg-9.0.2-full_build\\bin"),
            "{dirs:?}"
        );
    }

    #[test]
    fn a_directory_with_a_space_in_it_survives() {
        let out = "    Path    REG_SZ    C:\\Program Files\\WinGet\\Links;C:\\other\r\n";
        assert_eq!(
            parse_reg_path(out),
            vec![
                "C:\\Program Files\\WinGet\\Links".to_string(),
                "C:\\other".to_string()
            ]
        );
    }

    #[test]
    fn no_path_value_is_no_directories() {
        assert!(parse_reg_path(
            "HKEY_CURRENT_USER\\Environment\r\n    TEMP    REG_SZ    C:\\t\r\n"
        )
        .is_empty());
        assert!(parse_reg_path("").is_empty());
    }

    #[test]
    fn variables_in_a_registry_path_are_filled_in() {
        let get = |name: &str| match name {
            "USERPROFILE" => Some("C:\\Users\\ycan4".to_string()),
            _ => None,
        };
        assert_eq!(
            expand_env("%USERPROFILE%\\bin", get),
            "C:\\Users\\ycan4\\bin"
        );
        // An unknown one is left alone rather than swallowed: it then simply
        // does not exist as a directory.
        assert_eq!(expand_env("%NOPE%\\bin", get), "%NOPE%\\bin");
        assert_eq!(expand_env("C:\\plain", get), "C:\\plain");
        assert_eq!(expand_env("100%", get), "100%");
    }

    #[test]
    fn first_existing_finds_the_file_in_the_first_matching_dir() {
        let a = ScratchDir::new("a");
        let b = ScratchDir::new("b");
        fs::write(b.0.join("thing"), b"").unwrap();

        let found = first_existing("thing", [a.0.clone(), b.0.clone()]);
        assert_eq!(found, Some(b.0.join("thing")));
    }

    #[test]
    fn first_existing_prefers_the_earlier_dir_when_both_have_it() {
        let a = ScratchDir::new("prefer-a");
        let b = ScratchDir::new("prefer-b");
        fs::write(a.0.join("thing"), b"").unwrap();
        fs::write(b.0.join("thing"), b"").unwrap();

        let found = first_existing("thing", [a.0.clone(), b.0.clone()]);
        assert_eq!(found, Some(a.0.join("thing")));
    }

    #[test]
    fn first_existing_returns_none_when_no_dir_has_it() {
        let a = ScratchDir::new("empty");
        assert_eq!(
            first_existing("does-not-exist-anywhere", [a.0.clone()]),
            None
        );
    }

    #[test]
    fn first_existing_ignores_a_directory_of_the_same_name() {
        // A directory named "thing" is not a usable binary -- must not be
        // mistaken for one just because the path exists.
        let a = ScratchDir::new("dir-not-file");
        fs::create_dir(a.0.join("thing")).unwrap();
        assert_eq!(first_existing("thing", [a.0.clone()]), None);
    }
}
