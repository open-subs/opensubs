//! Shared binary-location helpers, used by both `ffmpeg_binary` (job.rs)
//! and `brew_binary` (ffmpeg_install.rs). Not exported outside the crate.

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
