#!/usr/bin/env bash
# Build the Play Store AAB (all ABIs), signed with the SureWord upload key.
#
#   bash mobile/scripts/build-aab.sh
#
# Signing: the upload keystore lives OUTSIDE the repo and the credentials live
# in ~/.gradle/gradle.properties (SUREWORD_UPLOAD_STORE_FILE / _KEY_ALIAS /
# _STORE_PASSWORD / _KEY_PASSWORD) - created 2026-08-19, keystore at
# ~/.sureword-signing/sureword-upload.jks. Neither is ever committed.
#
# android/ is a gitignored `expo prebuild` output whose build.gradle ships
# signing release builds with the DEBUG keystore, so this script patches the
# generated build.gradle idempotently before building - the same pattern
# push-phone.sh uses for local.properties.
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_OS="$(uname -s)"
case "$HOST_OS" in
  Darwin)
    SDK_ROOT="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    JAVA_HOME_DEFAULT="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    SDK_ROOT="${ANDROID_HOME:-${LOCALAPPDATA:-C:/Users/Owner/AppData/Local}/Android/Sdk}"
    SDK_ROOT="${SDK_ROOT//\\//}"
    if [[ -x "C:/Program Files/Android/Android Studio/jbr/bin/java.exe" ]]; then
      JAVA_HOME_DEFAULT="C:/Program Files/Android/Android Studio/jbr"
    else
      JAVA_HOME_DEFAULT="${JAVA_HOME:-C:/Program Files/Android/Android Studio/jbr}"
    fi
    ;;
  *)
    SDK_ROOT="${ANDROID_HOME:-$HOME/Android/Sdk}"
    JAVA_HOME_DEFAULT="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"
    ;;
esac
AAB="$MOBILE_DIR/android/app/build/outputs/bundle/release/app-release.aab"
ARTIFACT_MANIFEST="$MOBILE_DIR/android/app/build/outputs/release-artifacts.env"

log() { echo "[build-aab] $*"; }

[[ -d "$MOBILE_DIR/android" ]] || {
  echo "No android/ prebuild. Run: cd mobile && npx expo prebuild --platform android"; exit 1;
}

cd "$MOBILE_DIR/android"

# local.properties is gitignored; recreate as push-phone.sh does.
if [[ ! -f local.properties ]]; then
  printf 'sdk.dir=%s\n' "$SDK_ROOT" > local.properties
  if [[ "$HOST_OS" == MINGW* || "$HOST_OS" == MSYS* || "$HOST_OS" == CYGWIN* ]]; then
    printf 'cmake.dir=%s/cmake/3.31.6\n' "$SDK_ROOT" >> local.properties
  fi
  log "Recreated local.properties."
fi

# The Play AAB must carry every ABI, not the phone-only arm64 pin push-phone
# sets. (push-phone re-pins to arm64-v8a on its next run.)
FULL_ABIS='armeabi-v7a,arm64-v8a,x86,x86_64'
if ! grep -q "^reactNativeArchitectures=$FULL_ABIS$" gradle.properties; then
  ABIS="$FULL_ABIS" perl -pi -e 's/^reactNativeArchitectures=.*/reactNativeArchitectures=$ENV{ABIS}/' gradle.properties
  rm -rf ../node_modules/*/android/.cxx ../node_modules/@*/*/android/.cxx app/.cxx
  log "Set reactNativeArchitectures=$FULL_ABIS (cleared .cxx caches)."
fi

# Same JVM sizing/native-access workarounds as push-phone.sh.
GRADLE_JVMARGS='-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8 --enable-native-access=ALL-UNNAMED'
if grep -q '^org.gradle.jvmargs=' gradle.properties; then
  JVMARGS="$GRADLE_JVMARGS" perl -pi -e 's/^org\.gradle\.jvmargs=.*/org.gradle.jvmargs=$ENV{JVMARGS}/' gradle.properties
else
  printf '\norg.gradle.jvmargs=%s\n' "$GRADLE_JVMARGS" >> gradle.properties
fi

# Inject the upload signing config into the generated build.gradle (idempotent).
if ! grep -q 'SUREWORD_UPLOAD_STORE_FILE' app/build.gradle; then
  perl -0pi -e 's/signingConfigs \{/signingConfigs {\n        upload {\n            if (project.hasProperty("SUREWORD_UPLOAD_STORE_FILE")) {\n                storeFile file(SUREWORD_UPLOAD_STORE_FILE)\n                storePassword SUREWORD_UPLOAD_STORE_PASSWORD\n                keyAlias SUREWORD_UPLOAD_KEY_ALIAS\n                keyPassword SUREWORD_UPLOAD_KEY_PASSWORD\n            }\n        }/' app/build.gradle
  log "Injected upload signingConfig."
fi
# Point the RELEASE build type at the upload key. The template has two
# `signingConfig signingConfigs.debug` lines; the release one directly follows
# the template's "Caution!" comment, so anchor on that.
if ! grep -q 'signingConfig signingConfigs.upload' app/build.gradle; then
  perl -0pi -e 's/(\/\/ Caution![^\n]*\n[^\n]*\n?\s*)signingConfig signingConfigs\.debug/$1signingConfig project.hasProperty("SUREWORD_UPLOAD_STORE_FILE") ? signingConfigs.upload : signingConfigs.debug/' app/build.gradle
  grep -q 'signingConfigs.upload' app/build.gradle || { echo "Failed to patch release signingConfig - check app/build.gradle"; exit 1; }
  log "Release build type now signs with the upload key."
fi

log "Building Play AAB and website APK (bundleRelease + assembleRelease, all ABIs)..."
NODE_ENV=production JAVA_HOME="$JAVA_HOME_DEFAULT" ./gradlew --no-daemon \
  bundleRelease assembleRelease -x lint -x lintVitalAnalyzeRelease --quiet

[[ -f "$AAB" ]] || { echo "AAB not found at $AAB"; exit 1; }

# Confirm it is NOT debug-signed before anyone uploads it.
CERT="$("$JAVA_HOME_DEFAULT/bin/keytool" -printcert -jarfile "$AAB" 2>/dev/null | grep -E 'Owner:|SHA256:' | head -2 || true)"
log "Signed as: $CERT"
if echo "$CERT" | grep -qi 'Android Debug'; then
  echo "ERROR: AAB is debug-signed. Check ~/.gradle/gradle.properties SUREWORD_UPLOAD_* entries."
  exit 1
fi
log "AAB ready: $AAB ($(du -h "$AAB" | cut -f1))"
APK="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
[[ -f "$APK" ]] || { echo "APK not found at $APK"; exit 1; }
log "APK ready: $APK ($(du -h "$APK" | cut -f1))"

# Bind the two artifacts to the exact version they were built from. The publish
# script verifies this manifest before touching Play, including --skip-build,
# so an old APK cannot be paired with a new AAB (or vice versa).
BUILT_CODE="$(sed -nE 's/^[[:space:]]*versionCode[[:space:]]+([0-9]+).*$/\1/p' app/build.gradle | head -n 1)"
BUILT_NAME="$(sed -nE 's/^[[:space:]]*versionName[[:space:]]+"([^"]+)".*$/\1/p' app/build.gradle | head -n 1)"
[[ -n "$BUILT_CODE" && -n "$BUILT_NAME" ]] || {
  echo "Could not read the built version from android/app/build.gradle"; exit 1;
}
mkdir -p "$(dirname "$ARTIFACT_MANIFEST")"
printf 'versionCode=%s\nversionName=%s\naabSha256=%s\napkSha256=%s\n' \
  "$BUILT_CODE" \
  "$BUILT_NAME" \
  "$(sha256sum "$AAB" | awk '{print $1}')" \
  "$(sha256sum "$APK" | awk '{print $1}')" \
  > "$ARTIFACT_MANIFEST"
log "Bound AAB and APK to $BUILT_NAME ($BUILT_CODE) in $ARTIFACT_MANIFEST."
