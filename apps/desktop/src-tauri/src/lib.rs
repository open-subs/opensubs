//! The opensubs desktop shell: a Tauri 2 window around the already-tested
//! `subs-*` engine crates. See `commands` for the whole command surface.

mod commands;
mod models;
mod settings;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::probe,
            commands::list_styles,
            commands::list_features,
            commands::list_languages,
            commands::translation_ready,
            commands::export_style,
            commands::check_ffmpeg,
            // Pre-existing gap: the ffmpeg-missing banner has always called
            // this, but it was never registered, so the Homebrew install
            // button failed with "command not found".
            commands::install_ffmpeg,
            models::list_downloadable_models,
            models::download_model,
            commands::get_model_path,
            commands::set_model_path,
            commands::burn,
            commands::reveal,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
