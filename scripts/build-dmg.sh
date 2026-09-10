#!/usr/bin/env bash
# Build a distributable opensubs .dmg on macOS.
#
# Run this on a real Mac, not in a VM: the release build wants ~2 GB of disk
# and benefits from native CPU. It produces dist/opensubs-<version>-<arch>.dmg
# containing the CLI, an installer, and a README.
#
# ---------------------------------------------------------------------------
# WHAT THIS DOES *NOT* BUNDLE, AND WHY
#
# ffmpeg is not included. opensubs drives ffmpeg as a separate process, and
# the build it needs carries libass (to render subtitles) and whisper (for
# speech recognition). Homebrew's plain `ffmpeg` formula has NEITHER -- the
# `ass`, `subtitles` and `whisper` filters are simply absent from it, and a
# burn against that binary fails with "No such filter: ass".
#
# The build that works is `ffmpeg-full`. Bundling it here was considered and
# rejected: `otool -L` reports 61 Homebrew dylib dependencies, so shipping it
# would mean relocating all of them with install_name_tool -- fragile, and
# impossible to verify from a machine other than the target. Requiring a
# one-line `brew install ffmpeg-full` is the honest trade.
#
# opensubs checks for the `ass` filter at startup and exits with a clear
# message if it is missing, so a user without ffmpeg-full gets told what to do
# rather than a cryptic ffmpeg error.
#
# ---------------------------------------------------------------------------
# SIGNING
#
# The .dmg is UNSIGNED. macOS Gatekeeper will refuse to run the binary on
# first launch; the README tells the user how to clear the quarantine flag.
# To sign properly, set these before running and the script will use them:
#
#   export OPENSUBS_SIGN_ID="Developer ID Application: Your Name (TEAMID)"
#   export OPENSUBS_NOTARY_PROFILE="your-notarytool-keychain-profile"
#
# Both are optional. Without them you still get a working .dmg for personal use.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VERSION="$(grep -m1 '^version' Cargo.toml | sed -E 's/.*"([^"]+)".*/\1/')"
ARCH="$(uname -m)"
STAGE="$(mktemp -d)"
DIST="$REPO_ROOT/dist"
VOLNAME="opensubs $VERSION"
DMG="$DIST/opensubs-${VERSION}-${ARCH}.dmg"

cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

say() { printf '\033[1m==>\033[0m %s\n' "$1"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$1" >&2; exit 1; }

# --- what to build --------------------------------------------------------
# Default is the GUI app, which is what most people want. --cli builds the
# command-line tool instead; --both builds each into its own image.
BUILD_GUI=1
BUILD_CLI=0
case "${1:-}" in
  --cli)   BUILD_GUI=0; BUILD_CLI=1 ;;
  --gui|"") ;;
  --both)  BUILD_CLI=1 ;;
  -h|--help)
    cat <<USAGE
usage: build-dmg.sh [--gui | --cli | --both]

  --gui    (default) the opensubs desktop app -> opensubs_<ver>_<arch>.dmg
  --cli    the opensubs command-line tool     -> opensubs-<ver>-<arch>.dmg
  --both   both images

Signing (optional, both targets):
  export OPENSUBS_SIGN_ID="Developer ID Application: Name (TEAMID)"
  export OPENSUBS_NOTARY_PROFILE="notarytool-keychain-profile"
USAGE
    exit 0 ;;
  *) die "unknown option '$1' (try --help)" ;;
esac

[ "$(uname -s)" = "Darwin" ] || die "this script builds a .dmg and only runs on macOS"

# --- toolchain ------------------------------------------------------------
command -v cargo >/dev/null 2>&1 || die "cargo not found. Install Rust from https://rustup.rs"
command -v hdiutil >/dev/null 2>&1 || die "hdiutil not found (expected on macOS)"
if [ "$BUILD_GUI" = 1 ]; then
  command -v npm >/dev/null 2>&1 || die "npm not found. The GUI needs Node -- https://nodejs.org"
fi

# --- disk headroom --------------------------------------------------------
# A release build of this workspace needs roughly 2 GB. Checking up front
# beats dying two thirds of the way through a ten-minute compile.
AVAIL_KB="$(df -k . | awk 'NR==2 {print $4}')"
if [ "$AVAIL_KB" -lt 2500000 ]; then
  die "only $((AVAIL_KB / 1024)) MB free; the release build needs ~2 GB. Free space and retry."
fi

# ===========================================================================
# GUI: the Tauri desktop app
# ===========================================================================
if [ "$BUILD_GUI" = 1 ]; then
  say "building the opensubs desktop app $VERSION for $ARCH (release)"
  DESKTOP="$REPO_ROOT/apps/desktop"
  [ -d "$DESKTOP" ] || die "apps/desktop not found"

  ( cd "$DESKTOP" && [ -d node_modules ] || npm ci --silent || npm install --silent )

  # The Tauri CLI can come from either package manager. @tauri-apps/cli is a
  # devDependency, so npm install above already provides it -- prefer that over
  # making the user sit through `cargo install tauri-cli`, but use a
  # cargo-installed one if that is what they have.
  if [ -x "$DESKTOP/node_modules/.bin/tauri" ]; then
    TAURI_BUILD='npm run --silent tauri -- build'
  elif cargo tauri --version >/dev/null 2>&1; then
    TAURI_BUILD='cargo tauri build'
  else
    die "no Tauri CLI. Either 'npm install' in apps/desktop, or: cargo install tauri-cli --version '^2'"
  fi

  # Tauri's bundler produces the .app and .dmg itself; it needs no hdiutil
  # staging from us. `--no-bundle` would give only the binary.
  ( cd "$DESKTOP" && eval "$TAURI_BUILD" )

  # Find the bundle. The workspace may redirect CARGO_TARGET_DIR, so ask cargo
  # rather than assuming ./target.
  TARGET_DIR="$(cargo metadata --format-version 1 --no-deps 2>/dev/null \
                | sed -E 's/.*"target_directory":"([^"]+)".*/\1/')"
  [ -n "$TARGET_DIR" ] || TARGET_DIR="$REPO_ROOT/target"

  GUI_DMG="$(find "$TARGET_DIR/release/bundle/dmg" -name '*.dmg' -maxdepth 1 2>/dev/null | head -1)"
  GUI_APP="$(find "$TARGET_DIR/release/bundle/macos" -name '*.app' -maxdepth 1 2>/dev/null | head -1)"

  [ -n "$GUI_APP" ] || die "tauri build finished but produced no .app bundle"

  mkdir -p "$DIST"
  if [ -n "$GUI_DMG" ]; then
    cp "$GUI_DMG" "$DIST/"
    GUI_OUT="$DIST/$(basename "$GUI_DMG")"
  else
    # Tauri occasionally skips the dmg step (it shells out to AppleScript for
    # the window layout, which fails on headless machines). The .app is the
    # real artifact, so package it ourselves rather than failing the build.
    say "tauri produced no .dmg -- packaging the .app directly"
    GUI_STAGE="$(mktemp -d)"
    cp -R "$GUI_APP" "$GUI_STAGE/"
    ln -s /Applications "$GUI_STAGE/Applications"
    GUI_OUT="$DIST/$(basename "$GUI_APP" .app)_${VERSION}_${ARCH}.dmg"
    rm -f "$GUI_OUT"
    hdiutil create -quiet -volname "$VOLNAME" -srcfolder "$GUI_STAGE" \
      -ov -format UDZO "$GUI_OUT"
    rm -rf "$GUI_STAGE"
  fi

  # Verify: mount it and confirm the .app is present and executable.
  say "verifying the app image"
  GMNT="$(mktemp -d)"
  hdiutil attach -quiet -nobrowse -readonly -mountpoint "$GMNT" "$GUI_OUT"
  MOUNTED_APP="$(find "$GMNT" -maxdepth 1 -name '*.app' | head -1)"
  if [ -z "$MOUNTED_APP" ]; then
    hdiutil detach -quiet "$GMNT" || true
    die "the .dmg mounts but contains no .app"
  fi
  # The executable inside the bundle is the CRATE name, which need not match
  # the .app name (productName in tauri.conf.json) -- e.g. OpenSubs.app's
  # binary is opensubs-desktop. Read Info.plist rather than guessing.
  APP_EXE="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' \
             "$MOUNTED_APP/Contents/Info.plist" 2>/dev/null || true)"
  [ -n "$APP_EXE" ] || APP_EXE="$(basename "$MOUNTED_APP" .app)"
  APP_BIN="$MOUNTED_APP/Contents/MacOS/$APP_EXE"
  if [ ! -x "$APP_BIN" ]; then
    hdiutil detach -quiet "$GMNT" || true
    die "the .app declares CFBundleExecutable '$APP_EXE' but Contents/MacOS/$APP_EXE is not executable"
  fi
  # Confirm it is a real Mach-O binary for this architecture, not a stub.
  file -b "$APP_BIN" | grep -qi "Mach-O.*executable" \
    || { hdiutil detach -quiet "$GMNT" || true; die "$APP_EXE is not a Mach-O executable"; }
  hdiutil detach -quiet "$GMNT"; rmdir "$GMNT" 2>/dev/null || true

  say "GUI done"
  printf '\n  %s\n  %s\n\n' "$GUI_OUT" "$(du -h "$GUI_OUT" | cut -f1)"

  [ "$BUILD_CLI" = 1 ] || {
    if [ -z "${OPENSUBS_SIGN_ID:-}" ]; then
      printf '  NOTE: unsigned. First launch: right-click the app > Open, or\n'
      printf '        xattr -dr com.apple.quarantine /Applications/%s\n\n' "$(basename "$GUI_APP")"
    fi
    printf '  Requires ffmpeg with libass + whisper:  brew install ffmpeg-full\n\n'
    exit 0
  }
fi

# ===========================================================================
# CLI: the command-line tool
# ===========================================================================
say "building opensubs $VERSION for $ARCH (release)"
cargo build --release -p opensubs

BIN="target/release/opensubs"
# Honour a workspace CARGO_TARGET_DIR if one is configured.
if [ ! -x "$BIN" ]; then
  ALT="$(cargo metadata --format-version 1 --no-deps 2>/dev/null \
        | sed -E 's/.*"target_directory":"([^"]+)".*/\1/')/release/opensubs"
  [ -x "$ALT" ] && BIN="$ALT"
fi
[ -x "$BIN" ] || die "build succeeded but $BIN is missing"

say "built $(du -h "$BIN" | cut -f1) binary"

# --- optional signing -----------------------------------------------------
if [ -n "${OPENSUBS_SIGN_ID:-}" ]; then
  say "signing binary as $OPENSUBS_SIGN_ID"
  codesign --force --options runtime --timestamp --sign "$OPENSUBS_SIGN_ID" "$BIN"
  codesign --verify --verbose "$BIN"
else
  say "no OPENSUBS_SIGN_ID set -- producing an UNSIGNED .dmg (fine for personal use)"
fi

# --- stage ----------------------------------------------------------------
say "staging payload"
mkdir -p "$STAGE/opensubs"
cp "$BIN" "$STAGE/opensubs/opensubs"
chmod +x "$STAGE/opensubs/opensubs"

for f in LICENSE-MIT LICENSE-APACHE; do
  [ -f "$REPO_ROOT/../$f" ] && cp "$REPO_ROOT/../$f" "$STAGE/opensubs/" || true
done

cat > "$STAGE/opensubs/install.sh" <<'INSTALL'
#!/usr/bin/env bash
# Install opensubs to /usr/local/bin (or ~/.local/bin without sudo).
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -w /usr/local/bin ] 2>/dev/null; then
  DEST=/usr/local/bin
elif sudo -n true 2>/dev/null; then
  DEST=/usr/local/bin
else
  DEST="$HOME/.local/bin"
  mkdir -p "$DEST"
  echo "note: /usr/local/bin not writable, installing to $DEST"
  case ":$PATH:" in
    *":$DEST:"*) ;;
    *) echo "      add it to PATH:  echo 'export PATH=\"$DEST:\$PATH\"' >> ~/.zshrc" ;;
  esac
fi

if [ -w "$DEST" ]; then
  cp "$HERE/opensubs" "$DEST/opensubs"
else
  sudo cp "$HERE/opensubs" "$DEST/opensubs"
fi
chmod +x "$DEST/opensubs" 2>/dev/null || sudo chmod +x "$DEST/opensubs"

# Unsigned binaries carry a quarantine flag after being copied off a .dmg.
xattr -d com.apple.quarantine "$DEST/opensubs" 2>/dev/null || true

echo "installed: $DEST/opensubs"
echo
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "NEXT: opensubs needs ffmpeg with libass and whisper:"
  echo "      brew install ffmpeg-full"
  echo "      export PATH=\"/opt/homebrew/opt/ffmpeg-full/bin:\$PATH\""
elif ! ffmpeg -hide_banner -filters 2>/dev/null | awk '{print $2}' | grep -qx ass; then
  echo "WARNING: the ffmpeg on your PATH has no libass, so burning will fail."
  echo "         brew install ffmpeg-full"
  echo "         export PATH=\"/opt/homebrew/opt/ffmpeg-full/bin:\$PATH\""
else
  echo "ffmpeg with libass found. Try:  opensubs styles"
fi
INSTALL
chmod +x "$STAGE/opensubs/install.sh"

cat > "$STAGE/opensubs/README.txt" <<README
opensubs $VERSION ($ARCH)

Burn auto-generated subtitles into a video. Import -> ASR -> style -> burn.


INSTALL
---------------------------------------------------------------------------
  ./install.sh

Installs to /usr/local/bin (or ~/.local/bin if that is not writable).


REQUIREMENT: ffmpeg with libass and whisper
---------------------------------------------------------------------------
opensubs drives ffmpeg as a separate process. Homebrew's plain "ffmpeg"
formula does NOT carry libass or whisper -- burning fails against it with
"No such filter: ass". Install the full build:

  brew install ffmpeg-full
  export PATH="/opt/homebrew/opt/ffmpeg-full/bin:\$PATH"

opensubs checks for this at startup and tells you if it is missing.


A SPEECH MODEL (for automatic subtitles)
---------------------------------------------------------------------------
Download a whisper.cpp ggml model, e.g.

  mkdir -p ~/.cache/opensubs-models && cd ~/.cache/opensubs-models
  curl -LO https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin

Larger models are more accurate and slower:
  ggml-tiny.en.bin    ~75 MB   fastest, roughest
  ggml-base.en.bin   ~148 MB   good default
  ggml-large-v3-turbo.bin ~1.6 GB  best quality, multilingual


USAGE
---------------------------------------------------------------------------
  opensubs burn video.mp4 --model ~/.cache/opensubs-models/ggml-base.en.bin

  opensubs burn video.mp4 \\
      --model ~/.cache/opensubs-models/ggml-base.en.bin \\
      --style Shorts \\
      --srt subtitles.srt \\
      -o subtitled.mp4

  opensubs styles          list the six built-in styles
  opensubs probe video.mp4 inspect a file
  opensubs burn --help     all options

Styles: Clean, Bold, Boxed, Shorts, Caption, CJK


QUALITY NOTES
---------------------------------------------------------------------------
Audio is stream-copied, never re-encoded -- the audio in the output is
bit-identical to the input. Colour metadata is preserved rather than
defaulting to BT.709, variable frame rate is passed through instead of being
forced to constant, and rotated phone video keeps its orientation.

Video must be re-encoded to burn subtitles in. The default is x264 CRF 16 at
preset slow, which is visually near-lossless and slow. Use --fast for
hardware encoding, or --crf/--preset to tune.


GATEKEEPER (unsigned builds)
---------------------------------------------------------------------------
If macOS refuses to run it ("cannot be opened because the developer cannot be
verified"), install.sh already clears the quarantine flag. To do it manually:

  xattr -d com.apple.quarantine /usr/local/bin/opensubs
README

# --- build the dmg --------------------------------------------------------
say "creating disk image"
mkdir -p "$DIST"
rm -f "$DMG"
hdiutil create -quiet \
  -volname "$VOLNAME" \
  -srcfolder "$STAGE/opensubs" \
  -ov -format UDZO \
  "$DMG"

[ -f "$DMG" ] || die "hdiutil reported success but $DMG does not exist"

# --- optional notarisation ------------------------------------------------
if [ -n "${OPENSUBS_NOTARY_PROFILE:-}" ]; then
  say "submitting for notarisation (this can take several minutes)"
  xcrun notarytool submit "$DMG" --keychain-profile "$OPENSUBS_NOTARY_PROFILE" --wait
  xcrun stapler staple "$DMG"
fi

# --- verify ---------------------------------------------------------------
# Mount what we just built and run the binary out of it. A .dmg that exists
# but contains a broken payload is worse than a failed build.
say "verifying the image"
MNT="$(mktemp -d)"
hdiutil attach -quiet -nobrowse -readonly -mountpoint "$MNT" "$DMG"
verify_cleanup() { hdiutil detach -quiet "$MNT" 2>/dev/null || true; rmdir "$MNT" 2>/dev/null || true; cleanup; }
trap verify_cleanup EXIT

[ -x "$MNT/opensubs" ] || die "the .dmg does not contain an executable opensubs"
[ -f "$MNT/README.txt" ] || die "the .dmg is missing README.txt"
[ -x "$MNT/install.sh" ] || die "the .dmg is missing install.sh"

MOUNTED_VERSION="$("$MNT/opensubs" --version 2>/dev/null || true)"
"$MNT/opensubs" styles >/dev/null 2>&1 \
  || die "opensubs from the mounted image failed to run"

hdiutil detach -quiet "$MNT"
trap cleanup EXIT

say "done"
printf '\n  %s\n  %s\n\n' "$DMG" "$(du -h "$DMG" | cut -f1)"
[ -n "$MOUNTED_VERSION" ] && printf '  verified: %s runs from the mounted image\n\n' "$MOUNTED_VERSION"
if [ -z "${OPENSUBS_SIGN_ID:-}" ]; then
  printf '  NOTE: unsigned. See the Gatekeeper section of README.txt inside the image.\n\n'
fi
