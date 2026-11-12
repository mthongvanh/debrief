#!/usr/bin/env bash
# Screenshots each SVG at the width a reader sees it (850 px by default), so text size and
# collisions show as they will. Uses a browser already installed; d2's own PNG export needs a
# separate Chromium download.
# Usage: look.sh <out-dir> <file.svg>... (WIDTH=1200 look.sh ... for another width)
set -euo pipefail

out_dir="${1:?usage: look.sh <out-dir> <file.svg>...}"
shift
width="${WIDTH:-850}"
chrome=""
for candidate in \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  "/Applications/Chromium.app/Contents/MacOS/Chromium" \
  "$(command -v google-chrome || true)" "$(command -v chromium || true)"; do
  if [[ -n "$candidate" && -x "$candidate" ]]; then chrome="$candidate"; break; fi
done
if [[ -z "$chrome" ]]; then
  echo "look.sh: no Chrome or Chromium found; the diagrams were not looked at" >&2
  exit 1
fi

mkdir -p "$out_dir"
# Chrome loads the page as a file:// URL, which must be absolute; the brief's lookDir is relative.
out_dir="$(cd "$out_dir" && pwd)"
for svg in "$@"; do
  # viewBox="minX minY W H": height scaled to the display width.
  read -r vw vh < <(grep -o 'viewBox="[^"]*"' "$svg" | head -1 | tr -d '"' | awk '{print $3, $4}')
  height=$(awk -v w="$width" -v vw="$vw" -v vh="$vh" 'BEGIN { printf "%d", w * vh / vw + 1 }')
  png="$out_dir/$(basename "${svg%.svg}").png"
  html="$out_dir/.look-$$.html"
  printf '<html><body style="margin:0"><img src="file://%s" style="width:%spx;display:block"></body></html>' \
    "$(cd "$(dirname "$svg")" && pwd)/$(basename "$svg")" "$width" > "$html"
  rm -f "$png" # so a screenshot from an earlier run can't pass the check below
  "$chrome" --headless=new --disable-gpu --hide-scrollbars --allow-file-access-from-files \
    --window-size="$width,$height" --screenshot="$png" "file://$html" 2>/dev/null || true
  rm -f "$html"
  if [[ ! -s "$png" ]]; then
    echo "look.sh: Chrome wrote no screenshot of $svg (expected $png); it was not looked at" >&2
    exit 1
  fi
  echo "$png  (${vw}x${vh} shown at ${width}x${height}; text at $(awk -v w="$width" -v vw="$vw" 'BEGIN { printf "%d", 100 * w / vw }')%)"
done
