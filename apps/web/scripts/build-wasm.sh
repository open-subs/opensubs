#!/usr/bin/env bash
# Builds crates/subs-wasm for wasm32-unknown-unknown and generates the
# wasm-bindgen JS/TS glue into src/wasm-gen/. Run before `vite build` (see
# package.json's `build` script) -- Vite never touches Rust, it only imports
# the already-generated glue as a normal ES module.
#
# The generated output is committed, following opencapture: a checkout
# should be able to `npm run dev` without a Rust toolchain installed.
set -euo pipefail

export PATH="$HOME/.cargo/bin:/opt/homebrew/bin:$PATH"

# The repo lives on a shared mount, which produces spurious archive/GC
# errors when used as the cargo target dir directly (see .cargo/config.toml).
# Build off-mount; only the final .wasm crosses back via --out-dir.
: "${CARGO_TARGET_DIR:=/tmp/opensubs-target}"
export CARGO_TARGET_DIR

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
WORKSPACE_DIR="$(dirname "$(dirname "$WEB_DIR")")"
OUT_DIR="$WEB_DIR/src/wasm-gen"

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "error: wasm-bindgen not on PATH." >&2
  echo "  cargo install wasm-bindgen-cli --version 0.2.126" >&2
  echo "(the CLI version must match the wasm-bindgen crate version in" >&2
  echo " crates/subs-wasm/Cargo.toml exactly -- the JS glue is schema-versioned)" >&2
  exit 1
fi

cargo build -p subs-wasm \
  --target wasm32-unknown-unknown \
  --profile wasm-release \
  --manifest-path "$WORKSPACE_DIR/Cargo.toml"

wasm-bindgen \
  --target web \
  --out-dir "$OUT_DIR" \
  --out-name subs_engine \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/wasm-release/subs_wasm.wasm"

# wasm-opt is an optimisation, not a requirement, and it must never be able
# to damage the build. It used to read and write the same path, so an older
# binaryen -- one that rejects the bulk-memory features rustc now emits --
# could fail partway and leave a truncated engine behind, which fails at
# runtime in the browser with nothing pointing back here. Optimise into a
# temporary file and only adopt it if it comes out whole.
if command -v wasm-opt >/dev/null 2>&1; then
  if wasm-opt -O3 --enable-bulk-memory --enable-nontrapping-float-to-int \
      -o "$OUT_DIR/subs_engine_bg.opt.wasm" "$OUT_DIR/subs_engine_bg.wasm" 2>/dev/null \
      && [ -s "$OUT_DIR/subs_engine_bg.opt.wasm" ]; then
    mv "$OUT_DIR/subs_engine_bg.opt.wasm" "$OUT_DIR/subs_engine_bg.wasm"
    echo "wasm-opt: optimized subs_engine_bg.wasm"
  else
    rm -f "$OUT_DIR/subs_engine_bg.opt.wasm"
    echo "wasm-opt failed (likely too old for the features rustc emits) -- keeping"
    echo "  the unoptimised engine, which is correct, just larger."
  fi
else
  echo "wasm-opt not found on PATH -- skipping (the glue still works, just larger)"
fi

ls -lh "$OUT_DIR/subs_engine_bg.wasm" | awk '{print "wasm build complete: " $9 " (" $5 ")"}'
