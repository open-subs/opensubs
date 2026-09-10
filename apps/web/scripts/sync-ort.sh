#!/usr/bin/env bash
# Copy ONNX Runtime's WebAssembly backend into public/ so it is served from
# our own origin.
#
# Left alone, transformers.js points ORT at cdn.jsdelivr.net and fetches
# these files from there the first time a model runs. Two problems, and the
# second is the serious one: our Content-Security-Policy does not list
# jsdelivr, so the fetch is blocked and transcription dies with "no
# available backend found" -- in production only, because a dev server
# sends no CSP; and this product's claim is that nothing leaves your
# machine but what you choose to send, which a silent runtime dependency on
# someone else's CDN would make false. `src/lib/asr.ts` points ORT here.
#
# These are 74 MB of third-party binaries that npm already pins, so they
# are copied at build time rather than committed. They were committed once
# -- by hand, with no record of where from -- and a checkout then carried
# the weight of every future version of them forever.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB="$(dirname "$HERE")"
SRC="$WEB/node_modules/onnxruntime-web/dist"
DEST="$WEB/public/ort"

if [ ! -d "$SRC" ]; then
  echo "sync-ort: $SRC is missing -- run npm install first" >&2
  exit 1
fi

mkdir -p "$DEST"
copied=0
for file in "$SRC"/ort-wasm-simd-threaded.*; do
  [ -e "$file" ] || continue
  # Only refresh what actually changed: these are tens of megabytes each,
  # and this runs before every build.
  if ! cmp -s "$file" "$DEST/$(basename "$file")"; then
    cp "$file" "$DEST/"
    copied=$((copied + 1))
  fi
done

if [ ! -s "$DEST/ort-wasm-simd-threaded.wasm" ]; then
  echo "sync-ort: no ORT wasm ended up in $DEST" >&2
  exit 1
fi

echo "sync-ort: $DEST up to date ($copied file(s) refreshed)"
