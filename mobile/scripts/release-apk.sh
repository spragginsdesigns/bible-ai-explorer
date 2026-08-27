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
ARTIFACT_MANIFEST="$MOBILE_DIR/android/app/build/outputs/release-artifacts.env"

NOTES=""
PREFLIGHT=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --notes) NOTES="$2"; shift 2 ;;
    --notes-file) NOTES="$(cat "$2")"; shift 2 ;;
    --preflight) PREFLIGHT=1; shift ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
done

log() { echo "[release-apk] $*"; }

command -v gh >/dev/null 2>&1 || { echo "gh CLI is required (https://cli.github.com)."; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "gh is not authenticated; run gh auth login first."; exit 1; }
[[ -f "$APK" ]] || { echo "APK not found at $APK — build it first (bash mobile/scripts/push-phone.sh or gradle assembleRelease)."; exit 1; }
GH_REPO="$(cd "$REPO_ROOT" && gh repo view --json nameWithOwner --jq .nameWithOwner)"
[[ -n "$GH_REPO" ]] || { echo "Could not resolve the GitHub repository."; exit 1; }

# Read app.json via a relative path — Windows node can't resolve Git-Bash
# /c/... absolute paths in require().
VERSION="$(cd "$MOBILE_DIR" && node -p "require('./app.json').expo.version")"
VERSION_CODE="$(cd "$MOBILE_DIR" && node -p "require('./app.json').expo.android.versionCode")"
TAG="android-v$VERSION"

[[ -f "$ARTIFACT_MANIFEST" ]] || {
  echo "Release artifact manifest not found at $ARTIFACT_MANIFEST — rebuild first."; exit 1;
}
manifest_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ARTIFACT_MANIFEST"
}
[[ "$(manifest_value versionName)" == "$VERSION" \
  && "$(manifest_value versionCode)" == "$VERSION_CODE" ]] || {
  echo "The APK manifest does not match app.json $VERSION ($VERSION_CODE) — rebuild first."; exit 1;
}
[[ "$(manifest_value apkSha256)" == "$(sha256sum "$APK" | awk '{print $1}')" ]] || {
  echo "The APK hash does not match its release artifact manifest — rebuild first."; exit 1;
}

# Pull each other platform from its newest platform-specific release. This is
# fail-closed for the DMG: persistent releases/latest links must never lose the
# current macOS download just because Android became the newest release.
STAGING="$(mktemp -d)"
trap 'rm -rf "$STAGING"' EXIT
MACOS_TAG="$(gh release list --repo "$GH_REPO" --limit 100 \
  --json tagName,isDraft,isPrerelease,publishedAt \
  --jq '[.[] | select(.isDraft == false and .isPrerelease == false and (.tagName | startswith("macos-v")))] | sort_by(.publishedAt) | last | .tagName // empty')"
[[ -n "$MACOS_TAG" ]] || { echo "No published macOS release exists to preserve."; exit 1; }
gh release download "$MACOS_TAG" --repo "$GH_REPO" --pattern 'SureWord.dmg' \
  --dir "$STAGING" --clobber \
  || { echo "Could not preserve SureWord.dmg from $MACOS_TAG."; exit 1; }

IOS_TAG="$(gh release list --repo "$GH_REPO" --limit 100 \
  --json tagName,isDraft,isPrerelease,publishedAt \
  --jq '[.[] | select(.isDraft == false and .isPrerelease == false and (.tagName | startswith("ios-v")))] | sort_by(.publishedAt) | last | .tagName // empty')"
if [[ -n "$IOS_TAG" ]]; then
  gh release download "$IOS_TAG" --repo "$GH_REPO" --pattern 'SureWord.ipa' \
    --dir "$STAGING" --clobber \
    || { echo "Could not preserve SureWord.ipa from $IOS_TAG."; exit 1; }
fi

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

if [[ $PREFLIGHT -eq 1 ]]; then
  log "Preflight passed for $TAG with: ${ASSETS[*]}"
  exit 0
fi

if gh release view "$TAG" --repo "$GH_REPO" >/dev/null 2>&1; then
  log "Release $TAG already exists — replacing it."
  gh release delete "$TAG" --repo "$GH_REPO" --yes
  git -C "$REPO_ROOT" push origin ":refs/tags/$TAG" 2>/dev/null || true
fi

log "Creating $TAG with: ${ASSETS[*]}"
gh release create "$TAG" "${ASSETS[@]}" --repo "$GH_REPO" \
  --title "SureWord for Android $VERSION" \
  --notes "$NOTES"

log "Released. https://github.com/spragginsdesigns/bible-ai-explorer/releases/latest"
