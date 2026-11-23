#!/usr/bin/env bash
# Fetch what the Mac and Windows installers carry, so a fresh install works
# with nothing else to download or install:
#
#   bundled/models/ggml-base.bin   multilingual Whisper Base (whisper.cpp)
#   bundled/models/m2m100/         M2M-100 418M int8 (CTranslate2), offline
#                                  translation; MIT, converted by us and
#                                  published as the models-m2m100-418m-int8
#                                  release of this repository
#   bundled/vendor/ffmpeg[.exe]    a self-contained ffmpeg with libass
#   bundled/vendor/ffprobe[.exe]
#
#   bundled/vendor/ffmpeg-build.txt   what that ffmpeg build contains: the
#                                  library versions (macOS) or the build's
#                                  README (Windows), for licences/ in the app
#
# Transcription is linked into the app (crates/subs-whisper), so ffmpeg only
# decodes and burns, and any static build with libass does: Martin Riedl's
# on macOS, Gyan.dev's essentials on Windows. Both are GPL-3.0-or-later
# builds, which an AGPL app may carry; NOTICE at the root of this repository
# says so, names them, and offers their source. They are pinned by version
# and SHA-256 because NOTICE names them: taking whatever the site listed
# first used to pick Martin Riedl's development snapshot, a different build
# in every installer. Changing a pin means changing NOTICE too.
# Run before `tauri build`; the files are not committed.
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

M2M="$OUT/models/m2m100"
M2M_URL=https://github.com/open-subs/opensubs/releases/download/models-m2m100-418m-int8
mkdir -p "$M2M"
if [ ! -s "$M2M/model.bin" ]; then
  echo "fetching M2M-100 (translation)"
  for f in model.bin config.json shared_vocabulary.json sentencepiece.bpe.model SHA256SUMS; do
    curl -fsSL "$M2M_URL/$f" -o "$M2M/$f"
  done
  # Checked against the sums published with it: this is a file we made,
  # served from a release anyone could have replaced.
  if command -v sha256sum >/dev/null; then (cd "$M2M" && sha256sum -c SHA256SUMS --quiet)
  else (cd "$M2M" && shasum -a 256 -c SHA256SUMS --quiet); fi
  rm -f "$M2M/SHA256SUMS"
fi

check_sha() {  # file expected
  local got
  if command -v sha256sum >/dev/null; then got=$(sha256sum "$1" | cut -d' ' -f1); else got=$(shasum -a 256 "$1" | cut -d' ' -f1); fi
  [ "$got" = "$2" ] || { echo "$1: sha256 $got, expected $2" >&2; exit 1; }
}
case "$(uname -s)" in
  Darwin)
    # FFmpeg 9.0.2, Martin Riedl's release builds (not the snapshot).
    case "$(uname -m)" in
      arm64)  MR=https://ffmpeg.martin-riedl.de/download/macos/arm64/1789931890_9.0.2
              FFMPEG_SHA=c8ed4c4e6978a03c485edbfe4e0a5dc2380f8a30bba5150531b31b094492d924
              FFPROBE_SHA=fcbe839537485eaee7a7a8bc5cbc0f90d53617e80943e8a5b2e31cb851197ea6 ;;
      x86_64) MR=https://ffmpeg.martin-riedl.de/download/macos/amd64/1789931006_9.0.2
              FFMPEG_SHA=7c6b4125b191cbf773832dc51f424cf2b6bb7da43007d1e066f95909e47cacd4
              FFPROBE_SHA=2322438ed2f6319a691291b247d09c69dcaa3a982460d1f269a7e1af335cfdfd ;;
      *) echo "no pinned ffmpeg for macOS on $(uname -m)" >&2; exit 1 ;;
    esac
    for tool in ffmpeg ffprobe; do
      sha=FFMPEG_SHA; [ "$tool" = ffprobe ] && sha=FFPROBE_SHA
      if [ -x "$OUT/vendor/$tool" ] && [ -s "$OUT/vendor/$tool.zip.sha256" ] && [ "$(cat "$OUT/vendor/$tool.zip.sha256")" = "${!sha}" ]; then
        continue
      fi
      echo "fetching $tool 9.0.2 ($(uname -m))"
      curl -fsSL "$MR/$tool.zip" -o "$TMP/$tool.zip"
      check_sha "$TMP/$tool.zip" "${!sha}"
      unzip -oq "$TMP/$tool.zip" -d "$TMP"
      install -m 755 "$TMP/$tool" "$OUT/vendor/$tool"
      printf '%s' "${!sha}" > "$OUT/vendor/$tool.zip.sha256"
    done
    curl -fsSL "$MR/versions.txt" -o "$OUT/vendor/ffmpeg-build.txt"
    grep -q '^ffmpeg version 9.0.2-' "$OUT/vendor/ffmpeg-build.txt" || { echo "versions.txt is not FFmpeg 9.0.2's" >&2; exit 1; }
    ;;
  MINGW*|MSYS*|CYGWIN*|Windows_NT)
    # FFmpeg 9.0.2, gyan.dev's release essentials build.
    GYAN=https://www.gyan.dev/ffmpeg/builds/packages/ffmpeg-9.0.2-essentials_build.zip
    GYAN_SHA=60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba
    if [ ! -f "$OUT/vendor/ffmpeg.exe" ] || [ "$(cat "$OUT/vendor/ffmpeg.zip.sha256" 2>/dev/null)" != "$GYAN_SHA" ]; then
      echo "fetching ffmpeg 9.0.2 (Gyan.dev release essentials)"
      curl -fsSL "$GYAN" -o "$TMP/ff.zip"
      check_sha "$TMP/ff.zip" "$GYAN_SHA"
      unzip -oq "$TMP/ff.zip" -d "$TMP"
      cp "$TMP"/ffmpeg-9.0.2-essentials_build/bin/ffmpeg.exe "$TMP"/ffmpeg-9.0.2-essentials_build/bin/ffprobe.exe "$OUT/vendor/"
      cp "$TMP"/ffmpeg-9.0.2-essentials_build/README.txt "$OUT/vendor/ffmpeg-build.txt"
      printf '%s' "$GYAN_SHA" > "$OUT/vendor/ffmpeg.zip.sha256"
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
