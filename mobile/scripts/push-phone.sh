#!/usr/bin/env bash
# Ship the SureWord Android build to Austin's phone THROUGH THE PLAY STORE.
#
# Since 2026-08-19 this no longer sideloads over wireless ADB. It bumps the
# versionCode, builds the signed AAB (build-aab.sh), and releases it to a Play
# testing track via the Android Publisher API (play-upload.mjs). The phone
# picks the update up from the Play Store itself - no debugging connection.
#
# Usage:
#   push-phone.sh ["release notes"]     bump + build + release to internal track
#   push-phone.sh --skip-build          upload the existing AAB as-is (no bump)
#   push-phone.sh --track closed-beta   release to a different track
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AAB="$MOBILE_DIR/android/app/build/outputs/bundle/release/app-release.aab"

log() { echo "[push-phone] $*"; }

TRACK="internal"
NOTES=""
SKIP_BUILD=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    --track) TRACK="$2"; shift 2 ;;
    *) NOTES="$1"; shift ;;
  esac
done

if [[ $SKIP_BUILD -eq 0 ]]; then
  if [[ ! -d "$MOBILE_DIR/node_modules" ]]; then
    log "Installing mobile dependencies..."
    (cd "$MOBILE_DIR" && npm ci)
  fi

  # `android/` is generated and gitignored. Expo 57 clears it even for a
  # non-clean prebuild, so stamp the native inputs and regenerate only when a
  # fresh checkout or config/dependency change actually requires it.
  prebuild_sha() {
    sha256sum \
      "$MOBILE_DIR/app.json" \
      "$MOBILE_DIR/package.json" \
      "$MOBILE_DIR/package-lock.json" \
      | awk '{print $1}' | sha256sum | awk '{print $1}'
  }
  PREBUILD_STAMP="$MOBILE_DIR/android/.sureword-prebuild-sha"
  if [[ ! -x "$MOBILE_DIR/android/gradlew" \
    || ! -f "$PREBUILD_STAMP" \
    || "$(cat "$PREBUILD_STAMP")" != "$(prebuild_sha)" ]]; then
    log "Syncing the generated Android project..."
    (cd "$MOBILE_DIR" && npx expo prebuild --platform android --no-install)
    prebuild_sha > "$PREBUILD_STAMP"
  else
    log "Generated Android project is current."
  fi

  # Every Play upload needs a strictly higher versionCode. Bump app.json (the
  # source of truth), then apply the same bump to the generated build.gradle
  # directly and refresh the prebuild stamp - a versionCode change alone must
  # not trigger a full prebuild (Expo 57 would wipe android/ -> clean rebuild).
  read -r VERSION_CODE VERSION_NAME <<<"$(node -e '
    const fs = require("fs");
    const p = process.argv[1];
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    j.expo.android.versionCode += 1;
    fs.writeFileSync(p, JSON.stringify(j, null, "\t") + "\n");
    console.log(j.expo.android.versionCode, j.expo.version);
  ' "$MOBILE_DIR/app.json")"
  prebuild_sha > "$PREBUILD_STAMP"
  CODE="$VERSION_CODE" perl -pi -e 's/^(\s*versionCode\s+)\d+/$1$ENV{CODE}/' "$MOBILE_DIR/android/app/build.gradle"
  NAME="$VERSION_NAME" perl -pi -e 's/^(\s*versionName\s+)"[^"]*"/$1"$ENV{NAME}"/' "$MOBILE_DIR/android/app/build.gradle"
  grep -q "versionCode $VERSION_CODE" "$MOBILE_DIR/android/app/build.gradle" \
    || { echo "Failed to stamp versionCode $VERSION_CODE into build.gradle"; exit 1; }
  log "Version $VERSION_NAME ($VERSION_CODE)."

  bash "$MOBILE_DIR/scripts/build-aab.sh"
fi

[[ -f "$AAB" ]] || { echo "AAB not found at $AAB - build first."; exit 1; }

[[ -n "$NOTES" ]] || NOTES="$(cd "$MOBILE_DIR" && git log -1 --pretty=%s)"
node "$MOBILE_DIR/scripts/play-upload.mjs" --aab "$AAB" --track "$TRACK" \
  --notes "$NOTES" ${VERSION_NAME:+--version-name "$VERSION_NAME"}

log "Done. The Play Store delivers it to the phone in a few minutes (Play Store -> SureWord -> Update). To God be the glory."
