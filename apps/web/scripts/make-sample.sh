#!/usr/bin/env bash
# Generate a sample clip and a matching .srt for trying the web app by hand.
#
# Output (gitignored, like every other fixture in this repo):
#   testdata/fixtures/web-sample.mp4
#   testdata/fixtures/web-sample.srt
#
# The audio is real speech, produced by macOS `say` -- the same trick the
# design spec uses for deterministic speech fixtures. That matters here
# because the browser app has no ASR: without audio you would be styling
# subtitles against silence and could not tell whether the timings are
# right. With it, you can hear a sentence and watch its cue appear on the
# word.
#
# The .srt is written from the *measured* duration of each spoken clip, not
# from guesses, so the cues and the audio cannot drift apart.
#
# The background is `testsrc2`: deliberately busy and high-contrast, because
# a subtitle that is legible over it is legible over anything. A flat colour
# would make every style look equally good and tell you nothing.
set -euo pipefail

export PATH="/opt/homebrew/bin:$PATH"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# scripts -> web -> apps -> the workspace root.
WORKSPACE="$(cd "$SCRIPT_DIR/../../.." && pwd)"
OUT_DIR="$WORKSPACE/testdata/fixtures"
VIDEO="$OUT_DIR/web-sample.mp4"
SRT="$OUT_DIR/web-sample.srt"

for tool in ffmpeg ffprobe; do
  command -v "$tool" >/dev/null 2>&1 || { echo "error: $tool not on PATH" >&2; exit 1; }
done
if ! command -v say >/dev/null 2>&1; then
  echo "error: this script uses macOS 'say' to generate speech" >&2
  exit 1
fi

mkdir -p "$OUT_DIR"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# What gets spoken. Chosen to exercise the things that actually go wrong:
# a long line that must wrap, a short one that must not, digits, and a
# sentence with punctuation the ASS writer has to escape.
LINES=(
  "The words, burned into the picture."
  "This line is deliberately long enough that it has to wrap onto a second line."
  "Ninety nine point nine percent."
  "Nothing here is uploaded."
  "That's the whole idea."
)

# Silence between sentences, so cues are visibly separated rather than
# running together.
GAP=0.6

echo "generating speech..."
starts=()
ends=()
cursor=0
parts=()

for i in "${!LINES[@]}"; do
  aiff="$WORK/line-$i.aiff"
  wav="$WORK/line-$i.wav"
  say -v Samantha -o "$aiff" "${LINES[$i]}"
  # 48 kHz stereo so every part concatenates without a resample step.
  ffmpeg -v error -y -i "$aiff" -ar 48000 -ac 2 -c:a pcm_s16le "$wav"

  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$wav")
  starts+=("$cursor")
  cursor=$(awk -v c="$cursor" -v d="$dur" 'BEGIN{printf "%.3f", c + d}')
  ends+=("$cursor")
  cursor=$(awk -v c="$cursor" -v g="$GAP" 'BEGIN{printf "%.3f", c + g}')

  parts+=("$wav")
  printf '  %d/%d  %.2fs  %s\n' "$((i + 1))" "${#LINES[@]}" "$dur" "${LINES[$i]}"
done

# A little tail so the last cue is not flush against the end of the file.
TOTAL=$(awk -v c="$cursor" 'BEGIN{printf "%.3f", c + 1.0}')

echo "assembling audio..."
: > "$WORK/list.txt"
SILENCE="$WORK/gap.wav"
ffmpeg -v error -y -f lavfi -i "anullsrc=r=48000:cl=stereo" -t "$GAP" -c:a pcm_s16le "$SILENCE"
for i in "${!parts[@]}"; do
  echo "file '${parts[$i]}'" >> "$WORK/list.txt"
  [ "$i" -lt $((${#parts[@]} - 1)) ] && echo "file '$SILENCE'" >> "$WORK/list.txt"
done
ffmpeg -v error -y -f concat -safe 0 -i "$WORK/list.txt" -c:a pcm_s16le "$WORK/speech.wav"

echo "building the clip..."
# H.264 + AAC: what a phone or a screen recorder actually produces, and what
# every real browser plays. (Headless Chromium does not -- see e2e/smoke.mjs,
# which generates its own WebM for that reason.)
ffmpeg -v error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30" \
  -i "$WORK/speech.wav" \
  -t "$TOTAL" \
  -c:v libx264 -crf 20 -preset medium -pix_fmt yuv420p \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv \
  -c:a aac -b:a 128k \
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
echo "wrote:"
ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO" \
  | awk -v f="$VIDEO" '{printf "  %s  (%.1fs)\n", f, $1}'
echo "  $SRT  (${#LINES[@]} cues)"
