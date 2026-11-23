fn main() {
    // The release workflow asks for an MSVC linker map of the app's exe, at
    // a path it chooses, so its instruction check can tell which library
    // every function came from (scripts/check-isa.py). Only the
    // binary gets one: a RUSTFLAGS-wide /MAP also links build scripts and
    // the cdylib, and leaves the map wherever link.exe decides.
    println!("cargo:rerun-if-env-changed=OPENSUBS_LINKER_MAP");
    if let Ok(path) = std::env::var("OPENSUBS_LINKER_MAP") {
        let msvc = std::env::var("CARGO_CFG_TARGET_ENV").as_deref() == Ok("msvc");
        if msvc && !path.is_empty() {
            println!("cargo:rustc-link-arg-bin=opensubs-desktop=/MAP:{path}");
        }
    }
    // The Mac App Store build's StoreKit and Sign in with Apple, compiled
    // and linked only with the `appstore` feature.
    if std::env::var_os("CARGO_FEATURE_APPSTORE").is_some() {
        appstore_bridge();
    }
    tauri_build::build()
}

/// Compile appstore/StoreBridge.swift into a static library and link it,
/// with the frameworks and the Swift runtime it needs. macOS 13, like the
/// store build's ffmpeg; the Swift runtime is the system's.
fn appstore_bridge() {
    use std::process::Command;
    let source = "appstore/StoreBridge.swift";
    println!("cargo:rerun-if-changed={source}");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() != Ok("macos") {
        panic!("the appstore feature is for the Mac App Store build only");
    }
    let arch = match std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() {
        Ok("aarch64") => "arm64",
        Ok("x86_64") => "x86_64",
        other => panic!("no Mac App Store build for {other:?}"),
    };
    let out = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let lib = out.join("libopensubs_store.a");
    let status = Command::new("xcrun")
        .args([
            "swiftc",
            "-parse-as-library",
            "-swift-version",
            "5",
            "-O",
            "-whole-module-optimization",
        ])
        .args([
            "-target",
            &format!("{arch}-apple-macos13.0"),
            "-module-name",
            "OpenSubsStore",
        ])
        .args(["-emit-library", "-static", "-o"])
        .arg(&lib)
        .arg(source)
        .status()
        .expect("xcrun swiftc runs");
    assert!(status.success(), "swiftc failed on {source}");
    let text = |args: &[&str]| {
        let o = Command::new("xcrun")
            .args(args)
            .output()
            .expect("xcrun runs");
        String::from_utf8(o.stdout)
            .expect("utf-8")
            .trim()
            .to_string()
    };
    let sdk = text(&["--sdk", "macosx", "--show-sdk-path"]);
    let swiftc = text(&["--find", "swiftc"]);
    let toolchain_lib = std::path::Path::new(&swiftc)
        .parent()
        .and_then(|b| b.parent())
        .map(|t| t.join("lib/swift/macosx"));
    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=opensubs_store");
    println!("cargo:rustc-link-search=native={sdk}/usr/lib/swift");
    if let Some(dir) = toolchain_lib {
        println!("cargo:rustc-link-search=native={}", dir.display());
    }
    for framework in ["StoreKit", "AuthenticationServices", "AppKit", "Foundation"] {
        println!("cargo:rustc-link-lib=framework={framework}");
    }
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
}
