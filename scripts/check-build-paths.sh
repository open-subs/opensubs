#!/usr/bin/env bash
# Fails when a built file still names the machine that built it.
#
#   scripts/check-build-paths.sh <file>...
#
# Run on every binary a build is about to hand to people, after the last step
# that rewrites it (wasm-opt included). scripts/remap-paths.sh is what keeps
# the paths out; this is what notices when it did not -- a new build script
# that forgot to source it, a RUSTFLAGS that replaced it, a toolchain that
# started writing a path somewhere new. Without it the only check is someone
# running `strings` on the live site.
#
# Two kinds of match, both counted per file:
#   - the prefixes of this build, read from its environment: $HOME, this
#     checkout, $CARGO_HOME, $RUSTUP_HOME, $CARGO_TARGET_DIR (and the
#     symlink-free spelling of each);
#   - the shape of any home directory, whoever built it: /Users/<name>/ and
#     /home/<name>/.cargo/ or /home/<name>/.rustup/.
# A prefix of five characters or fewer (/, /root) is not checked by name: it
# would match ordinary text, and the shapes above still apply.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
prefixes=()
add() {
  local p="${1%/}" real
  [ "${#p}" -gt 5 ] || return 0
  prefixes+=("$p/")
  if [ -d "$p" ]; then
    real="$(cd "$p" && pwd -P)"
    [ "$real" = "$p" ] || prefixes+=("$real/")
  fi
}
add "${HOME:-}"
add "$root"
add "${CARGO_HOME:-}"
add "${RUSTUP_HOME:-}"
add "${CARGO_TARGET_DIR:-}"

count() { # <grep flags> <pattern> <file>
  { LC_ALL=C grep -ao "$1" -- "$2" "$3" || true; } | wc -l | tr -d ' '
}

status=0
for f in "$@"; do
  for p in ${prefixes[@]+"${prefixes[@]}"}; do
    n=$(count -F "$p" "$f")
    if [ "$n" != 0 ]; then
      echo "check-build-paths: $f carries $n path(s) under $p" >&2
      status=1
    fi
  done
  n=$(count -E '/Users/[^/[:space:]]+/|/home/[^/[:space:]]+/\.(cargo|rustup)/' "$f")
  if [ "$n" != 0 ]; then
    echo "check-build-paths: $f carries $n home-directory path(s):" >&2
    { LC_ALL=C grep -aoE '/Users/[^/[:space:]]+/|/home/[^/[:space:]]+/\.(cargo|rustup)/' -- "$f" || true; } | sort | uniq -c >&2
    status=1
  fi
done
[ "$status" = 0 ] && echo "check-build-paths: no build-machine paths in $# file(s)"
exit "$status"
