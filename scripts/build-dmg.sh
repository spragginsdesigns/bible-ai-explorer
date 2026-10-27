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
# Set SUREWORD_DMG_BACKEND=headless for unattended builds. This uses pinned
# dmgbuild 1.6.7 through uv and writes the same layout without Finder automation.
# The default Finder-backed create-dmg path stays available for interactive use.
#
# The icon coordinates here and the arrow in the background art were tuned
# together — if one moves, move both. Requires `brew install create-dmg`.
#
# Release provenance: the app must carry the build record install-mac.sh
# writes next to it (<app>.build / <app>.sources), its code signature must
# still match that record, and macos/ must still match the source it was
# built from; otherwise nothing is packaged. The record is carried forward
# into <output.dmg>.provenance and <output.dmg>.sources, which release-dmg.sh
# checks before publishing. See scripts/lib/release-provenance.sh.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/macos/build-release.noindex/Build/Products/Release/SureWord.app}"
OUT="${2:-$ROOT/macos/SureWord.dmg}"
DMGDIR="$ROOT/macos/dmg"
# shellcheck source=lib/release-provenance.sh
. "$ROOT/scripts/lib/release-provenance.sh"

[ -d "$APP" ] || { echo "app not found: $APP (build Release first)" >&2; exit 1; }

release_require_app_build "$APP" "$ROOT" macos || exit 1

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp -R "$APP" "$STAGE/"

rm -f "$OUT" "$OUT.provenance" "$OUT.sources"
case "${SUREWORD_DMG_BACKEND:-finder}" in
headless)
  command -v uv >/dev/null 2>&1 || { echo "uv is required for headless DMG packaging" >&2; exit 1; }
  uv run --with dmgbuild==1.6.7 dmgbuild \
    -s "$ROOT/scripts/dmg-settings.py" -D "root=$ROOT" -D "app=$STAGE/SureWord.app" \
    "SureWord" "$OUT"
  ;;
finder)
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
  ;;
*) echo "Unknown SUREWORD_DMG_BACKEND (use finder or headless)" >&2; exit 1 ;;
esac

cp "$APP.sources" "$OUT.sources"
printf 'version=%s\ndmgSha256=%s\nappCdhash=%s\nsourceCommit=%s\nsourceDirtyFiles=%s\nsourceSha256=%s\n' \
  "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist")" \
  "$(release_sha256 "$OUT")" \
  "$(release_app_build_value "$APP" cdhash)" \
  "$(release_app_build_value "$APP" sourceCommit)" \
  "$(release_app_build_value "$APP" sourceDirtyFiles)" \
  "$(release_app_build_value "$APP" sourceSha256)" \
  > "$OUT.provenance"

echo "wrote $OUT (provenance in $OUT.provenance)"
