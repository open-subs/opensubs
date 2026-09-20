#!/usr/bin/env bash
# Build a signed .ipa of the iOS/iPadOS app, and optionally upload it.
#
#   ./scripts/archive.sh              # build an .ipa
#   ./scripts/archive.sh --validate   # ...and have Apple check it
#   ./scripts/archive.sh --upload     # ...and send it to App Store Connect
#
# Follows apps/ios/scripts/archive.sh in openpdfedit, with two differences
# that come from this being a Capacitor app rather than a hand-written
# Xcode project:
#
#   - It builds the **workspace**, not the project. CocoaPods puts the
#     Capacitor runtime in Pods.xcodeproj, and `xcodebuild -project` does
#     not see it -- the build fails on a missing Capacitor module.
#   - The web app is staged by `npm run sync` in apps/mobile, which builds
#     apps/web, strips the marketing page and the locale pages, and runs
#     `cap sync`. www/ is a *copy*, so archiving without it silently ships
#     whatever was staged last.
#
# Uploading needs an Apple ID and an app-specific password
# (appleid.apple.com -> Sign-In and Security -> App-Specific Passwords),
# read from ~/.config/opensubs-apple/env, which is chmod 600 and outside
# every git working tree:
#
#   APPLE_ID=the-apple-id@example.com
#   APPLE_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
#
# An App Store Connect API key would work too (--apiKey/--apiIssuer) and
# is the better answer once uploads are frequent; the app-specific
# password is what exists today and needs no key file on disk.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
IOS_DIR="$(dirname "$SCRIPT_DIR")"
MOBILE_DIR="$(dirname "$IOS_DIR")"
BUILD="${IOS_ARCHIVE_DIR:-$IOS_DIR/.build/archive}"
ARCHIVE="$BUILD/OpenSubs.xcarchive"
EXPORT_DIR="$BUILD/export"
IPA="$EXPORT_DIR/App.ipa"
CREDS="${OPENSUBS_APPLE_ENV:-$HOME/.config/opensubs-apple/env}"

log() { printf '\033[1m==> %s\033[0m\n' "$1"; }
die() { echo "archive.sh: $1" >&2; exit 1; }

MODE=build
case "${1:-}" in
  "")          ;;
  --validate)  MODE=validate ;;
  --upload)    MODE=upload ;;
  *)           die "unknown option '$1' (expected --validate or --upload)" ;;
esac

PROJECT="$IOS_DIR/App/App.xcodeproj/project.pbxproj"
TEAM="$(grep -m1 -o 'DEVELOPMENT_TEAM = [^;]*;' "$PROJECT" | sed 's/DEVELOPMENT_TEAM = //; s/;$//; s/"//g')"
[ -n "$TEAM" ] || die "DEVELOPMENT_TEAM is unset in $PROJECT"

# Xcode refuses every *build* until its licence has been accepted, while
# still answering `xcodebuild -version` perfectly happily -- so the check
# has to be an action that reads the project.
#
# Tested on the exit status, not on the message. The licence notice is
# written straight to the terminal rather than to stdout or stderr, so it
# vanishes from a pipeline: `xcodebuild -list | grep license` finds
# nothing and the script sails past the one thing standing in its way.
# The status is a reliable 69 (EX_UNAVAILABLE).
if ! xcodebuild -list -project "$IOS_DIR/App/App.xcodeproj" >/dev/null 2>&1; then
  die "Xcode cannot read the project -- if this machine has never accepted the licence, run: sudo xcodebuild -license"
fi

security find-identity -v -p codesigning 2>/dev/null | grep -q "Apple Distribution\|Apple Development" \
  || die "no iOS signing identity in the keychain -- sign in under Xcode > Settings > Accounts, then Manage Certificates > + > Apple Distribution"

# The bundle's web app is a copy, so a stale one archives silently.
log "Staging the web app"
( cd "$MOBILE_DIR" && npm run sync )

# The marketing version is the product's, set in the Xcode project. The
# build number only has to be larger than every one already uploaded, and
# minutes-since-2020 is monotonic, needs no state, and stays inside the
# 32-bit range until 2103.
VERSION="$(grep -m1 -o 'MARKETING_VERSION = [^;]*;' "$PROJECT" | sed 's/MARKETING_VERSION = //; s/;$//')"
BUILD_NUMBER=$(( ($(date +%s) - 1577836800) / 60 ))
log "OpenSubs $VERSION ($BUILD_NUMBER), team $TEAM"

rm -rf "$BUILD"
mkdir -p "$BUILD"

log "Archiving"
xcodebuild archive \
  -workspace "$IOS_DIR/App/App.xcworkspace" \
  -scheme App \
  -configuration Release \
  -destination "generic/platform=iOS" \
  -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates \
  CURRENT_PROJECT_VERSION="$BUILD_NUMBER" \
  | grep -E "error:|warning:|ARCHIVE" || true

[ -d "$ARCHIVE" ] || die "no archive at $ARCHIVE -- rerun without the grep filter to see why"

# The team id lives in one place (the project), so the export options are
# generated rather than committed with a second copy of it.
OPTIONS="$BUILD/ExportOptions.plist"
sed "s/__TEAM_ID__/$TEAM/" "$IOS_DIR/ExportOptions.plist" > "$OPTIONS"

log "Exporting"
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE" \
  -exportPath "$EXPORT_DIR" \
  -exportOptionsPlist "$OPTIONS" \
  -allowProvisioningUpdates \
  | grep -E "error:|EXPORT" || true

[ -f "$IPA" ] || IPA="$(find "$EXPORT_DIR" -maxdepth 1 -name '*.ipa' | head -1)"
[ -n "$IPA" ] && [ -f "$IPA" ] || die "no .ipa under $EXPORT_DIR"
log "$IPA ($(du -h "$IPA" | cut -f1))"

[ "$MODE" = build ] && exit 0

[ -f "$CREDS" ] || die "$CREDS is missing -- see the header of this script"
# shellcheck disable=SC1090
set -a; . "$CREDS"; set +a
[ -n "${APPLE_ID:-}" ]           || die "APPLE_ID is unset in $CREDS"
[ -n "${APPLE_APP_PASSWORD:-}" ] || die "APPLE_APP_PASSWORD is unset in $CREDS"

# Passed through the environment rather than on the command line: an
# argument is visible to every process on the machine in `ps`.
export ALTOOL_PASSWORD="$APPLE_APP_PASSWORD"

if [ "$MODE" = validate ]; then
  log "Validating with Apple"
  exec xcrun altool --validate-app -f "$IPA" -t ios \
    --username "$APPLE_ID" --password @env:ALTOOL_PASSWORD
fi

# Validate first even when uploading. A rejected upload still consumes the
# build number; a failed validation does not.
log "Validating with Apple"
xcrun altool --validate-app -f "$IPA" -t ios \
  --username "$APPLE_ID" --password @env:ALTOOL_PASSWORD

log "Uploading build $BUILD_NUMBER"
xcrun altool --upload-app -f "$IPA" -t ios \
  --username "$APPLE_ID" --password @env:ALTOOL_PASSWORD

echo
echo "Uploaded. Processing takes a few minutes; the build appears under"
echo "TestFlight in App Store Connect when it is done."
echo "Submitting it for review is a person's decision, not this script's."
