#!/usr/bin/env bash
# Fetch what the Mac and Windows installers carry, so a fresh install works
# with nothing else to download or install:
#
#   bundled/models/ggml-base.bin   multilingual Whisper Base (whisper.cpp)
#   bundled/vendor/ffmpeg[.exe]    a self-contained ffmpeg with libass
#   bundled/vendor/ffprobe[.exe]
#
# Transcription is linked into the app (crates/subs-whisper), so ffmpeg only
# decodes and burns, and any static build with libass does: Martin Riedl's
# on macOS, Gyan.dev's essentials on Windows. Both are GPL builds, which an
# AGPL app may carry. Run before `tauri build`; the files are not committed.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/../src-tauri" && pwd)"
OUT="$HERE/bundled"
mkdir -p "$OUT/models" "$OUT/vendor"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

MODEL="$OUT/models/ggml-base.bin"
if [ ! -s "$MODEL" ]; then
  echo "fetching Whisper Base"
  curl -fsSL https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin -o "$MODEL.part"
  mv "$MODEL.part" "$MODEL"
fi

case "$(uname -s)" in
  Darwin)
    arch="$(uname -m)"; [ "$arch" = x86_64 ] && arch=amd64
    page="$(curl -fsSL https://ffmpeg.martin-riedl.de/)"
    for tool in ffmpeg ffprobe; do
      [ -x "$OUT/vendor/$tool" ] && continue
      path="$(printf '%s' "$page" | grep -oE "/download/macos/$arch/[^\"]*/$tool.zip" | head -1)"
      [ -n "$path" ] || { echo "no $tool build for macos/$arch" >&2; exit 1; }
      echo "fetching $tool ($arch)"
      curl -fsSL "https://ffmpeg.martin-riedl.de$path" -o "$TMP/$tool.zip"
      unzip -oq "$TMP/$tool.zip" -d "$TMP"
      install -m 755 "$TMP/$tool" "$OUT/vendor/$tool"
    done
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    if [ ! -f "$OUT/vendor/ffmpeg.exe" ]; then
      echo "fetching ffmpeg (Gyan.dev essentials)"
      curl -fsSL https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip -o "$TMP/ff.zip"
      unzip -oq "$TMP/ff.zip" -d "$TMP"
      cp "$TMP"/ffmpeg-*/bin/ffmpeg.exe "$TMP"/ffmpeg-*/bin/ffprobe.exe "$OUT/vendor/"
    fi
    ;;
  *) echo "nothing to bundle on $(uname -s): Linux builds use the system ffmpeg"; exit 0 ;;
esac

# The installer must not carry an ffmpeg that cannot burn: check it here,
# where the failure is cheap, rather than on someone's first export.
bin="$OUT/vendor/ffmpeg"; [ -f "$bin.exe" ] && bin="$bin.exe"
# Read the listing whole first: `grep -q` stops at the first match, and under
# pipefail the ffmpeg it cut off counts as a failure.
filters="$("$bin" -hide_banner -filters 2>/dev/null)"
grep -qE '^ [A-Z.]{2,3} +ass ' <<<"$filters" || { echo "the bundled ffmpeg has no libass" >&2; exit 1; }
echo "bundled: $(du -sh "$OUT" | cut -f1)"
