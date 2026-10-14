# shellcheck shell=bash
# Sourced (not run) by every script that compiles Rust into something
# people download: the web app's engine (apps/web/scripts/build-wasm.sh,
# whose output is committed and served from opensubs.app) and the desktop
# app (scripts/build-dmg.sh).
#
#   source "$ROOT_DIR/scripts/remap-paths.sh"
#
# rustc writes the absolute path of every source file it compiles into the
# binary, for panic messages and debug info. Left alone, a release build
# carries the builder's home directory -- and with it their login name --
# hundreds of times: every crate under ~/.cargo/registry, the toolchain
# under ~/.rustup, the checkout itself. --remap-path-prefix rewrites those
# prefixes at compile time; the code generated is otherwise identical.
#
# Every path is read from the environment of the build that sources this,
# so it is the same on a laptop and in CI (/builds/..., /usr/local/cargo):
#
#   $CARGO_HOME (default ~/.cargo)    -> /cargo
#   $RUSTUP_HOME (default ~/.rustup)  -> /rustup
#   $CARGO_TARGET_DIR, when set       -> /target
#   this checkout                     -> .
#   $HOME, for anything else under it -> ~
#
# rustc applies the last matching mapping, so the list runs from the most
# general prefix to the most specific (CI keeps CARGO_HOME inside the
# checkout, and that one has to win).
#
# The flags are added to whatever RUSTFLAGS already holds, never instead of
# it. Note that cargo ignores build.rustflags in .cargo/config.toml whenever
# RUSTFLAGS is set; this repository has none. A path containing whitespace
# cannot be written into RUSTFLAGS, so in that case (or if
# CARGO_ENCODED_RUSTFLAGS is already in use) the flags go into
# CARGO_ENCODED_RUSTFLAGS instead, with RUSTFLAGS folded in.
#
# Sourcing it twice is harmless: the second time finds the checkout's
# mapping already there and does nothing.

if [ -z "${BASH_VERSION:-}" ]; then
  echo "remap-paths.sh: source this from bash" >&2
  return 1
fi

_remap_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

_remap_add() { # <from> <to>, plus the symlink-free spelling of <from> if it differs
  local from="${1%/}" to="$2" real
  [ -n "$from" ] && [ "$from" != "/" ] || return 0
  _remap_list+=("$from=$to")
  if [ -d "$from" ]; then
    real="$(cd "$from" && pwd -P)"
    [ "$real" = "$from" ] || _remap_list+=("$real=$to")
  fi
}

_remap_paths() {
  local sep=$'\x1f' enc f m
  case " ${RUSTFLAGS:-} ${CARGO_ENCODED_RUSTFLAGS:-}" in
    *"--remap-path-prefix=$_remap_root=."*) return 0 ;;
  esac

  _remap_list=()
  _remap_add "${HOME:-}" "~"
  _remap_add "$_remap_root" "."
  _remap_add "${CARGO_TARGET_DIR:-}" "/target"
  _remap_add "${RUSTUP_HOME:-${HOME:+$HOME/.rustup}}" "/rustup"
  _remap_add "${CARGO_HOME:-${HOME:+$HOME/.cargo}}" "/cargo"

  local spaced=""
  for m in "${_remap_list[@]}"; do
    case "$m" in *[[:space:]]*) spaced=1 ;; esac
  done

  if [ -z "${CARGO_ENCODED_RUSTFLAGS:-}" ] && [ -z "$spaced" ]; then
    for m in "${_remap_list[@]}"; do
      RUSTFLAGS="${RUSTFLAGS:+$RUSTFLAGS }--remap-path-prefix=$m"
    done
    export RUSTFLAGS
  else
    enc="${CARGO_ENCODED_RUSTFLAGS:-}"
    if [ -z "$enc" ] && [ -n "${RUSTFLAGS:-}" ]; then
      read -r -a f <<< "$RUSTFLAGS"
      for m in "${f[@]}"; do enc="${enc:+$enc$sep}$m"; done
    fi
    for m in "${_remap_list[@]}"; do enc="${enc:+$enc$sep}--remap-path-prefix=$m"; done
    export CARGO_ENCODED_RUSTFLAGS="$enc"
  fi
  unset _remap_list
}

_remap_paths
unset -f _remap_add _remap_paths
unset _remap_root
