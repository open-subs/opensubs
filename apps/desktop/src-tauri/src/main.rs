// Prevents an additional console window on Windows in release builds, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    opensubs_desktop_lib::run()
}
