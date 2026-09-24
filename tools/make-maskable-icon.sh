#!/bin/sh
# Regenerates icons/icon-maskable-512.png (macOS `sips`): the brand mark at 78%
# on a white 512 canvas so it stays inside the maskable safe zone.
set -e
cd "$(dirname "$0")/.."
T=$(mktemp -t kmask).png
sips -z 400 400 icons/icon-512.png --out "$T" >/dev/null
sips --padToHeightWidth 512 512 --padColor FFFFFF "$T" --out icons/icon-maskable-512.png >/dev/null
rm -f "$T"
