#!/usr/bin/env bash
# Build the ffmpeg and ffprobe the Mac App Store build carries: LGPL, from source.
#
#   apps/desktop/scripts/ffmpeg-lgpl.sh [out-dir]
#       (default: apps/desktop/src-tauri/bundled/ffmpeg-lgpl, git-ignored)
#
# The direct-download Mac app carries a prebuilt ffmpeg (fetch-bundled.sh)
# configured with --enable-gpl and libx264 among others. One GPL part makes
# the whole binary GPL, and the GPL's terms conflict with the App Store's,
# so the store build carries this one instead, built without any of them:
#
#   - H.264 is encoded by the system's VideoToolbox (h264_videotoolbox),
#     which is why the store build burns with it rather than libx264;
#   - subtitles are drawn by libass, with FreeType, FriBidi and HarfBuzz;
#   - HDR sources are tonemapped by zscale (zimg), as in the other build;
#   - AV1 sources decode with dav1d.
#
#   FreeType (FTL)   FriBidi (LGPL-2.1)   HarfBuzz (MIT)   libass (ISC)
#   dav1d (BSD-2)    zimg (WTFPL)          FFmpeg itself: LGPL-2.1-or-later
#
# Everything is static except the system's own libraries and frameworks, so
# the two binaries run on a Mac with nothing installed. The store build
# signs them as sandboxed helpers inside the app; nothing is downloaded or
# run from outside the bundle at run time.
#
# The sources are pinned by SHA-256 and kept in <out-dir>/src, the licence
# of each part in <out-dir>/licences, and the exact configure line in
# <out-dir>/BUILD.txt. The store build copies all three into the app, so
# the corresponding source travels with the binary, as the LGPL asks.
#
# It refuses to finish if the result is not LGPL (ffmpeg -L), if it links any
# library outside /usr/lib and /System, if either binary names the machine
# that built it, or if a filter, encoder or decoder OpenSubs uses is missing.
#
# Tools: a C/C++ compiler (Xcode's command line tools), cmake, ninja,
# pkg-config, and autoconf/automake/libtool for zimg. Apple silicon,
# macOS 13 and later, like the store build. Adapted from OpenDub's
# installer/macos/ffmpeg.sh.
set -euo pipefail
cd "$(dirname "$0")"
OUT="$(mkdir -p "${1:-../src-tauri/bundled/ffmpeg-lgpl}" && cd "${1:-../src-tauri/bundled/ffmpeg-lgpl}" && pwd)"
WORK="$OUT/work"; SRC="$OUT/src"; PREFIX="$WORK/prefix"; LIC="$OUT/licences"
# The tools first: a run that stops for want of one must not have cleared
# the previous build's licences on its way.
for tool in cmake ninja pkg-config autoreconf libtoolize; do
  command -v "$tool" >/dev/null || { echo "ffmpeg-lgpl: $tool is not on PATH"; exit 1; }
done
rm -rf "$WORK" "$LIC"
mkdir -p "$WORK" "$SRC" "$PREFIX" "$LIC"
export MACOSX_DEPLOYMENT_TARGET=13.0
ARCH=arm64
JOBS=$(sysctl -n hw.ncpu)

# name  url  sha256
SOURCES=(
  "ffmpeg-7.1.1.tar.xz https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz 733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1"
  "freetype-2.13.3.tar.xz https://download.savannah.gnu.org/releases/freetype/freetype-2.13.3.tar.xz 0550350666d427c74daeb85d5ac7bb353acba5f76956395995311a9c6f063289"
  "fribidi-1.0.16.tar.xz https://github.com/fribidi/fribidi/releases/download/v1.0.16/fribidi-1.0.16.tar.xz 1b1cde5b235d40479e91be2f0e88a309e3214c8ab470ec8a2744d82a5a9ea05c"
  "harfbuzz-10.4.0.tar.xz https://github.com/harfbuzz/harfbuzz/releases/download/10.4.0/harfbuzz-10.4.0.tar.xz 480b6d25014169300669aa1fc39fb356c142d5028324ea52b3a27648b9beaad8"
  "libass-0.17.3.tar.xz https://github.com/libass/libass/releases/download/0.17.3/libass-0.17.3.tar.xz eae425da50f0015c21f7b3a9c7262a910f0218af469e22e2931462fed3c50959"
  "dav1d-1.5.1.tar.xz https://downloads.videolan.org/pub/videolan/dav1d/1.5.1/dav1d-1.5.1.tar.xz 401813f1f89fa8fd4295805aa5284d9aed9bc7fc1fdbe554af4292f64cbabe21"
  "zimg-3.0.5.tar.gz https://github.com/sekrit-twc/zimg/archive/refs/tags/release-3.0.5.tar.gz a9a0226bf85e0d83c41a8ebe4e3e690e1348682f6a2a7838f1b8cbff1b799bcf"
)

say() { printf '\n== %s\n' "$1"; }

say "sources"
for s in "${SOURCES[@]}"; do
  set -- $s
  if [ ! -f "$SRC/$1" ]; then curl -fsSL "$2" -o "$SRC/$1.part" && mv "$SRC/$1.part" "$SRC/$1"; fi
  got=$(shasum -a 256 "$SRC/$1" | cut -d' ' -f1)
  [ "$got" = "$3" ] || { echo "$1: sha256 $got, expected $3"; exit 1; }
  echo "  $1 ok"
done
# Nothing else in src/: it is copied into the app as the corresponding source.
for f in "$SRC"/*; do
  case "$(basename "$f")" in
    ffmpeg-7.1.1.tar.xz|freetype-2.13.3.tar.xz|fribidi-1.0.16.tar.xz|harfbuzz-10.4.0.tar.xz|libass-0.17.3.tar.xz|dav1d-1.5.1.tar.xz|zimg-3.0.5.tar.gz) ;;
    *) rm -rf "$f" ;;
  esac
done

# Meson for FriBidi, HarfBuzz and dav1d, in a venv of its own; ninja and
# pkg-config are the only other tools, and Homebrew's are fine as tools.
if [ ! -x "$WORK/venv/bin/meson" ]; then
  python3 -m venv "$WORK/venv" && "$WORK/venv/bin/pip" -q install meson==1.6.1
fi
MESON="$WORK/venv/bin/meson"
# Only this prefix's .pc files: a Homebrew library found by accident would be
# linked as a /opt/homebrew dylib, which no other Mac has.
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig" PKG_CONFIG_PATH=""
# -ffile-prefix-map: a source file's name, where the compiler records one
# (__FILE__ in an assertion), is written relative to the build folder, which
# is under the builder's home and names their login.
CFLAGS="-arch $ARCH -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET -O2 -ffile-prefix-map=$WORK=."
export CFLAGS CXXFLAGS="$CFLAGS" LDFLAGS="-arch $ARCH -mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"

unpack() { rm -rf "$WORK/$1" && tar -xf "$SRC/$1.tar.${2:-xz}" -C "$WORK"; }
meson_build() {  # dir, options...
  local d=$1; shift
  ( cd "$WORK/$d" && "$MESON" setup _b --prefix="$PREFIX" --libdir=lib --buildtype=release \
      --default-library=static "$@" >/dev/null && ninja -C _b >/dev/null && ninja -C _b install >/dev/null )
}

# zlib, bzip2 and iconv are the system's. FreeType's .pc names zlib's, which
# macOS does not install, so it is written here.
mkdir -p "$PREFIX/lib/pkgconfig"
printf 'Name: zlib\nDescription: the system zlib\nVersion: 1.2.12\nLibs: -lz\nCflags:\n' > "$PREFIX/lib/pkgconfig/zlib.pc"

say "freetype"
unpack freetype-2.13.3
cmake -S "$WORK/freetype-2.13.3" -B "$WORK/freetype-2.13.3/_b" -G Ninja -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_OSX_ARCHITECTURES=$ARCH -DCMAKE_OSX_DEPLOYMENT_TARGET=$MACOSX_DEPLOYMENT_TARGET \
  -DBUILD_SHARED_LIBS=OFF -DFT_DISABLE_BZIP2=ON -DFT_DISABLE_PNG=ON -DFT_DISABLE_HARFBUZZ=ON \
  -DFT_DISABLE_BROTLI=ON -DFT_REQUIRE_ZLIB=ON >/dev/null
ninja -C "$WORK/freetype-2.13.3/_b" install >/dev/null
cp "$WORK/freetype-2.13.3/LICENSE.TXT" "$LIC/freetype-LICENSE.TXT"
cp "$WORK/freetype-2.13.3/docs/FTL.TXT" "$LIC/freetype-FTL.TXT"

say "fribidi"
unpack fribidi-1.0.16
meson_build fribidi-1.0.16 -Ddocs=false -Dbin=false -Dtests=false
cp "$WORK/fribidi-1.0.16/COPYING" "$LIC/fribidi-COPYING"

say "harfbuzz"
unpack harfbuzz-10.4.0
meson_build harfbuzz-10.4.0 -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled -Dcairo=disabled \
  -Dicu=disabled -Dgraphite2=disabled -Dchafa=disabled -Dcoretext=disabled -Dtests=disabled \
  -Ddocs=disabled -Dutilities=disabled -Dintrospection=disabled -Dbenchmark=disabled
cp "$WORK/harfbuzz-10.4.0/COPYING" "$LIC/harfbuzz-COPYING"

say "libass"
unpack libass-0.17.3
( cd "$WORK/libass-0.17.3" && ./configure --prefix="$PREFIX" --disable-shared --enable-static \
    --disable-fontconfig --disable-libunibreak --enable-coretext --disable-require-system-font-provider >/dev/null \
  && make -j"$JOBS" >/dev/null && make install >/dev/null )
cp "$WORK/libass-0.17.3/COPYING" "$LIC/libass-COPYING"

say "dav1d"
unpack dav1d-1.5.1
meson_build dav1d-1.5.1 -Denable_tools=false -Denable_tests=false -Denable_examples=false
cp "$WORK/dav1d-1.5.1/COPYING" "$LIC/dav1d-COPYING"

say "zimg"
rm -rf "$WORK/zimg-release-3.0.5" && tar -xzf "$SRC/zimg-3.0.5.tar.gz" -C "$WORK"
( cd "$WORK/zimg-release-3.0.5" && ./autogen.sh >/dev/null 2>&1 \
  && ./configure --prefix="$PREFIX" --disable-shared --enable-static >/dev/null \
  && make -j"$JOBS" >/dev/null && make install >/dev/null )
cp "$WORK/zimg-release-3.0.5/COPYING" "$LIC/zimg-COPYING"

say "ffmpeg"
unpack ffmpeg-7.1.1
# --disable-autodetect, then each system library named: otherwise configure
# picks up whatever Homebrew has (lzma, SDL2, libxcb...) as a dylib.
# The prefix is compiled in twice: as the data directory ffmpeg looks in for
# presets, and in the configure line -buildconf prints. A prefix under the
# build folder would put the builder's home and login name into both
# binaries, so it is a neutral one, and make install puts the files under
# the build folder with DESTDIR instead.
CONFIGURE=(--prefix=/usr/local --arch=$ARCH --cc=clang
  --extra-cflags="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET" --extra-ldflags="-mmacosx-version-min=$MACOSX_DEPLOYMENT_TARGET"
  --extra-libs=-lc++
  --pkg-config-flags=--static --enable-static --disable-shared
  --disable-autodetect --enable-videotoolbox --enable-audiotoolbox --enable-zlib --enable-bzlib --enable-iconv
  --enable-libass --enable-libfreetype --enable-libharfbuzz --enable-libfribidi --enable-libdav1d --enable-libzimg
  --disable-ffplay --disable-doc --disable-debug --disable-network)
echo "ffmpeg 7.1.1 configure ${CONFIGURE[*]}" | sed "s|$WORK|<work>|g" > "$OUT/BUILD.txt"
( cd "$WORK/ffmpeg-7.1.1" && ./configure "${CONFIGURE[@]}" >/dev/null && make -j"$JOBS" >/dev/null \
    && make install DESTDIR="$WORK/ffmpeg-out" >/dev/null )
cp "$WORK/ffmpeg-out/usr/local/bin/ffmpeg" "$WORK/ffmpeg-out/usr/local/bin/ffprobe" "$OUT/"
strip "$OUT/ffmpeg" "$OUT/ffprobe"
cp "$WORK/ffmpeg-7.1.1/COPYING.LGPLv2.1" "$LIC/ffmpeg-COPYING.LGPLv2.1"
cp "$WORK/ffmpeg-7.1.1/LICENSE.md" "$LIC/ffmpeg-LICENSE.md"

say "is it what the store build may carry?"
FF="$OUT/ffmpeg"
"$FF" -hide_banner -L 2>&1 | tr -s ' \n' ' ' | grep -c "GNU Lesser General Public License" >/dev/null || { echo "not LGPL"; exit 1; }
if "$FF" -hide_banner -buildconf | grep -cE -- '--enable-(gpl|nonfree|version3)|libx26[45]|vidstab|postproc' >/dev/null; then
  echo "configured with a GPL or nonfree part"; exit 1
fi
for bin in "$OUT/ffmpeg" "$OUT/ffprobe"; do
  if otool -L "$bin" | tail -n +2 | awk '{print $1}' | grep -vE '^(/usr/lib/|/System/Library/)'; then
    echo "$(basename "$bin") links a library a Mac does not have (above)"; exit 1
  fi
  minos=$(otool -l "$bin" | awk '/LC_BUILD_VERSION/{f=1} f&&/minos/{print $2; exit}')
  [ "$minos" = "13.0" ] || { echo "$(basename "$bin") needs macOS $minos"; exit 1; }
done
# Nothing in either binary names the machine that built it.
for bin in "$OUT/ffmpeg" "$OUT/ffprobe"; do
  for p in "$HOME/" "$WORK/" "$OUT/"; do
    if LC_ALL=C grep -qaF "$p" "$bin"; then echo "$(basename "$bin") carries the build path $p"; exit 1; fi
  done
  if LC_ALL=C grep -qaE '/Users/[^/[:space:]]+/' "$bin"; then
    echo "$(basename "$bin") carries a home-directory path:"; LC_ALL=C grep -aoE '/Users/[^/[:space:]]+/' "$bin" | sort | uniq -c; exit 1
  fi
done
# What OpenSubs asks of it: probe (ffprobe), the audio Whisper hears
# (pcm_s16le WAV), and the burn: tonemap HDR, scale, draw the subtitles,
# encode H.264, copy the audio.
enc=$("$FF" -hide_banner -encoders); flt=$("$FF" -hide_banner -filters); dec=$("$FF" -hide_banner -decoders)
for e in h264_videotoolbox pcm_s16le; do grep -qE "^ \S+ $e " <<<"$enc" || { echo "no encoder $e"; exit 1; }; done
for f in ass subtitles scale zscale tonemap format; do grep -qE "^ \S+ $f " <<<"$flt" || { echo "no filter $f"; exit 1; }; done
for d in h264 hevc vp9 libdav1d prores aac mp3 opus pcm_s16le; do grep -qE "^ \S+ $d " <<<"$dec" || { echo "no decoder $d"; exit 1; }; done
rm -rf "$WORK"
echo "  LGPL, system libraries only, macOS 13+"
ls -la "$OUT/ffmpeg" "$OUT/ffprobe"
