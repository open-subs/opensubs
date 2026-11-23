#!/usr/bin/env bash
# The Mac App Store build, sandboxed, doing real exports on this Mac.
#
#   apps/desktop/scripts/appstore-smoke.sh speech.mp4 [hdr-speech.mp4] [out-dir]
#
# Runs the test build (build-appstore.sh test) and drives it only through its
# hook (src-tauri/src/store.rs, `smoke`): a script run inside the real window,
# calling the same commands through the same IPC as the page. No clicks, no
# keystrokes; the app is opened in the background (open -g), and the only
# picture taken is of its own window, by window id. It checks that
#   - the store page is the one running (credits through StoreKit, Apple's
#     sign-in sheet), and the ffmpeg it finds is the LGPL one inside the app,
#     with no install offered;
#   - a video in the container is probed, transcribed with the bundled
#     Whisper model, and burned by the bundled ffmpeg into a subtitled MP4
#     with an .srt beside it, encoded with VideoToolbox;
#   - an HDR video is tonemapped (zscale) to SDR and burned, with the
#     subtitles translated on the Mac (M2M-100);
#   - a video opened with the app the way Finder opens one (open -a) is
#     readable by the sandboxed ffmpeg, which inherits the app's grant;
#   - a video outside the container that was never opened is refused, and
#     ffmpeg cannot write outside the container: both run in the sandbox;
#   - StoreKit answers through the bridge (in a test build it has no
#     products to give, which is the expected answer).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
VIDEO="${1:-}"; HDR="${2:-}"; OUT="${3:-$(mktemp -d)}"
APP="${OPENSUBS_TEST_APP:-$HERE/../build-appstore/test/OpenSubs.app}"
[ -d "$APP" ] && APP="$(cd "$APP" && pwd -P)"
BIN="$APP/Contents/MacOS/opensubs-desktop"
# The app's container: usually named after the bundle id, but macOS names a
# re-created one by a UUID, so it is found by the identifier it records.
container() {
  local d
  for d in "$HOME/Library/Containers/app.opensubs.mobile" "$HOME"/Library/Containers/*-*-*-*-*; do
    [ "$(plutil -extract MCMMetadataIdentifier raw "$d/.com.apple.containermanagerd.metadata.plist" 2>/dev/null)" = app.opensubs.mobile ] \
      && { echo "$d/Data"; return; }
  done
  echo "$HOME/Library/Containers/app.opensubs.mobile/Data"
}
DATA="$(container)"
SHARED="/Users/Shared/opensubs-smoke"
[ -f "$VIDEO" ] || { echo "usage: $0 speech.mp4 [hdr-speech.mp4] [out-dir]"; exit 2; }
[ -x "$BIN" ] || { echo "no test build at $APP: build-appstore.sh test"; exit 2; }
strings "$BIN" | grep -c OPENSUBS_STORE_SMOKE >/dev/null || { echo "$APP is not a test build (no hook)"; exit 2; }
mkdir -p "$OUT"
pass=0; fail=0
check() { if [ "$2" = 0 ]; then echo "ok    $1${3:+  -- $3}"; pass=$((pass+1)); else echo "FAIL  $1${3:+  -- $3}"; fail=$((fail+1)); fi; }
running() { pgrep -f "$BIN" >/dev/null 2>&1; }
wait_gone() { local i; for ((i = 0; i < $1; i++)); do running || return 0; sleep 1; done; return 1; }
# Window-id pictures of the app's own windows: never the screen. One file
# per window wider than 300 points, largest first.
shot() {
  local pid ids n=0 id
  pid=$(pgrep -f "$BIN" | head -1) || return 0
  ids=$(swift - "$pid" <<'SWIFT' 2>/dev/null
import CoreGraphics
let pid = Int(CommandLine.arguments[1])!
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly], kCGNullWindowID) as! [[String: Any]]
var found: [(Int, Double)] = []
for w in list where (w[kCGWindowOwnerPID as String] as? Int) == pid && (w[kCGWindowLayer as String] as? Int) == 0 {
    let b = w[kCGWindowBounds as String] as? [String: Any] ?? [:]
    let width = b["Width"] as? Double ?? 0, height = b["Height"] as? Double ?? 0
    if width > 300 { found.append((w[kCGWindowNumber as String] as! Int, width * height)) }
}
for (id, _) in found.sorted(by: { $0.1 > $1.1 }) { print(id) }
SWIFT
)
  for id in $ids; do
    n=$((n + 1))
    screencapture -x -o -l"$id" "${1%.png}-$n.png" && echo "  window $id -> ${1%.png}-$n.png"
  done
}
run() { # script-name, [document to open with the app]
  local js="$T/$1.js"
  rm -f "$T/$1.result.json"
  wait_gone 20 || pkill -f "$BIN" || true
  if [ -n "${2:-}" ]; then open -g -n -a "$APP" --env "OPENSUBS_STORE_SMOKE=$js" "$2"
  else open -g -n -a "$APP" --env "OPENSUBS_STORE_SMOKE=$js"; fi
  local i; for ((i = 0; i < 600; i++)); do
    [ -s "$T/$1.result.json" ] && break
    [ "$i" = "${SHOT_AT:-8}" ] && shot "$OUT/$1-window.png"
    sleep 1
  done
  wait_gone 20 || pkill -f "$BIN" || true
  [ -s "$T/$1.result.json" ] && cp "$T/$1.result.json" "$OUT/$1.json"
}
field() { python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); v=eval(sys.argv[2], {"d": d}); print(v)' "$@"; }

running && { echo "OpenSubs (test build) is already running; quit it first"; exit 1; }
# The first launch makes the container; nothing can be put in it before.
if [ ! -d "$DATA" ]; then
  open -g -n -a "$APP" --env "OPENSUBS_STORE_SMOKE=$DATA/smoke/none.js"
  for i in $(seq 1 30); do DATA="$(container)"; [ -d "$DATA" ] && break; sleep 1; done
  wait_gone 15 || pkill -f "$BIN" || true
fi
[ -d "$DATA" ] || { echo "no container at $DATA after a launch"; exit 1; }
T="$DATA/smoke"
rm -rf "$T" && mkdir -p "$T/out"
cp "$VIDEO" "$T/speech.mp4"
[ -n "$HDR" ] && cp "$HDR" "$T/hdr.mp4"
mkdir -p "$SHARED" && cp "$VIDEO" "$SHARED/opened.mp4" && cp "$VIDEO" "$SHARED/never-opened.mp4"

# --- one: the store page, the bundled ffmpeg, a burn and its .srt ----------------
cat > "$T/main.js" <<JS
(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const r = {};
  const step = async (name, fn) => { try { r[name] = { ok: await fn() }; } catch (e) { r[name] = { err: e && e.message ? e.message : e }; } };
  const opts = (extra) => Object.assign({ start: 0, end: 12, height: null, translateTo: null,
    writeSrt: true, writeVtt: false, writeTxt: false, chineseScript: "simplified" }, extra);
  r.storePage = !!(customElements.get("openapps-login") && customElements.get("openapps-login").prototype.__macApple);
  r.cardCheckoutOnPage = document.documentElement.innerHTML.includes("Checkout opens in your browser");
  await step("ffmpeg", () => inv("store_check_ffmpeg"));
  await step("model", () => inv("get_model_path"));
  await step("probe", () => inv("probe", { path: "$T/speech.mp4" }));
  await step("outputIn", () => inv("output_in", { input: "$T/speech.mp4", dir: "$T/out" }));
  const model = r.model.ok;
  await step("burn", () => inv("burn", { path: "$T/speech.mp4", style: "Clean", model, output: r.outputIn.ok, options: opts({}) }));
  if ("${HDR:+yes}") {
    await step("hdrProbe", () => inv("probe", { path: "$T/hdr.mp4" }));
    await step("hdrBurn", () => inv("burn", { path: "$T/hdr.mp4", style: "Shorts", model, output: "$T/out/hdr.subbed.mp4",
      options: opts({ end: null, translateTo: "es" }) }));
  }
  await step("neverOpened", () => inv("probe", { path: "$SHARED/never-opened.mp4" }));
  await step("writeOutside", () => inv("burn", { path: "$T/speech.mp4", style: "Clean", model, output: "$SHARED/escaped.mp4", options: opts({ end: 4, writeSrt: false }) }));
  await step("products", () => inv("store_call", { op: "products", arg: {} }));
  await step("unknownOp", () => inv("store_call", { op: "rm", arg: {} }));
  await inv("smoke_report", { text: JSON.stringify(r, null, 2) });
})();
JS
echo "== the store page, a burn with its .srt, HDR, the sandbox"
run main
R="$OUT/main.json"
[ -s "$R" ] || { echo "FAIL  no report from the app"; exit 1; }
check "the store page is the one running" "$(field "$R" '0 if d["storePage"] and not d["cardCheckoutOnPage"] else 1')"
check "ffmpeg is found, can burn, and no install is offered" "$(field "$R" '0 if d["ffmpeg"]["ok"]["found"] and d["ffmpeg"]["ok"]["missing"] == [] and d["ffmpeg"]["ok"]["install"] is None else 1')"
check "the bundled Whisper model is the default" "$(field "$R" '0 if d["model"]["ok"].endswith("Contents/Resources/models/ggml-base.bin") else 1')" "$(field "$R" 'd["model"]["ok"]')"
check "a video in the container is probed" "$(field "$R" '0 if d["probe"].get("ok", {}).get("hasAudio") else 1')"
check "an export is named in the folder picked" "$(field "$R" '0 if d["outputIn"]["ok"].endswith("/smoke/out/speech.subbed.mp4") else 1')"
check "transcribed and burned" "$(field "$R" '0 if "ok" in d["burn"] else 1')" "$(field "$R" 'd["burn"]')"
MP4="$T/out/speech.subbed.mp4"; SRT="$T/out/speech.subbed.srt"
# The app's own ffprobe will not run from here: a helper signed only with
# app-sandbox + inherit traps unless a sandboxed app starts it. That is a
# check of its own; the outputs are read with the same build, unsigned.
set +e; "$APP/Contents/Resources/vendor/ffprobe" -version >/dev/null 2>&1; rc=$?; set -e
check "the bundled ffprobe runs only inside the app's sandbox" "$([ "$rc" = 133 ] && echo 0 || echo 1)" "exit $rc started directly"
FFPROBE="$HERE/../src-tauri/bundled/ffmpeg-lgpl/ffprobe"
cmp -s "$FFPROBE" "$APP/Contents/Resources/vendor/ffprobe" 2>/dev/null || true
if [ -s "$MP4" ]; then
  cp "$MP4" "$SRT" "$OUT/" 2>/dev/null || true
  v=$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=codec_name,width,height -of csv=p=0 "$MP4")
  a=$("$FFPROBE" -v error -select_streams a:0 -show_entries stream=codec_name -of csv=p=0 "$MP4")
  check "the export is H.264 with its audio" "$([ "${v%%,*}" = h264 ] && [ -n "$a" ] && echo 0 || echo 1)" "video $v, audio $a"
  # The encoder ffmpeg records: VideoToolbox, not x264.
  enc=$("$FFPROBE" -v error -show_entries stream_tags=encoder -of csv=p=0 "$MP4" | head -1)
  check "encoded by VideoToolbox" "$(grep -qiE 'videotoolbox|^$' <<<"$enc" && ! grep -qi x264 <<<"$enc" && echo 0 || echo 1)" "${enc:-no encoder tag}"
else
  check "the export exists" 1
fi
check "the .srt beside it has cues" "$([ -s "$SRT" ] && grep -q -- '-->' "$SRT" && echo 0 || echo 1)" "$( [ -s "$SRT" ] && sed -n 3p "$SRT")"
if [ -n "$HDR" ]; then
  check "an HDR video is probed as HDR" "$(field "$R" '0 if d["hdrProbe"].get("ok", {}).get("isHdr") else 1')"
  check "the HDR video is tonemapped, translated on the Mac and burned" "$(field "$R" '0 if "ok" in d["hdrBurn"] else 1')" "$(field "$R" 'str(d["hdrBurn"])[:200]')"
  H="$T/out/hdr.subbed.mp4"
  if [ -s "$H" ]; then
    cp "$H" "$OUT/"
    trc=$("$FFPROBE" -v error -select_streams v:0 -show_entries stream=color_transfer,pix_fmt -of csv=p=0 "$H")
    check "the HDR export is SDR (bt709, 8-bit)" "$([ "$trc" = "yuv420p,bt709" ] && echo 0 || echo 1)" "$trc"
  fi
fi
check "a video outside the container that was never opened is refused" "$(field "$R" '0 if "err" in d["neverOpened"] else 1')" "$(field "$R" 'str(d["neverOpened"])[:160]')"
check "ffmpeg cannot write outside the container" "$( [ ! -e "$SHARED/escaped.mp4" ] && [ ! -e "$SHARED/escaped.part.mp4" ] && field "$R" '0 if "err" in d["writeOutside"] else 1' || echo 1)" "$(field "$R" 'str(d["writeOutside"])[:160]')"
check "StoreKit answers through the bridge" "$(field "$R" '0 if ("ok" in d["products"] or "err" in d["products"]) else 1')" "$(field "$R" 'str(d["products"])[:160]')"
check "the bridge refuses a request it does not know" "$(field "$R" '0 if "err" in d["unknownOp"] else 1')"

# --- two: a video opened with the app, as Finder opens one -------------------------
cat > "$T/opened.js" <<JS
(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const r = {};
  const step = async (name, fn) => { try { r[name] = { ok: await fn() }; } catch (e) { r[name] = { err: e && e.message ? e.message : e }; } };
  const model = await inv("get_model_path");
  await step("probe", () => inv("probe", { path: "$SHARED/opened.mp4" }));
  await step("burn", () => inv("burn", { path: "$SHARED/opened.mp4", style: "Clean", model, output: "$T/out/opened.subbed.mp4",
    options: { start: 0, end: 6, height: null, translateTo: null, writeSrt: false, writeVtt: false, writeTxt: false, chineseScript: "simplified" } }));
  await inv("smoke_report", { text: JSON.stringify(r, null, 2) });
})();
JS
echo "== a video opened with the app"
run opened "$SHARED/opened.mp4"
R="$OUT/opened.json"
if [ -s "$R" ]; then
  check "a video opened with the app is read by the sandboxed ffmpeg" "$(field "$R" '0 if "ok" in d["probe"] and "ok" in d["burn"] else 1')" "$(field "$R" 'str(d)[:200]')"
else
  check "a report from the opened-document run" 1
fi

# --- three: pictures of the account panel and the sign-in window -------------------
cat > "$T/shots.js" <<'JS'
(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const r = {};
  const toggle = document.querySelector("button[aria-expanded]");
  if (toggle) toggle.click();
  await wait(1500);
  r.accountText = (document.querySelector(".account-card") || {}).innerText || null;
  const signIn = [...document.querySelectorAll(".account-card button")].find((b) => b.textContent.trim() === "Sign in");
  if (signIn) signIn.click();
  await wait(14000);
  await inv("smoke_report", { text: JSON.stringify(r, null, 2) });
})();
JS
echo "== pictures: the account panel and the sign-in window"
SHOT_AT=10 run shots
R="$OUT/shots.json"
if [ -s "$R" ]; then
  check "the account panel names the App Store, not a card checkout" "$(field "$R" '0 if d["accountText"] and "App Store" in d["accountText"] and "browser" not in d["accountText"] else 1')" "$(field "$R" 'repr(d["accountText"])[:160]')"
fi

echo
echo "$pass passed, $fail failed. Reports, exports and window pictures: $OUT"
rm -rf "$SHARED"
[ "$fail" = 0 ]
