#!/usr/bin/env bash
# Generate the sample clip the app offers on its first screen.
#
# Output (committed, unlike the fixtures):
#   apps/web/public/sample.mp4
#   apps/web/public/sample.srt
#
# This is the sibling of make-sample.sh and shares its technique -- real
# speech from macOS `say`, cue times measured from the rendered audio
# rather than guessed -- with three differences that come from this one
# being *shipped* rather than used for testing:
#
#   - It is small. The clip goes into the web bundle and into the iOS and
#     Android app bundles, so it is 960x540 at a high CRF and mono audio.
#     Around 200 KB, against 7 MB for the test fixture.
#   - It is not a test card. `testsrc2` exists to be hostile to subtitles,
#     which is right for checking legibility and wrong for the first
#     thing a visitor sees. This uses a slow gradient in the brand
#     colours: calm, on-brand, and it compresses to almost nothing.
#   - It ships with its .srt. Pressing "Try a sample" loads both, so the
#     full result -- styled subtitles over real footage -- is on screen
#     without downloading an 80 MB speech model first. That is the whole
#     point of offering a sample: the shortest possible path to seeing
#     what the product does.
#
# The spoken lines say what the product is and what to do next, because
# the person reading them has just arrived and the subtitles are the only
# thing they are looking at.
set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)/public"
VIDEO="$OUT_DIR/sample.mp4"
SRT="$OUT_DIR/sample.srt"

for tool in ffmpeg ffprobe say; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool not on PATH" >&2; exit 1; }
done

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

LINES=(
  "This is a sample video, subtitled in your browser."
  "Nothing was uploaded to make these captions."
  "Pick a style, then burn them into the picture."
)

GAP=0.5

echo "generating speech..."
starts=(); ends=(); parts=(); cursor=0
for i in "${!LINES[@]}"; do
  aiff="$WORK/line-$i.aiff"; wav="$WORK/line-$i.wav"
  say -v Samantha -o "$aiff" "${LINES[$i]}"
  ffmpeg -v error -y -i "$aiff" -ar 48000 -ac 1 -c:a pcm_s16le "$wav"
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$wav")
  starts+=("$cursor")
  cursor=$(awk -v c="$cursor" -v d="$dur" 'BEGIN{printf "%.3f", c + d}')
  ends+=("$cursor")
  cursor=$(awk -v c="$cursor" -v g="$GAP" 'BEGIN{printf "%.3f", c + g}')
  parts+=("$wav")
  printf '  %d/%d  %.2fs  %s\n' "$((i + 1))" "${#LINES[@]}" "$dur" "${LINES[$i]}"
done

TOTAL=$(awk -v c="$cursor" 'BEGIN{printf "%.3f", c + 0.8}')

echo "assembling audio..."
SILENCE="$WORK/gap.wav"
ffmpeg -v error -y -f lavfi -i "anullsrc=r=48000:cl=mono" -t "$GAP" -c:a pcm_s16le "$SILENCE"
: > "$WORK/list.txt"
for i in "${!parts[@]}"; do
  echo "file '${parts[$i]}'" >> "$WORK/list.txt"
  [ "$i" -lt $((${#parts[@]} - 1)) ] && echo "file '$SILENCE'" >> "$WORK/list.txt"
done
ffmpeg -v error -y -f concat -safe 0 -i "$WORK/list.txt" -c:a pcm_s16le "$WORK/speech.wav"

echo "building the clip..."
# A slow diagonal gradient through the brand greens into near-black. It
# gives the subtitle renderer a moving, mid-tone background to sit on --
# so the preview shows real contrast behaviour -- while staying almost
# free to encode.
ffmpeg -v error -y \
  -f lavfi -i "gradients=size=960x540:rate=25:c0=0x062b22:c1=0x00c896:c2=0x0b1a17:c3=0x0f766e:speed=0.012:nb_colors=4" \
  -i "$WORK/speech.wav" \
  -t "$TOTAL" \
  -c:v libx264 -crf 30 -preset slow -pix_fmt yuv420p -g 50 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 64k -ac 1 \
  -movflags +faststart \
  "$VIDEO"

echo "writing the matching .srt..."
srt_time() {
  awk -v t="$1" 'BEGIN{
    h = int(t / 3600); m = int((t % 3600) / 60); s = int(t % 60);
    ms = int((t - int(t)) * 1000 + 0.5);
    printf "%02d:%02d:%02d,%03d", h, m, s, ms
  }'
}
: > "$SRT"
for i in "${!LINES[@]}"; do
  {
    echo "$((i + 1))"
    echo "$(srt_time "${starts[$i]}") --> $(srt_time "${ends[$i]}")"
    echo "${LINES[$i]}"
    echo
  } >> "$SRT"
done

echo
printf 'wrote %s (%s, %.1fs)\n' "$VIDEO" \
  "$(du -h "$VIDEO" | cut -f1 | tr -d ' ')" \
  "$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")"
printf 'wrote %s (%d cues)\n' "$SRT" "${#LINES[@]}"
