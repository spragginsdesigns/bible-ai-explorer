#!/usr/bin/env bash
# Release the built SureWord Android APK to GitHub Releases.
#
# The web app's download links point at
#   releases/latest/download/SureWord.apk  (and .../SureWord.dmg)
# "latest" is ONE release, so every release — Android or macOS — must carry
# ALL platform assets under their fixed names, or the other platforms' links
# 404. This script re-attaches the other platforms' current assets from the
# previous latest release; the macOS release flow in macos/README.md does the
# same for the APK.
#
# Usage:
#   bash mobile/scripts/release-apk.sh                      # release the APK already built by push-phone.sh / gradle
#   bash mobile/scripts/release-apk.sh --notes "..."        # custom release notes
#   bash mobile/scripts/release-apk.sh --notes-file <path>  # notes from a file
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
MOBILE_DIR="$REPO_ROOT/mobile"
APK="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"

NOTES=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes) NOTES="$2"; shift 2 ;;
    --notes-file) NOTES="$(cat "$2")"; shift 2 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

log() { echo "[release-apk] $*"; }

command -v gh >/dev/null 2>&1 || { echo "gh CLI is required (https://cli.github.com)."; exit 1; }
[[ -f "$APK" ]] || { echo "APK not found at $APK — build it first (bash mobile/scripts/push-phone.sh or gradle assembleRelease)."; exit 1; }

# Read app.json via a relative path — Windows node can't resolve Git-Bash
# /c/... absolute paths in require().
VERSION="$(cd "$MOBILE_DIR" && node -p "require('./app.json').expo.version")"
TAG="android-v$VERSION"

# Pull the other platforms' current assets off the previous latest release so
# the new one keeps serving every download link.
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
gh release download --pattern 'SureWord.dmg' --pattern 'SureWord.ipa' \
  --dir "$STAGING" --clobber 2>/dev/null || true

# Stage the APK under its fixed asset name (the `path#name` rename syntax is
# not honored by gh release create on all versions, so rename on disk).
cp "$APK" "$STAGING/SureWord.apk"

ASSETS=("$STAGING/SureWord.apk")
for f in "$STAGING/SureWord.dmg" "$STAGING/SureWord.ipa"; do
  [[ -f "$f" ]] && ASSETS+=("$f")
done

if [[ -z "$NOTES" ]]; then
  NOTES="SureWord for Android $VERSION — see \`mobile/CHANGELOG.md\` for what's new."
fi

if gh release view "$TAG" >/dev/null 2>&1; then
  log "Release $TAG already exists — replacing it."
  gh release delete "$TAG" --yes
  git -C "$REPO_ROOT" push origin ":refs/tags/$TAG" 2>/dev/null || true
fi

log "Creating $TAG with: ${ASSETS[*]}"
gh release create "$TAG" "${ASSETS[@]}" \
  --title "SureWord for Android $VERSION" \
  --notes "$NOTES"

log "Released. https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest"
