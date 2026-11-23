//! The Mac App Store build: compiled only with the `appstore` feature, which
//! only `scripts/build-appstore.sh` turns on. The direct-download build has
//! none of this, and `lib.rs`'s own `run()` is the one it uses.
//!
//! What differs from that build, and why:
//!
//! - **No ffmpeg install.** The direct-download app can install ffmpeg with
//!   Homebrew or winget when the bundled one is missing. A sandboxed app may
//!   not run a program from outside its bundle, and may not download one to
//!   run, so `install_ffmpeg` is not registered and the only ffmpeg used is
//!   the LGPL build inside the app (`commands::store_cmds`), signed as a
//!   helper that inherits the app's sandbox.
//! - **Credits through StoreKit, sign-in with Apple's sheet**
//!   (`appstore/StoreBridge.swift`), reached through [`store_call`]. The card
//!   checkout never appears (guideline 3.1.1).
//! - **Exports go to a folder the person picks.** The sandbox lets the app
//!   write only where it was shown a panel, so writing beside the video is
//!   replaced by [`commands::store_cmds::output_in`] after a folder panel.
//! - **Reveal in Finder** through `NSWorkspace` rather than `open -R`.

use std::collections::HashMap;
use std::ffi::{c_char, CStr, CString};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Mutex, OnceLock};

use tauri::{AppHandle, Emitter};

use crate::{cloud, commands, models};

type Reply = extern "C" fn(u64, *const c_char, bool);
type Event = extern "C" fn(*const c_char);

extern "C" {
    fn opensubs_store_start(on_transaction: Event);
    fn opensubs_store_call(id: u64, op: *const c_char, arg: *const c_char, reply: Reply);
}

/// The requests the page may make of the Swift half, and nothing else.
const OPERATIONS: [&str; 5] = [
    "products",
    "purchase",
    "outstanding",
    "finish",
    "signInWithApple",
];

/// Requests sent to the Swift half and not yet answered, by id: each waits
/// for `(ok, json)`.
type Pending = Mutex<HashMap<u64, mpsc::Sender<(bool, String)>>>;

static APP: OnceLock<AppHandle> = OnceLock::new();
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static PENDING: OnceLock<Pending> = OnceLock::new();

fn pending() -> &'static Pending {
    PENDING.get_or_init(|| Mutex::new(HashMap::new()))
}

/// The Swift half's answer to one request.
extern "C" fn on_reply(id: u64, json: *const c_char, ok: bool) {
    let text = if json.is_null() {
        String::from("{}")
    } else {
        // SAFETY: Swift passes a NUL-terminated UTF-8 string that lives for the
        // duration of this call; it is copied before returning.
        unsafe { CStr::from_ptr(json) }
            .to_string_lossy()
            .into_owned()
    };
    let sender = pending().lock().ok().and_then(|mut p| p.remove(&id));
    if let Some(sender) = sender {
        let _ = sender.send((ok, text));
    }
}

/// A transaction StoreKit delivered with nobody waiting for it. The page
/// redeems it exactly as it redeems one it bought.
extern "C" fn on_transaction(json: *const c_char) {
    if json.is_null() {
        return;
    }
    // SAFETY: as in `on_reply`.
    let text = unsafe { CStr::from_ptr(json) }
        .to_string_lossy()
        .into_owned();
    if let (Some(app), Ok(value)) = (APP.get(), serde_json::from_str::<serde_json::Value>(&text)) {
        let _ = app.emit("store-transaction", value);
    }
}

/// One request to StoreKit or Apple's sign-in sheet, answered when the
/// person has finished with whatever sheet it showed.
#[tauri::command]
pub async fn store_call(op: String, arg: serde_json::Value) -> Result<serde_json::Value, String> {
    if !OPERATIONS.contains(&op.as_str()) {
        return Err(format!("unknown request {op}"));
    }
    let op_c = CString::new(op).map_err(|e| e.to_string())?;
    let arg_c = CString::new(arg.to_string()).map_err(|e| e.to_string())?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    let (tx, rx) = mpsc::channel();
    pending().lock().map_err(|e| e.to_string())?.insert(id, tx);
    // SAFETY: both strings outlive the call, which copies them before
    // returning; `on_reply` is a plain function with the C ABI.
    unsafe { opensubs_store_call(id, op_c.as_ptr(), arg_c.as_ptr(), on_reply) };
    let (ok, text) = tauri::async_runtime::spawn_blocking(move || rx.recv())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|_| "the App Store request was dropped".to_string())?;
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if ok {
        Ok(value)
    } else {
        Err(value
            .get("message")
            .and_then(|m| m.as_str())
            .unwrap_or("the App Store request failed")
            .to_string())
    }
}

/// Every command the store build answers; `$extra` adds the test build's.
macro_rules! store_handlers {
    ($($extra:path),*) => {
        tauri::generate_handler![
            commands::probe,
            commands::list_styles,
            commands::list_features,
            commands::list_languages,
            commands::translation_ready,
            commands::export_style,
            commands::store_cmds::store_check_ffmpeg,
            models::list_downloadable_models,
            models::download_model,
            models::describe_model,
            commands::get_model_path,
            commands::set_model_path,
            commands::burn,
            commands::transcribe_for_cloud,
            commands::close_window,
            commands::store_cmds::reveal,
            commands::store_cmds::output_in,
            store_call,
            $($extra),*
        ]
    };
}

/// The store build's entry point, in place of `lib.rs`'s.
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(cloud::PendingTranscripts::default())
        .setup(|app| {
            let _ = APP.set(app.handle().clone());
            // Before the window asks for anything: a transaction that arrives
            // with no listener is delivered again only on the next launch.
            // SAFETY: `on_transaction` is a plain function with the C ABI.
            unsafe { opensubs_store_start(on_transaction) };
            #[cfg(feature = "appstore-test")]
            smoke::start(app.handle());
            Ok(())
        });
    #[cfg(not(feature = "appstore-test"))]
    let builder = builder.invoke_handler(store_handlers![]);
    #[cfg(feature = "appstore-test")]
    let builder = builder.invoke_handler(store_handlers![smoke::smoke_report]);
    builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// The `test` build's hook (scripts/build-appstore.sh test; never in a build
/// for the store): drives the real window with no clicks and no keystrokes.
///
/// `OPENSUBS_STORE_SMOKE` names a script inside the app's container. Once the
/// main window has loaded, the script runs in it -- with the page's own
/// `window.__TAURI_INTERNALS__.invoke`, so every call goes through the same
/// IPC, capability and sandbox as a click would -- and calls
/// `smoke_report(text)` when it is done. The text is written beside the
/// script as `<script>.result.json` and the app quits.
/// scripts/appstore-smoke.sh is the script that uses it.
#[cfg(feature = "appstore-test")]
mod smoke {
    use std::path::PathBuf;
    use tauri::{AppHandle, Manager};

    fn script() -> Option<PathBuf> {
        std::env::var_os("OPENSUBS_STORE_SMOKE").map(PathBuf::from)
    }

    pub fn start(app: &AppHandle) {
        let Some(path) = script() else { return };
        let app = app.clone();
        std::thread::spawn(move || {
            // The page needs a moment to load its own modules.
            std::thread::sleep(std::time::Duration::from_secs(4));
            let js = match std::fs::read_to_string(&path) {
                Ok(js) => js,
                Err(e) => {
                    let _ = std::fs::write(
                        path.with_extension("result.json"),
                        format!("{{\"error\":\"read {e}\"}}"),
                    );
                    app.exit(3);
                    return;
                }
            };
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.eval(&js);
            }
        });
    }

    #[tauri::command]
    pub fn smoke_report(app: AppHandle, text: String) -> Result<(), String> {
        let path = script().ok_or("no OPENSUBS_STORE_SMOKE")?;
        std::fs::write(path.with_extension("result.json"), text).map_err(|e| e.to_string())?;
        app.exit(0);
        Ok(())
    }
}
