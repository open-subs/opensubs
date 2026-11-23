#!/usr/bin/env bash
# Build OpenSubs for the Mac App Store.
#
#   apps/desktop/scripts/build-appstore.sh test    # sandboxed, development-signed, runs on this Mac
#   apps/desktop/scripts/build-appstore.sh store   # signed for the store, packaged as a .pkg
#
# Two modes because a store-signed app does not run anywhere but the store:
# signed with Apple Distribution and carrying the Mac App Store profile, macOS
# refuses to launch it locally. So `test` builds the same sandboxed app,
# signed with the Apple Development certificate and the sandbox entitlements
# only -- enough to prove that opening a video, transcribing, translating,
# burning with the bundled ffmpeg and saving all work inside the sandbox.
# Sign in with Apple and StoreKit need the store profile, so they are only
# exercised by the TestFlight build. `store` produces what App Store Connect
# accepts, and stops there: this script never sends anything to Apple.
#
# What differs from the direct-download build (`npx tauri build`, unchanged):
#   - bundle id app.opensubs.mobile, the iOS app's, so the Mac app joins the
#     same App Store record and the same credit packs (universal purchase);
#     a build number per upload;
#   - the Cargo feature `appstore` (src-tauri/src/store.rs): StoreKit and Sign
#     in with Apple (appstore/StoreBridge.swift), no ffmpeg install, only the
#     bundled ffmpeg, exports saved to a folder the person picks;
#   - the page built with OPENSUBS_STORE=1 (vite.config.ts): credits through
#     StoreKit instead of the card checkout, account deletion in the app;
#   - ffmpeg and ffprobe are the LGPL build from ffmpeg-lgpl.sh, not the GPL
#     download fetch-bundled.sh makes, signed as helpers in the app's sandbox,
#     with their licences and complete source under Resources/licences/ffmpeg;
#   - the App Sandbox (appstore/OpenSubs.entitlements), a privacy manifest
#     (appstore/PrivacyInfo.xcprivacy), NOTICE and LICENSE in the bundle;
#   - Apple silicon only, like the direct-download Mac build.
#
# `test` also compiles in the hook scripts/appstore-smoke.sh drives the
# window with (Cargo feature appstore-test); `store` refuses to finish if it
# is there.
#
# Environment:
#   OPENSUBS_PROFILE      the Mac App Store provisioning profile for
#                         app.opensubs.mobile (default: src-tauri/appstore/
#                         embedded.provisionprofile, which
#                         `apps/mobile/scripts/asc.py ensure-mac-profile` writes)
#   OPENSUBS_ALLOW_NO_PROFILE=1   build and sign the .pkg without one, to
#                         inspect it. Such a package cannot be uploaded.
#   APPSTORE_OUT          where to put the result (default: apps/desktop/build-appstore/<mode>)
set -euo pipefail

MODE="${1:-test}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"          # apps/desktop/scripts
DESKTOP="$(cd "$HERE/.." && pwd)"                             # apps/desktop
TAURI="$DESKTOP/src-tauri"
STORE="$TAURI/appstore"
ROOT="$(cd "$DESKTOP/../.." && pwd)"
TEAM="JY2NWT5QFV"
BUNDLE_ID="app.opensubs.mobile"
identity() { security find-identity -v ${2:-} | sed -n "s/.*\"\($1: [^\"]*($TEAM)\)\".*/\1/p" | head -1; }
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$TAURI/tauri.conf.json")"
OUT="${APPSTORE_OUT:-$DESKTOP/build-appstore/$MODE}"
APP="$OUT/OpenSubs.app"
LGPL="$TAURI/bundled/ffmpeg-lgpl"

say() { printf '\n== %s\n' "$1"; }
die() { echo "build-appstore: $1" >&2; exit 1; }

case "$MODE" in test|store) ;; *) die "mode is test or store -- not '$MODE'" ;; esac
[ "$(uname -m)" = arm64 ] || die "the store build is Apple silicon only, like its ffmpeg"

if [ "$MODE" = test ]; then
  IDENTITY="$(security find-identity -v -p codesigning | sed -n 's/.*"\(Apple Development: [^"]*\)".*/\1/p' | head -1)"
  [ -n "$IDENTITY" ] || die "no Apple Development certificate in the keychain"
else
  IDENTITY="$(identity "Apple Distribution" "-p codesigning")"
  PKG_IDENTITY="$(identity "3rd Party Mac Developer Installer")"
  [ -n "$PKG_IDENTITY" ] || PKG_IDENTITY="$(identity "Mac Installer Distribution")"
  [ -n "$IDENTITY" ] || die "no Apple Distribution certificate for team $TEAM"
  [ -n "$PKG_IDENTITY" ] || die "no Mac Installer Distribution certificate for team $TEAM"
  PROFILE="${OPENSUBS_PROFILE:-$STORE/embedded.provisionprofile}"
  if [ ! -f "$PROFILE" ]; then
    [ "${OPENSUBS_ALLOW_NO_PROFILE:-0}" = 1 ] || die "no provisioning profile at $PROFILE: apps/mobile/scripts/asc.py ensure-mac-profile writes it. OPENSUBS_ALLOW_NO_PROFILE=1 builds one that cannot be uploaded"
    PROFILE=""
  fi
fi
echo "  $MODE build of OpenSubs $VERSION ($BUNDLE_ID), signed by: $IDENTITY"

if pgrep -f "$APP/Contents/MacOS/" >/dev/null 2>&1; then
  die "OpenSubs is running from $APP. Quit it first."
fi

# --- what the bundle carries ----------------------------------------------------
say "the models and the LGPL ffmpeg"
for f in models/ggml-base.bin models/m2m100/model.bin models/m2m100/config.json \
         models/m2m100/shared_vocabulary.json models/m2m100/sentencepiece.bpe.model; do
  [ -s "$TAURI/bundled/$f" ] || die "no bundled/$f: run apps/desktop/scripts/fetch-bundled.sh"
done
if [ ! -x "$LGPL/ffmpeg" ] || [ ! -x "$LGPL/ffprobe" ] || [ "$LGPL/BUILD.txt" -ot "$HERE/ffmpeg-lgpl.sh" ]; then
  "$HERE/ffmpeg-lgpl.sh" "$LGPL"
fi
"$LGPL/ffmpeg" -hide_banner -L 2>&1 | tr -s ' \n' ' ' | grep -c "GNU Lesser General Public License" >/dev/null || die "the ffmpeg in $LGPL is not LGPL"
if "$LGPL/ffmpeg" -hide_banner -buildconf | grep -cE -- '--enable-(gpl|nonfree|version3)' >/dev/null; then die "the ffmpeg in $LGPL has a GPL or nonfree part"; fi
echo "  $(sed -n 1p "$LGPL/BUILD.txt" | cut -c1-24)..., LGPL"

# --- the app ----------------------------------------------------------------------
say "the app (cargo feature appstore, page built with OPENSUBS_STORE=1)"
BUILD_NUMBER=$(( ($(date +%s) - 1577836800) / 60 ))
# Every source path the compilers record (a panic's file name, an assertion's
# __FILE__) would otherwise name this Mac's home, through the Cargo registry,
# the checkout and the C++ engines' build folders. They are rewritten to
# neutral prefixes. A target folder of its own, because changing RUSTFLAGS
# rebuilds everything, and the direct-download build's cache stays as it was.
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-$ROOT/appstore-target}"
export RUSTFLAGS="${RUSTFLAGS:-} --remap-path-prefix=$ROOT=/opensubs --remap-path-prefix=$HOME/.cargo=/cargo --remap-path-prefix=$HOME/.rustup=/rustup"
export CFLAGS="${CFLAGS:-} -ffile-prefix-map=$ROOT=/opensubs -ffile-prefix-map=$HOME/.cargo=/cargo"
export CXXFLAGS="${CXXFLAGS:-} -ffile-prefix-map=$ROOT=/opensubs -ffile-prefix-map=$HOME/.cargo=/cargo"
# The test build adds the hook scripts/appstore-smoke.sh drives it by
# (store.rs, `smoke`); the store build has no such thing.
FEATURES=appstore; [ "$MODE" = test ] && FEATURES=appstore-test
( cd "$DESKTOP" && CARGO_INCREMENTAL=0 npx tauri build --ci --no-sign --bundles app --features "$FEATURES" \
    --config src-tauri/appstore/tauri.appstore.conf.json )
BUILT="$CARGO_TARGET_DIR/release/bundle/macos/OpenSubs.app"
[ -d "$BUILT" ] || die "tauri built no $BUILT"
rm -rf "$OUT" && mkdir -p "$OUT"
ditto "$BUILT" "$APP"

say "Info.plist"
PLIST="$APP/Contents/Info.plist"
pb() { /usr/libexec/PlistBuddy -c "$1" "$PLIST" >/dev/null 2>&1 || /usr/libexec/PlistBuddy -c "$2" "$PLIST" >/dev/null; }
# A build number of its own: App Store Connect refuses a second upload with a
# CFBundleVersion it has seen, and never releases one back. Minutes since 2020
# always grows and needs no state.
pb "Set :CFBundleVersion $BUILD_NUMBER" "Add :CFBundleVersion string $BUILD_NUMBER"
pb "Set :CFBundleShortVersionString $VERSION" "Add :CFBundleShortVersionString string $VERSION"
pb "Set :LSMinimumSystemVersion 13.0" "Add :LSMinimumSystemVersion string 13.0"
pb "Set :LSApplicationCategoryType public.app-category.video" "Add :LSApplicationCategoryType string public.app-category.video"
# HTTPS and Apple's own frameworks only: exempt.
pb "Set :ITSAppUsesNonExemptEncryption false" "Add :ITSAppUsesNonExemptEncryption bool false"
plutil -lint "$PLIST" >/dev/null
[ "$(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST")" = "$BUNDLE_ID" ] || die "the bundle id is not $BUNDLE_ID"

say "licences, the ffmpeg source, the privacy manifest"
RES="$APP/Contents/Resources"
mkdir -p "$RES/licences/ffmpeg/source"
cp "$STORE/NOTICE" "$ROOT/LICENSE" "$RES/licences/"
cp "$LGPL"/licences/* "$LGPL/BUILD.txt" "$RES/licences/ffmpeg/"
cp "$LGPL"/src/* "$RES/licences/ffmpeg/source/"
cp "$STORE/PrivacyInfo.xcprivacy" "$RES/PrivacyInfo.xcprivacy"
for f in licences/NOTICE licences/LICENSE licences/ffmpeg/BUILD.txt licences/ffmpeg/ffmpeg-COPYING.LGPLv2.1 \
         licences/ffmpeg/source/ffmpeg-7.1.1.tar.xz PrivacyInfo.xcprivacy models/ggml-base.bin models/m2m100/model.bin; do
  [ -s "$RES/$f" ] || die "the bundle has no Resources/$f"
done

say "the bundle, checked"
for tool in ffmpeg ffprobe; do
  cmp -s "$RES/vendor/$tool" "$LGPL/$tool" || die "Resources/vendor/$tool is not the LGPL build"
done
"$RES/vendor/ffmpeg" -hide_banner -L 2>&1 | tr -s ' \n' ' ' | grep -c "GNU Lesser General Public License" >/dev/null || die "the bundled ffmpeg is not LGPL"
BIN="$APP/Contents/MacOS/opensubs-desktop"
[ -x "$BIN" ] || die "no $BIN"
otool -L "$BIN" | grep -c StoreKit.framework >/dev/null || die "StoreKit is not linked: was the appstore feature on?"
otool -L "$BIN" | grep -c AuthenticationServices.framework >/dev/null || die "AuthenticationServices is not linked"
# The installer's own words (subs-pipeline's install_ffmpeg_full): present
# only if something in the store build can still reach it.
if strings "$BIN" | grep -cE "Homebrew isn't installed|accept-package-agreements" >/dev/null; then
  die "the ffmpeg installer is in the binary"
fi
if grep -rlaF -e 'checkout.stripe.com' -e 'Checkout opens in your browser' "$BIN" >/dev/null; then
  die "the card checkout is in the binary"
fi
if [ "$MODE" = store ] && strings "$BIN" | grep -c OPENSUBS_STORE_SMOKE >/dev/null; then
  die "the test hook is in a build for the store"
fi
echo "  LGPL ffmpeg inside, StoreKit and Sign in with Apple linked, no ffmpeg installer, no card checkout"
if find "$APP" -type l -print0 | xargs -0 -n1 readlink 2>/dev/null | grep -cE '^/' >/dev/null; then
  die "the bundle has a link to an absolute path"
fi
leaks=$(LC_ALL=C grep -rlaF -e "$HOME/" -e "$ROOT/" "$APP" || true)
[ -z "$leaks" ] || { echo "these files name this machine's home or checkout:"; echo "$leaks"; exit 1; }
echo "  no file in the bundle names $HOME or this checkout"

# --- signing -------------------------------------------------------------------
say "signing"
if [ "$MODE" = test ]; then
  # Only the sandbox and what the app uses. No application identifier and no
  # Sign in with Apple: both need the store profile, and without them the app
  # still runs sandboxed exactly as the store build does.
  APP_ENT="$OUT/OpenSubs.test.entitlements"
  cat > "$APP_ENT" <<'XML'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
	<key>com.apple.security.app-sandbox</key><true/>
	<key>com.apple.security.files.user-selected.read-write</key><true/>
	<key>com.apple.security.network.client</key><true/>
</dict></plist>
XML
else
  APP_ENT="$STORE/OpenSubs.entitlements"
  [ -z "$PROFILE" ] || cp "$PROFILE" "$APP/Contents/embedded.provisionprofile"
fi
TS=(); [ "$MODE" = store ] && TS=(--timestamp)
# Every Mach-O inside, inside out, before the bundle. Executables the app
# starts get the helper entitlements (the app's sandbox, inherited);
# libraries get none.
find "$RES" -type f -print0 | xargs -0 file -N --mime-type \
  | awk -F': ' '$2 == "application/x-mach-binary"' | cut -d: -f1 > "$OUT/macho.list"
: > "$OUT/exec.list"; : > "$OUT/lib.list"
while IFS= read -r f; do
  if otool -hv "$f" 2>/dev/null | grep -c ' EXECUTE ' >/dev/null; then echo "$f" >> "$OUT/exec.list"; else echo "$f" >> "$OUT/lib.list"; fi
done < "$OUT/macho.list"
echo "  $(wc -l < "$OUT/lib.list" | tr -d ' ') libraries, $(wc -l < "$OUT/exec.list" | tr -d ' ') executables inside"
while IFS= read -r f; do
  codesign --force ${TS[@]+"${TS[@]}"} --sign "$IDENTITY" "$f"
done < "$OUT/lib.list"
while IFS= read -r f; do
  codesign --force ${TS[@]+"${TS[@]}"} --entitlements "$STORE/helper.entitlements" --sign "$IDENTITY" "$f"
done < "$OUT/exec.list"
codesign --force ${TS[@]+"${TS[@]}"} --entitlements "$APP_ENT" --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict "$APP" && echo "  signature verifies"

say "what was built"
ent() { codesign -d --entitlements - --xml "$1" 2>/dev/null | plutil -convert json -o - - 2>/dev/null; }
echo "  $(/usr/libexec/PlistBuddy -c "Print :CFBundleIdentifier" "$PLIST") $VERSION ($BUILD_NUMBER), $(lipo -archs "$BIN")"
echo "  app entitlements: $(ent "$APP" | python3 -c 'import json,sys; print(", ".join(sorted(json.load(sys.stdin))))')"
[ "$(ent "$APP" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("com.apple.security.app-sandbox"))')" = True ] \
  || die "the app is not sandboxed"
while IFS= read -r f; do
  e=$(ent "$f")
  python3 -c 'import json,sys; e=json.loads(sys.argv[1]); sys.exit(0 if e == {"com.apple.security.app-sandbox": True, "com.apple.security.inherit": True} else 1)' "$e" \
    || die "$f is not signed as a sandboxed helper: $e"
done < "$OUT/exec.list"
[ "$(wc -l < "$OUT/exec.list" | tr -d ' ')" -ge 2 ] || die "ffmpeg and ffprobe were not found as executables"
echo "  every executable inside runs in the app's sandbox: $(sed "s|$RES/||" "$OUT/exec.list" | tr '\n' ' ')"
du -sh "$APP" | awk '{print "  app: " $1}'

if [ "$MODE" = test ]; then
  echo
  echo "Ready: $APP"
  echo "  Its container: ~/Library/Containers/$BUNDLE_ID/Data"
  exit 0
fi

# --- the profile, against what the app asks for ---------------------------------
if [ -n "$PROFILE" ]; then
  say "the profile"
  security cms -D -i "$APP/Contents/embedded.provisionprofile" > "$OUT/profile.plist" 2>/dev/null
  codesign -d --entitlements - --xml "$APP" 2>/dev/null > "$OUT/app-entitlements.plist"
  python3 - "$OUT/profile.plist" "$OUT/app-entitlements.plist" "$TEAM.$BUNDLE_ID" <<'PY' || die "the profile does not cover this app"
import plistlib, sys
prof = plistlib.load(open(sys.argv[1], "rb"))
app = plistlib.load(open(sys.argv[2], "rb"))
allowed = prof.get("Entitlements", {})
problems = []
if allowed.get("com.apple.application-identifier") != sys.argv[3]:
    problems.append(f"profile is for {allowed.get('com.apple.application-identifier')}")
if prof.get("ProvisionedDevices") or prof.get("ProvisionsAllDevices"):
    problems.append("not a store profile (it lists devices)")
for k, v in app.items():
    if k.startswith("com.apple.security."):
        continue                       # granted by the sandbox itself, not the profile
    if k not in allowed:
        problems.append(f"the app asks for {k}, the profile does not grant it")
    elif allowed[k] != v and not (isinstance(allowed[k], str) and allowed[k].endswith("*")):
        problems.append(f"{k}: app {v!r}, profile {allowed[k]!r}")
print(f"  {prof['Name']} ({prof.get('UUID')}), expires {prof['ExpirationDate']:%Y-%m-%d}, platform {', '.join(prof.get('Platform', []))}")
print(f"  grants: {', '.join(sorted(allowed))}")
if problems:
    print("  " + "\n  ".join(problems)); sys.exit(1)
print("  every entitlement the app asks for is in it")
PY
fi

# --- the package ---------------------------------------------------------------
say "the package"
PKG="$OUT/OpenSubs-$VERSION-$BUILD_NUMBER.pkg"
productbuild --component "$APP" /Applications --sign "$PKG_IDENTITY" "$PKG" >/dev/null
pkgutil --check-signature "$PKG" | sed -n '1,4p' | sed 's/^/  /'
ls -lh "$PKG" | awk '{print "  " $9 "  " $5}'
if [ -z "$PROFILE" ]; then
  echo
  echo "  NOT UPLOADABLE: built without a provisioning profile (OPENSUBS_ALLOW_NO_PROFILE=1)."
fi
echo
echo "Nothing was sent to Apple. Scanning, validating and uploading are each a separate step:"
echo "  publish-scan.sh \"$PKG\""
echo "  xcrun altool --validate-app -f \"$PKG\" -t macos --apiKey \"\$ASC_KEY_ID\" --apiIssuer \"\$ASC_ISSUER_ID\""
