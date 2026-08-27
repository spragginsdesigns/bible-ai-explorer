#!/usr/bin/env bash
# Build the styled SureWord installer DMG.
#
#   scripts/build-dmg.sh [path/to/SureWord.app] [output.dmg]
#
# Expects a Release build (defaults to the xcodebuild path below) and the
# committed art in macos/dmg/: background.tiff (HiDPI, from
# make-dmg-background.py + tiffutil) and SureWord.icns (volume icon, from the
# appiconset via iconutil).
#
# The icon coordinates here and the arrow in the background art were tuned
# together — if one moves, move both. Requires `brew install create-dmg`.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/macos/build-release.noindex/Build/Products/Release/SureWord.app}"
OUT="${2:-$ROOT/macos/SureWord.dmg}"
DMGDIR="$ROOT/macos/dmg"

[ -d "$APP" ] || { echo "app not found: $APP (build Release first)" >&2; exit 1; }

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"

rm -f "$OUT"
create-dmg \
  --volname "SureWord" \
  --volicon "$DMGDIR/SureWord.icns" \
  --background "$DMGDIR/background.tiff" \
  --window-pos 200 140 \
  --window-size 660 448 \
  --icon-size 128 \
  --icon "SureWord.app" 165 235 \
  --hide-extension "SureWord.app" \
  --app-drop-link 495 235 \
  --no-internet-enable \
  "$OUT" "$STAGE"

echo "wrote $OUT"
