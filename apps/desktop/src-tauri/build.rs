fn main() {
    // The release workflow asks for an MSVC linker map of the app's exe, at
    // a path it chooses, so its instruction check can tell which library
    // every function came from (scripts/check-windows-isa.py). Only the
    // binary gets one: a RUSTFLAGS-wide /MAP also links build scripts and
    // the cdylib, and leaves the map wherever link.exe decides.
    println!("cargo:rerun-if-env-changed=OPENSUBS_LINKER_MAP");
    if let Ok(path) = std::env::var("OPENSUBS_LINKER_MAP") {
        let msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
        if msvc && !path.is_empty() {
            println!("cargo:rustc-link-arg-bin=opensubs-desktop=/MAP:{path}");
        }
    }
    tauri_build::build()
}
