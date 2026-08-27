#!/usr/bin/env bash
# Ship the SureWord Android build to Austin's phone THROUGH THE PLAY STORE.
#
# Since 2026-08-19 this no longer sideloads over wireless ADB. It bumps the
# versionCode, builds the signed AAB (build-aab.sh), and releases it to a Play
# testing track via the Android Publisher API (play-upload.mjs). The phone
# picks the update up from the Play Store itself - no debugging connection.
#
# Play "What's new" notes come EXCLUSIVELY from mobile/CHANGELOG.md (see the
# mandatory rules at its top). No changelog entry for the versionCode being
# published -> this script refuses to build or upload anything.
#
# Usage:
#   push-phone.sh                       bump + build + release to Play + GitHub
#   push-phone.sh --skip-build          upload the existing AAB as-is (no bump)
#   push-phone.sh --track closed-beta   release to a different track
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
AAB="$MOBILE_DIR/android/app/build/outputs/bundle/release/app-release.aab"
APK="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
ARTIFACT_MANIFEST="$MOBILE_DIR/android/app/build/outputs/release-artifacts.env"

log() { echo "[push-phone] $*"; }

TRACK="internal"
SKIP_BUILD=0
while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=1; shift ;;
    --track) TRACK="$2"; shift 2 ;;
    *)
      echo "[push-phone] Ad-hoc release notes are no longer accepted." >&2
      echo "[push-phone] Play notes come from mobile/CHANGELOG.md - write the entry for the" >&2
      echo "[push-phone] versionCode being published (rules at the top of that file), then re-run." >&2
      exit 1
      ;;
  esac
done

# ── Mandatory Play changelog gate ───────────────────────────────────────────
# The entry must exist BEFORE anything is built or uploaded: no entry, no
# publish. play-notes.mjs validates it and emits the exact Play text.
read -r CUR_CODE APP_VERSION <<<"$(node -e '
  const j = require(process.argv[1]);
  console.log(j.expo.android.versionCode, j.expo.version);
' "$MOBILE_DIR/app.json")"
TARGET_CODE=$CUR_CODE
[[ $SKIP_BUILD -eq 0 ]] && TARGET_CODE=$((CUR_CODE + 1))
if ! NOTES="$(node "$MOBILE_DIR/scripts/play-notes.mjs" "$MOBILE_DIR/CHANGELOG.md" "$TARGET_CODE" "$APP_VERSION")"; then
  cat >&2 <<EOF
[push-phone] BLOCKED: mobile/CHANGELOG.md needs an entry for the build about to
be published (versionCode $TARGET_CODE) before anything is built or uploaded.
Add at the top of the changelog:

  ## $APP_VERSION (versionCode $TARGET_CODE) - $(date +%F) - $TRACK

  **What's new (Play):**

  - <user-facing lines, under 500 characters total>

  **Dev notes:** <optional engineering detail>

If a previous run built but failed to upload, the top entry may name an older
versionCode - update its heading to versionCode $TARGET_CODE.
EOF
  exit 1
fi
log "Play notes for versionCode $TARGET_CODE from CHANGELOG.md ($(printf %s "$NOTES" | wc -c | tr -d ' ') chars)."

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
  [[ "$VERSION_CODE" == "$TARGET_CODE" ]] \
    || { echo "Changelog gate validated versionCode $TARGET_CODE but the bump produced $VERSION_CODE"; exit 1; }
  log "Version $VERSION_NAME ($VERSION_CODE)."

  bash "$MOBILE_DIR/scripts/build-aab.sh"
fi

[[ -f "$AAB" ]] || { echo "AAB not found at $AAB - build first."; exit 1; }
[[ -f "$APK" ]] || {
  echo "APK not found at $APK - build both release artifacts before publishing." >&2
  echo "Play was not updated, so the Play build and website download cannot drift." >&2
  exit 1
}
[[ -f "$ARTIFACT_MANIFEST" ]] || {
  echo "Release artifact manifest not found at $ARTIFACT_MANIFEST." >&2
  echo "Rebuild both artifacts before publishing; Play was not updated." >&2
  exit 1
}
manifest_value() {
  awk -F= -v key="$1" '$1 == key { sub(/^[^=]*=/, ""); print; exit }' "$ARTIFACT_MANIFEST"
}
BUILT_CODE="$(manifest_value versionCode)"
BUILT_NAME="$(manifest_value versionName)"
EXPECTED_AAB_SHA="$(manifest_value aabSha256)"
EXPECTED_APK_SHA="$(manifest_value apkSha256)"
ACTUAL_AAB_SHA="$(sha256sum "$AAB" | awk '{print $1}')"
ACTUAL_APK_SHA="$(sha256sum "$APK" | awk '{print $1}')"
[[ "$BUILT_CODE" == "$TARGET_CODE" && "$BUILT_NAME" == "$APP_VERSION" ]] || {
  echo "Release artifacts are $BUILT_NAME ($BUILT_CODE), expected $APP_VERSION ($TARGET_CODE)." >&2
  echo "Rebuild both artifacts before publishing; Play was not updated." >&2
  exit 1
}
[[ "$EXPECTED_AAB_SHA" == "$ACTUAL_AAB_SHA" && "$EXPECTED_APK_SHA" == "$ACTUAL_APK_SHA" ]] || {
  echo "AAB/APK hashes do not match the release artifact manifest." >&2
  echo "Rebuild both artifacts before publishing; Play was not updated." >&2
  exit 1
}
command -v gh >/dev/null 2>&1 || {
  echo "gh CLI is required before Play can be updated." >&2
  exit 1
}
gh auth status >/dev/null 2>&1 || {
  echo "gh is not authenticated. Fix GitHub auth before publishing Play." >&2
  exit 1
}
bash "$MOBILE_DIR/scripts/release-apk.sh" --preflight --notes "$NOTES"

node "$MOBILE_DIR/scripts/play-upload.mjs" --aab "$AAB" --track "$TRACK" \
  --notes "$NOTES" --version-name "$APP_VERSION"

log "Play upload succeeded. Publishing the matching APK to GitHub Releases..."
if ! bash "$MOBILE_DIR/scripts/release-apk.sh" --notes "$NOTES"; then
  echo "[push-phone] ERROR: Play upload succeeded, but the GitHub APK publish failed." >&2
  echo "[push-phone] The Play track is updated; rerun release-apk.sh after fixing the GitHub failure." >&2
  exit 1
fi

log "Done. Play delivers it to the phone in a few minutes, and GitHub now serves the matching APK to website download links. To God be the glory."
