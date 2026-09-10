#!/usr/bin/env bash
# Copy the three clips the defect report came from into a directory that is
# allowed to be photographed, and mark it so.
#
# The marker is the whole point. A capture script pointed at ~/Downloads
# would eventually photograph something private; it refuses to run without
# this file, and a directory of someone's own documents will never have one
# by accident. See the OpenDocScan note that this rule came from.
set -euo pipefail
OUT=/tmp/opensubs-public
mkdir -p "$OUT"
for f in zh ja en; do
  cp -f "$HOME/Downloads/$f.mp4" "$OUT/$f.mp4"
done
cat > "$OUT/PUBLISHABLE" <<'EOF'
The three clips attached to the 2026-09-08 defect report, provided for
testing and cleared for screenshots. Nothing else belongs in this
directory.
EOF
echo "$OUT ready"
