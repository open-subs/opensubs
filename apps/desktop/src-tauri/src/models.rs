//! Curated whisper model list + download, offered by the GUI's Model card
//! as an alternative to picking an existing file already on disk. See
//! docs/superpowers/specs/2026-08-06-model-download-design.md.

use std::path::{Path, PathBuf};

/// One entry in the curated list. `size_bytes` is the real file size (from
/// Hugging Face's `Content-Length`), shown to the user -- never compared
/// byte-for-byte against what's actually downloaded (see `is_downloaded`).
pub struct ModelOption {
    pub name: &'static str,
    pub filename: &'static str,
    pub url: &'static str,
    pub size_bytes: u64,
    pub description: &'static str,
}

pub static MODEL_OPTIONS: [ModelOption; 3] = [
    ModelOption {
        name: "tiny.en",
        filename: "ggml-tiny.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin",
        size_bytes: 77_704_715,
        description: "fastest, roughest",
    },
    ModelOption {
        name: "base.en",
        filename: "ggml-base.en.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin",
        size_bytes: 147_964_211,
        description: "good default",
    },
    ModelOption {
        name: "large-v3-turbo",
        filename: "ggml-large-v3-turbo.bin",
        url: "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin",
        size_bytes: 1_624_555_275,
        description: "best quality, multilingual",
    },
];

/// `~/.cache/opensubs-models` -- the exact path the README already tells
/// CLI users to populate manually. Deliberately NOT Tauri's app-specific
/// cache dir, so a model downloaded through the GUI is immediately usable
/// from the CLI, and vice versa.
///
/// **Falls back to the pre-rename `~/.cache/openvidsub-models`** when that
/// directory exists and the current one does not. The product was renamed
/// from OpenVidSub to OpenSubs after 0.1.0 shipped, and the largest model
/// is 1.6 GB: silently re-downloading it because a directory changed name
/// is not an acceptable upgrade experience. The legacy directory is only
/// ever *read* -- nothing is moved or deleted, so downgrading still works,
/// and once the new directory exists it wins outright.
pub fn models_dir() -> Result<PathBuf, String> {
    let home =
        dirs::home_dir().ok_or_else(|| "could not resolve the home directory".to_string())?;
    let cache = home.join(".cache");
    let current = cache.join("opensubs-models");
    if !current.is_dir() {
        let legacy = cache.join(LEGACY_MODELS_DIR);
        if legacy.is_dir() {
            return Ok(legacy);
        }
    }
    Ok(current)
}

/// Where models lived when the product was called OpenVidSub.
const LEGACY_MODELS_DIR: &str = "openvidsub-models";

/// A model only ever reaches `models_dir()/<filename>` via an atomic
/// rename from a `.part` file on a fully successful download (see
/// `ensure_model_downloaded` in the next task), so plain existence already
/// implies completeness -- no partial file can ever sit at this exact path.
fn is_downloaded(dir: &Path, filename: &str) -> bool {
    dir.join(filename).is_file()
}

/// Abstracts the network fetch behind a trait so the atomic-rename /
/// already-downloaded / progress-accounting logic in
/// `ensure_model_downloaded` can be unit-tested with a fake, without a
/// real network call -- mirrors `subs_asr::Transcriber`/`MockTranscriber`.
pub trait ModelSource {
    /// Fetches `url`, writing bytes to `dest` as they arrive and calling
    /// `on_progress(bytes_written_so_far, total_bytes)` after each write.
    /// `total_bytes` is `None` when the source doesn't report a size
    /// upfront. Must create `dest` itself; must NOT write to any other path.
    fn fetch(
        &self,
        url: &str,
        dest: &Path,
        on_progress: &mut dyn FnMut(u64, Option<u64>),
    ) -> Result<(), String>;
}

/// The real implementation, used by the `download_model` Tauri command
/// (Task 3). Uses `reqwest`'s *blocking* client deliberately: this
/// codebase's other long-running subprocess/IO work (`install_ffmpeg_full`,
/// `run_burn_ffmpeg`) is synchronous code run via
/// `tauri::async_runtime::spawn_blocking`, not native async -- matching
/// that keeps this the only network code path in the app to a single,
/// already-established style, and `reqwest::blocking` is explicitly
/// documented as safe to use from a `spawn_blocking` thread (unlike calling
/// it directly inside an `async fn`, which panics).
pub struct HttpModelSource;

impl ModelSource for HttpModelSource {
    fn fetch(
        &self,
        url: &str,
        dest: &Path,
        on_progress: &mut dyn FnMut(u64, Option<u64>),
    ) -> Result<(), String> {
        use std::io::{Read, Write};

        // `reqwest::blocking::ClientBuilder::timeout` is NOT the same thing
        // as `async_impl::ClientBuilder::timeout` (a total-request
        // deadline) despite the identical name and despite there being no
        // separate `read_timeout` method on the blocking builder in this
        // crate version (0.13.4). Verified against the vendored source
        // (`blocking/response.rs`): the blocking client threads its
        // `timeout` value into `wait::timeout(self.body_mut().read(buf),
        // timeout)`, i.e. it wraps each individual `Read::read()` call on
        // the response body, and resets on every successful read -- so a
        // large-but-flowing download is never killed, only a connection
        // that goes idle for the full duration errors out. `connect_timeout`
        // covers the initial handshake separately.
        let client = reqwest::blocking::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(30))
            .timeout(std::time::Duration::from_secs(60))
            .build()
            .map_err(|e| format!("failed to build HTTP client: {e}"))?;

        let mut response = client
            .get(url)
            .send()
            .map_err(|e| format!("GET {url}: {e}"))?;
        if !response.status().is_success() {
            return Err(format!("GET {url} returned {}", response.status()));
        }
        let total_bytes = response.content_length();

        // `create_new` (not `create`) so two concurrent writers to the same
        // `.part` path fail loudly instead of silently interleaving their
        // writes into one corrupt file. Not currently reachable -- the
        // frontend only ever has one download in flight -- but cheap
        // defense-in-depth against a future caller that doesn't uphold that.
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(dest).map_err(|e| {
            format!(
                "could not create {} (a concurrent download to the same file may already be in progress): {e}",
                dest.display()
            )
        })?;

        let mut buf = [0u8; 64 * 1024];
        let mut downloaded: u64 = 0;
        loop {
            let n = response
                .read(&mut buf)
                .map_err(|e| format!("reading {url}: {e}"))?;
            if n == 0 {
                break;
            }
            file.write_all(&buf[..n])
                .map_err(|e| format!("writing {}: {e}", dest.display()))?;
            downloaded += n as u64;
            on_progress(downloaded, total_bytes);
        }
        Ok(())
    }
}

/// Ensures `opt` is present in `dir`, downloading via `source` unless
/// `is_downloaded` already says it's there. Returns the final path either
/// way. `on_progress` receives `(percent, downloaded_bytes, total_bytes)`,
/// called only when the whole percent value changes (an emit-per-chunk
/// flood is wasted work the caller -- a Tauri event emitter, in Task 3 --
/// doesn't need). Downloads to a `<filename>.part` sibling of the final
/// path and renames only on success; on failure, removes the `.part` file
/// and returns the error, leaving no file at either path.
pub fn ensure_model_downloaded(
    source: &dyn ModelSource,
    opt: &ModelOption,
    dir: &Path,
    mut on_progress: impl FnMut(f64, u64, Option<u64>),
) -> Result<PathBuf, String> {
    let final_path = dir.join(opt.filename);
    if is_downloaded(dir, opt.filename) {
        return Ok(final_path);
    }

    std::fs::create_dir_all(dir).map_err(|e| format!("could not create {}: {e}", dir.display()))?;
    let part_path = dir.join(format!("{}.part", opt.filename));
    // A `.part` left over from a killed/crashed process (not a cleanup
    // failure in this run -- both failure paths below already handle
    // that) would otherwise permanently block every future attempt now
    // that the source writes with `create_new` -- clear it before trying
    // again. `create_new` still catches two downloads racing within the
    // same process run, which is the actual scenario it's guarding.
    let _ = std::fs::remove_file(&part_path);

    let mut last_whole_percent: i64 = -1;
    let mut last_byte_report: u64 = 0;
    const BYTE_INTERVAL: u64 = 1024 * 1024; // 1 MB: report at this byte interval when total is unknown
    let fetch_result = source.fetch(opt.url, &part_path, &mut |downloaded, total| {
        let percent = total
            .filter(|&t| t > 0)
            .map(|t| (downloaded as f64 / t as f64) * 100.0)
            .unwrap_or(0.0);
        let whole = percent as i64;
        // Report if: (1) total is known and whole-percent changed, or (2) total is unknown and we've
        // downloaded at least BYTE_INTERVAL more bytes since last report. This way, sources that don't
        // report size upfront (chunked transfer encoding, content-length: None) still report steady
        // progress instead of stalling after the first callback.
        let should_report = if total.is_some() {
            whole != last_whole_percent
        } else {
            downloaded >= last_byte_report + BYTE_INTERVAL
        };
        if should_report {
            last_whole_percent = whole;
            last_byte_report = downloaded;
            on_progress(percent, downloaded, total);
        }
    });

    match fetch_result {
        Ok(()) => {
            if let Err(e) = std::fs::rename(&part_path, &final_path) {
                let _ = std::fs::remove_file(&part_path);
                return Err(format!("could not finalize {}: {e}", final_path.display()));
            }
            Ok(final_path)
        }
        Err(e) => {
            let _ = std::fs::remove_file(&part_path);
            Err(e)
        }
    }
}

use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelOptionDto {
    pub name: String,
    pub filename: String,
    pub url: String,
    pub size_bytes: u64,
    pub description: String,
    pub already_downloaded: bool,
    pub local_path: Option<String>,
}

fn model_option_to_dto(opt: &ModelOption, dir: &Path) -> ModelOptionDto {
    let downloaded = is_downloaded(dir, opt.filename);
    ModelOptionDto {
        name: opt.name.to_string(),
        filename: opt.filename.to_string(),
        url: opt.url.to_string(),
        size_bytes: opt.size_bytes,
        description: opt.description.to_string(),
        already_downloaded: downloaded,
        local_path: downloaded.then(|| dir.join(opt.filename).to_string_lossy().into_owned()),
    }
}

#[tauri::command]
pub fn list_downloadable_models() -> Result<Vec<ModelOptionDto>, String> {
    let dir = models_dir()?;
    Ok(MODEL_OPTIONS
        .iter()
        .map(|o| model_option_to_dto(o, &dir))
        .collect())
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDownloadProgressPayload {
    pub filename: String,
    pub percent: f64,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
}

/// Looks `filename` up in `MODEL_OPTIONS` server-side -- the frontend never
/// supplies a URL directly -- downloads it (or no-ops if already present),
/// emitting `model-download-progress` events as it goes, and returns the
/// final on-disk path.
#[tauri::command]
pub async fn download_model(app: AppHandle, filename: String) -> Result<String, String> {
    let opt = MODEL_OPTIONS
        .iter()
        .find(|o| o.filename == filename)
        .ok_or_else(|| format!("'{filename}' is not one of the offered models"))?;
    let dir = models_dir()?;

    tauri::async_runtime::spawn_blocking(move || {
        ensure_model_downloaded(
            &HttpModelSource,
            opt,
            &dir,
            |percent, downloaded_bytes, total_bytes| {
                let _ = app.emit(
                    "model-download-progress",
                    ModelDownloadProgressPayload {
                        filename: opt.filename.to_string(),
                        percent,
                        downloaded_bytes,
                        total_bytes,
                    },
                );
            },
        )
        .map(|p| p.to_string_lossy().into_owned())
    })
    .await
    .map_err(|e| format!("download task panicked: {e}"))?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_curated_model_is_well_formed() {
        assert_eq!(MODEL_OPTIONS.len(), 3);
        for opt in &MODEL_OPTIONS {
            assert!(!opt.name.is_empty());
            assert!(!opt.filename.is_empty());
            assert!(
                !opt.filename.contains('/'),
                "{}: filename must not contain a path separator (dir.join(filename) must stay inside dir)",
                opt.name
            );
            assert!(
                opt.url.starts_with("https://huggingface.co/"),
                "{}",
                opt.name
            );
            assert!(
                opt.url.ends_with(opt.filename),
                "{} url should end with its own filename",
                opt.name
            );
            assert!(opt.size_bytes > 0, "{}", opt.name);
            assert!(!opt.description.is_empty());
        }
    }

    #[test]
    fn model_option_to_dto_reports_not_downloaded_for_an_absent_file() {
        let dir = tempfile::tempdir().unwrap();
        let opt = test_option();

        let dto = model_option_to_dto(&opt, dir.path());

        assert_eq!(dto.name, opt.name);
        assert_eq!(dto.filename, opt.filename);
        assert_eq!(dto.url, opt.url);
        assert_eq!(dto.size_bytes, opt.size_bytes);
        assert_eq!(dto.description, opt.description);
        assert!(!dto.already_downloaded);
        assert_eq!(dto.local_path, None);
    }

    #[test]
    fn model_option_to_dto_reports_downloaded_for_a_present_file() {
        let dir = tempfile::tempdir().unwrap();
        let opt = test_option();
        std::fs::write(dir.path().join(opt.filename), b"already here").unwrap();

        let dto = model_option_to_dto(&opt, dir.path());

        assert!(dto.already_downloaded);
        assert_eq!(
            dto.local_path,
            Some(dir.path().join(opt.filename).to_string_lossy().into_owned())
        );
    }

    #[test]
    fn is_downloaded_true_when_the_file_exists() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("ggml-tiny.en.bin"), b"fake model bytes").unwrap();
        assert!(is_downloaded(dir.path(), "ggml-tiny.en.bin"));
    }

    #[test]
    fn is_downloaded_false_when_the_file_is_absent() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!is_downloaded(dir.path(), "ggml-tiny.en.bin"));
    }

    #[test]
    fn is_downloaded_false_for_a_directory_of_the_same_name() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir(dir.path().join("ggml-tiny.en.bin")).unwrap();
        assert!(!is_downloaded(dir.path(), "ggml-tiny.en.bin"));
    }

    use std::sync::atomic::{AtomicBool, Ordering};

    /// A controllable fake `ModelSource` for testing `ensure_model_downloaded`
    /// without a network call. `fail_before_write`: return an error before
    /// creating `dest` at all (simulates a GET that never connects).
    /// `fail_after_chunk`: write `bytes` in `chunk_size`-sized pieces, then
    /// return an error after the given chunk index (simulates a connection
    /// dropped mid-stream, after some bytes already reached disk).
    struct FakeModelSource {
        bytes: Vec<u8>,
        chunk_size: usize,
        total_bytes: Option<u64>,
        fail_before_write: bool,
        fail_after_chunk: Option<usize>,
        called: AtomicBool,
    }

    impl FakeModelSource {
        fn succeeding(bytes: &[u8], chunk_size: usize, total_bytes: Option<u64>) -> Self {
            FakeModelSource {
                bytes: bytes.to_vec(),
                chunk_size,
                total_bytes,
                fail_before_write: false,
                fail_after_chunk: None,
                called: AtomicBool::new(false),
            }
        }
    }

    impl ModelSource for FakeModelSource {
        fn fetch(
            &self,
            _url: &str,
            dest: &Path,
            on_progress: &mut dyn FnMut(u64, Option<u64>),
        ) -> Result<(), String> {
            self.called.store(true, Ordering::SeqCst);
            if self.fail_before_write {
                return Err("simulated failure before any bytes".to_string());
            }
            use std::io::Write;
            let mut file = std::fs::File::create(dest).map_err(|e| e.to_string())?;
            let mut written = 0u64;
            for (i, chunk) in self.bytes.chunks(self.chunk_size.max(1)).enumerate() {
                file.write_all(chunk).map_err(|e| e.to_string())?;
                written += chunk.len() as u64;
                on_progress(written, self.total_bytes);
                if self.fail_after_chunk == Some(i) {
                    return Err("simulated failure mid-stream".to_string());
                }
            }
            Ok(())
        }
    }

    fn test_option() -> ModelOption {
        ModelOption {
            name: "tiny.en",
            filename: "ggml-tiny.en.bin",
            url: "https://example.invalid/ggml-tiny.en.bin",
            size_bytes: 11,
            description: "test fixture",
        }
    }

    #[test]
    fn already_downloaded_short_circuits_without_calling_the_source() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("ggml-tiny.en.bin"), b"already here").unwrap();
        let source = FakeModelSource {
            fail_before_write: true,
            ..FakeModelSource::succeeding(b"", 1, None)
        };

        let result = ensure_model_downloaded(&source, &test_option(), dir.path(), |_, _, _| {
            panic!("must not report progress when nothing was downloaded")
        });

        assert_eq!(result.unwrap(), dir.path().join("ggml-tiny.en.bin"));
        assert!(!source.called.load(Ordering::SeqCst));
    }

    #[test]
    fn successful_download_renames_part_to_final_and_leaves_no_part_file() {
        let dir = tempfile::tempdir().unwrap();
        let source = FakeModelSource::succeeding(b"hello world", 4, Some(11));
        let mut progress_calls: Vec<(f64, u64, Option<u64>)> = Vec::new();

        let result = ensure_model_downloaded(&source, &test_option(), dir.path(), |p, d, t| {
            progress_calls.push((p, d, t));
        });

        let path = result.unwrap();
        assert_eq!(path, dir.path().join("ggml-tiny.en.bin"));
        assert_eq!(std::fs::read(&path).unwrap(), b"hello world");
        assert!(!dir.path().join("ggml-tiny.en.bin.part").exists());

        let (last_percent, last_downloaded, last_total) = *progress_calls.last().unwrap();
        assert!((last_percent - 100.0).abs() < 0.01);
        assert_eq!(last_downloaded, 11);
        assert_eq!(last_total, Some(11));
    }

    #[test]
    fn a_stale_part_file_from_a_killed_process_does_not_block_a_fresh_download() {
        let dir = tempfile::tempdir().unwrap();
        // Simulates leftover state from a process that was killed mid-download
        // in a *previous* run -- nothing in this test run wrote this file, so
        // ensure_model_downloaded's own cleanup paths never touch it.
        std::fs::write(
            dir.path().join("ggml-tiny.en.bin.part"),
            b"leftover partial bytes",
        )
        .unwrap();
        let source = FakeModelSource::succeeding(b"hello world", 4, Some(11));

        let result = ensure_model_downloaded(&source, &test_option(), dir.path(), |_, _, _| {});

        let path = result.expect("a stale .part file must not block a fresh download attempt");
        assert_eq!(std::fs::read(&path).unwrap(), b"hello world");
        assert!(!dir.path().join("ggml-tiny.en.bin.part").exists());
    }

    #[test]
    fn failure_before_any_bytes_leaves_no_final_file_and_no_part_file() {
        let dir = tempfile::tempdir().unwrap();
        let source = FakeModelSource {
            fail_before_write: true,
            ..FakeModelSource::succeeding(b"", 1, None)
        };

        let result = ensure_model_downloaded(&source, &test_option(), dir.path(), |_, _, _| {});

        assert!(result.is_err());
        assert!(!dir.path().join("ggml-tiny.en.bin").exists());
        assert!(!dir.path().join("ggml-tiny.en.bin.part").exists());
    }

    #[test]
    fn failure_mid_stream_cleans_up_the_partial_part_file() {
        let dir = tempfile::tempdir().unwrap();
        let source = FakeModelSource {
            fail_after_chunk: Some(0),
            ..FakeModelSource::succeeding(b"hello world", 4, Some(11))
        };

        let result = ensure_model_downloaded(&source, &test_option(), dir.path(), |_, _, _| {});

        assert!(result.is_err());
        assert!(!dir.path().join("ggml-tiny.en.bin").exists());
        assert!(!dir.path().join("ggml-tiny.en.bin.part").exists());
    }

    #[test]
    fn rename_failure_cleans_up_the_part_file() {
        let dir = tempfile::tempdir().unwrap();
        // Create a directory at the final path so rename will fail
        std::fs::create_dir(dir.path().join("ggml-tiny.en.bin")).unwrap();
        let source = FakeModelSource::succeeding(b"hello world", 4, Some(11));

        let result = ensure_model_downloaded(&source, &test_option(), dir.path(), |_, _, _| {});

        // Should fail because we can't rename over a directory
        assert!(result.is_err());
        // Both files should be absent (the pre-existing directory at final path is fine, just check the .part)
        assert!(!dir.path().join("ggml-tiny.en.bin.part").exists());
    }

    #[test]
    fn progress_throttle_actually_suppresses_calls_with_large_total() {
        let dir = tempfile::tempdir().unwrap();
        // 100 chunks of 1 byte each = 100 bytes, but claim the total is 100,000.
        // This means all 100 bytes represent only 0.1% of the download, so all chunks
        // report 0% progress. Without throttle, we'd get 100 on_progress calls.
        // With throttle, we should get just 1 (the first chunk that reports 0%).
        let bytes = vec![1u8; 100];
        let source = FakeModelSource::succeeding(&bytes, 1, Some(100_000));
        let mut progress_calls: Vec<(f64, u64, Option<u64>)> = Vec::new();

        let result = ensure_model_downloaded(&source, &test_option(), dir.path(), |p, d, t| {
            progress_calls.push((p, d, t));
        });

        let _ = result.unwrap();
        // All 100 chunks are < 1%, so they all report 0.0% as their percent.
        // With throttle working, only the first chunk (or first few at most) should trigger a call.
        assert!(
            progress_calls.len() < 100,
            "throttle should suppress calls; got {} calls for 100 chunks",
            progress_calls.len()
        );
        assert!(!progress_calls.is_empty(), "should report at least once");
    }

    /// A real, end-to-end check of `HttpModelSource` against Hugging Face --
    /// everything the fakes above can't exercise: real HTTPS, the redirect
    /// from huggingface.co to its CDN, a real `Content-Length`, real
    /// progress accounting, and a real atomic rename. `#[ignore]`d so it
    /// never runs in normal `cargo test` / CI (it downloads ~75MB over the
    /// network); run it explicitly with:
    /// `cargo test -p opensubs-desktop --lib -- --ignored real_download`.
    #[test]
    #[ignore = "hits the real network; run explicitly with `cargo test -- --ignored real_download`"]
    fn real_download_of_tiny_en_from_hugging_face() {
        let dir = tempfile::tempdir().unwrap();
        let opt = MODEL_OPTIONS
            .iter()
            .find(|o| o.filename == "ggml-tiny.en.bin")
            .unwrap();

        let result = ensure_model_downloaded(&HttpModelSource, opt, dir.path(), |_, _, _| {});

        let path = result.expect("real download should succeed");
        let size = std::fs::metadata(&path).unwrap().len();
        assert!(size > 0);
        let expected = opt.size_bytes;
        assert!(
            (size as f64 - expected as f64).abs() / (expected as f64) < 0.1,
            "downloaded size {size} too far from expected {expected}"
        );
    }

    /// `models_dir` reads $HOME, which is process-global, so these two
    /// cases share one test rather than racing each other.
    #[test]
    fn the_pre_rename_model_cache_is_reused_rather_than_re_downloaded() {
        let tmp = tempfile::tempdir().unwrap();
        let home = tmp.path();
        let cache = home.join(".cache");
        let legacy = cache.join(LEGACY_MODELS_DIR);
        std::fs::create_dir_all(&legacy).unwrap();

        // SAFETY: single-threaded test; no other thread reads the
        // environment while this runs.
        let previous = std::env::var_os("HOME");
        unsafe { std::env::set_var("HOME", home) };

        // Only the legacy directory exists: a user upgrading from
        // OpenVidSub keeps their 1.6 GB model.
        assert_eq!(models_dir().unwrap(), legacy);

        // Once the new directory exists it wins, even with the legacy one
        // still sitting there.
        let current = cache.join("opensubs-models");
        std::fs::create_dir_all(&current).unwrap();
        assert_eq!(models_dir().unwrap(), current);

        match previous {
            Some(v) => unsafe { std::env::set_var("HOME", v) },
            None => unsafe { std::env::remove_var("HOME") },
        }
    }
}
