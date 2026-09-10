#!/usr/bin/env bash
# Generate the test fixture corpus. Fixtures are gitignored and regenerated
# on demand; only this script is committed.
#
# Each fixture targets one specific failure mode -- see the spec's fixture
# table. Do not "simplify" this into one representative file.
#
# WHICH FFMPEG: two builds exist on dev machines here and they are NOT
# interchangeable.
#   - Bare `ffmpeg` on PATH (Homebrew's regular formula) has NO libass --
#     the `ass`, `subtitles` and `drawtext` filters do not exist in it.
#   - `/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg` is keg-only and has
#     everything (libass, libplacebo, whisper, ...).
# This script does NOT need libass -- none of these fixtures burn
# subtitles, so bare `ffmpeg` is fine for fixture generation. Task 23 (and
# anything else that burns subtitles) DOES need libass and will fail
# confusingly against the wrong binary. Put ffmpeg-full first on PATH for
# that work:
#   export PATH="/opt/homebrew/opt/ffmpeg-full/bin:$PATH"
# Do not hardcode that keg path as this script's interpreter or requirement
# -- a Linux CI box will not have it, and bare ffmpeg is sufficient here.
set -euo pipefail

OUT="$(cd "$(dirname "$0")/.." && pwd)/testdata/fixtures"
mkdir -p "$OUT"

# Clean up the rotated-90 intermediate file even if the remux step below
# fails partway through.
trap 'rm -f "$OUT/.rotated-90-plain.mp4"' EXIT

say() { printf '  %s\n' "$1"; }

# Baseline: 720p30, tagged BT.709, with audio.
#
# NOTE: the generic -color_primaries/-color_trc AVOptions do not reach
# libx264's VUI in this ffmpeg build (only -colorspace/-color_range do) --
# verified empirically. -x264-params is the reliable way to tag the
# bitstream, so both are set: the generic options for tools that read the
# AVOption side, -x264-params for what actually lands in the VUI.
say "720p30 baseline"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=10" \
  -f lavfi -i "sine=frequency=440:duration=10" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off" \
  -c:a aac -shortest "$OUT/720p30.mp4"

# Fractional frame rate: catches frame-snapping errors.
say "1080p29.97 fractional fps"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1920x1080:rate=30000/1001:duration=10" \
  -f lavfi -i "sine=frequency=440:duration=10" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -x264-params "colorprim=bt709:transfer=bt709:colormatrix=bt709:fullrange=off" \
  -c:a aac -shortest "$OUT/1080p2997.mp4"

# Variable frame rate: catches judder from forced CFR.
#
# NOTE: `select='not(mod(n,3))'` decimates a uniform source at a fixed
# stride, so despite `-fps_mode vfr` every kept frame ends up exactly
# 1/20s apart -- verified empirically (single unique inter-frame gap across
# all 200 frames). That is constant frame rate wearing a VFR label, not a
# real test of judder handling. `lt(mod(n,10),7)` keeps a bursty 7-of-10
# run instead, producing two distinct inter-frame gaps (~1/60s within a
# burst, ~4/60s across each dropped run) -- genuine variable spacing.
say "VFR"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=60:duration=10" \
  -vf "select='lt(mod(n,10),7)'" -fps_mode vfr \
  -c:v libx264 -crf 18 -pix_fmt yuv420p "$OUT/vfr-phone.mp4"

# Display-matrix rotation: catches transposed PlayRes.
#
# NOTE: `-metadata:s:v:0 rotate=90` was verified empirically to produce NO
# rotation side data (or even a "rotate" tag) with this ffmpeg build -- the
# fixture would be silently useless. The reliable way to get a genuine
# side_data_list rotation entry is `-display_rotation` + `-noautorotate` as
# INPUT options during a stream-copy remux (re-encoding drops the side data
# somewhere in the libx264 path). So: encode a plain unrotated clip, then
# remux it with the rotation tag attached via stream copy.
say "rotated 90"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=5" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p "$OUT/.rotated-90-plain.mp4"
ffmpeg -hide_banner -loglevel error -y \
  -noautorotate -display_rotation:v:0 -90 \
  -i "$OUT/.rotated-90-plain.mp4" \
  -c copy "$OUT/rotated-90.mp4"
rm -f "$OUT/.rotated-90-plain.mp4"

# HLG HDR: catches missing HDR detection.
say "HDR HLG"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1920x1080:rate=30:duration=5" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p10le \
  -colorspace bt2020nc -color_primaries bt2020 -color_trc arib-std-b67 -color_range tv \
  -x264-params "colorprim=bt2020:transfer=arib-std-b67:colormatrix=bt2020nc:fullrange=off" \
  "$OUT/hdr-hlg.mp4"

# No audio stream: catches a missing `?` on -map 0:a:0.
say "silent"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=5" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p -an "$OUT/silent.mp4"

# SD BT.601: catches colourspace conversion errors.
say "BT.601 SD"
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=720x480:rate=30:duration=5" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p \
  -colorspace smpte170m -color_primaries smpte170m -color_trc smpte170m -color_range tv \
  -x264-params "colorprim=smpte170m:transfer=smpte170m:colormatrix=smpte170m:fullrange=off" \
  "$OUT/bt601-sd.mp4"

# Deterministic speech with known ground truth, for real-ASR WER gating.
# `say` is macOS-only; skipped elsewhere, and the ASR tests skip with it.
if command -v say >/dev/null 2>&1; then
  say "TTS speech with known transcript"
  TXT="The quick brown fox jumps over the lazy dog."
  /usr/bin/say -v Samantha -o "$OUT/speech.aiff" "$TXT"
  ffmpeg -hide_banner -loglevel error -y -i "$OUT/speech.aiff" \
    -ar 16000 -ac 1 -c:a pcm_s16le "$OUT/speech.wav"
  rm -f "$OUT/speech.aiff"
  printf '%s\n' "$TXT" > "$OUT/speech.reference.txt"
fi

# --------------------------------------------------------------------------
# Verification pass.
#
# `set -euo pipefail` only trips on a nonzero ffmpeg exit code, and every
# one of the three fixtures fixed above (rotated-90, hdr-hlg/bt601-sd/
# 720p30/1080p2997's colour tags, vfr-phone) was written *successfully*
# while silently failing to carry the property it exists to test. A future
# ffmpeg release that changes -display_rotation handling or stops
# propagating -x264-params to the VUI would reproduce that bug again,
# silently, with tests depending on these fixtures passing while testing
# nothing. Re-probe every fixture here and fail loudly, naming the fixture
# and the property, if any of them regress.
say "verifying fixture properties"

verify_fail() {
  printf 'FIXTURE VERIFICATION FAILED: %s: %s\n' "$1" "$2" >&2
  exit 1
}

# Single scalar stream field, e.g. color_transfer or r_frame_rate, from the
# first video stream.
probe_video_field() {
  ffprobe -v error -select_streams v:0 -show_entries "stream=$2" \
    -of default=noprint_wrappers=1:nokey=1 "$OUT/$1" 2>/dev/null | head -1
}

assert_color_transfer() {
  local file="$1" expected="$2" name="$3" got
  got="$(probe_video_field "$file" color_transfer)"
  [ "$got" = "$expected" ] \
    || verify_fail "$name" "expected color_transfer=$expected, got '${got:-<none>}'"
}

assert_frame_rate() {
  local file="$1" expected="$2" name="$3" got
  got="$(probe_video_field "$file" r_frame_rate)"
  [ "$got" = "$expected" ] \
    || verify_fail "$name" "expected r_frame_rate=$expected, got '${got:-<none>}'"
}

assert_no_audio() {
  local file="$1" name="$2" got
  got="$(ffprobe -v error -select_streams a -show_entries stream=codec_type \
    -of csv=p=0 "$OUT/$file" 2>/dev/null)"
  [ -z "$got" ] \
    || verify_fail "$name" "expected no audio stream, but ffprobe found one"
}

# Exact match, like the colour and frame-rate assertions above. "Any nonzero
# rotation" would accept 90 or 180 just as happily as -90, and the whole
# point of this fixture is that a *specific* rotation transposes the display
# dimensions in a specific direction.
assert_rotation() {
  local file="$1" expected="$2" name="$3" got
  got="$(ffprobe -v error -select_streams v:0 \
    -show_entries stream_side_data=rotation \
    -of default=noprint_wrappers=1:nokey=1 "$OUT/$file" 2>/dev/null | head -1)"
  [ "$got" = "$expected" ] \
    || verify_fail "$name" "expected rotation=$expected, got '${got:-<none>}'"
}

# `pts_time`, not `pkt_pts_time` -- the latter was removed in ffmpeg 8 and
# silently returns nothing, which would make this check vacuously pass.
assert_variable_frame_spacing() {
  local file="$1" name="$2" distinct
  distinct="$(ffprobe -v error -select_streams v:0 -show_entries frame=pts_time \
    -of csv=p=0 "$OUT/$file" 2>/dev/null \
    | awk -F',' '{print $1}' \
    | awk 'NR>1{printf "%.4f\n", $1-prev} {prev=$1}' \
    | sort -u | wc -l | tr -d ' ')"
  [ "${distinct:-0}" -ge 2 ] \
    || verify_fail "$name" "expected more than one distinct inter-frame gap (real VFR), got $distinct"
}

assert_frame_rate    "720p30.mp4"     "30/1"         "720p30"
assert_color_transfer "720p30.mp4"    "bt709"        "720p30"
assert_frame_rate    "1080p2997.mp4"  "30000/1001"   "1080p2997"
assert_color_transfer "1080p2997.mp4" "bt709"        "1080p2997"
assert_variable_frame_spacing "vfr-phone.mp4" "vfr-phone"
assert_rotation      "rotated-90.mp4" "-90"          "rotated-90"
assert_color_transfer "hdr-hlg.mp4"   "arib-std-b67" "hdr-hlg"
assert_no_audio      "silent.mp4"     "silent"
assert_color_transfer "bt601-sd.mp4"  "smpte170m"    "bt601-sd"

say "all fixture properties verified"
printf 'Fixtures written to %s\n' "$OUT"
