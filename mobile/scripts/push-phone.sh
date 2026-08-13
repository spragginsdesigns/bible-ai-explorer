#!/usr/bin/env bash
# Build the SureWord arm64 APK and install it on Austin's Galaxy S24 Ultra
# over wireless ADB (or USB if plugged in).
#
# Usage:
#   push-phone.sh                  build + install + launch
#   push-phone.sh --skip-build     install the existing release APK
#   push-phone.sh pair <ip:port> <code>   one-time wireless debugging pairing
#   push-phone.sh connect <ip:port>       connect to a known wireless debug address
set -euo pipefail

MOBILE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
HOST_OS="$(uname -s)"
case "$HOST_OS" in
  Darwin)
    SDK_ROOT="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
    ADB="$SDK_ROOT/platform-tools/adb"
    JAVA_HOME_DEFAULT="${JAVA_HOME:-/opt/homebrew/opt/openjdk@21}"
    ;;
  MINGW*|MSYS*|CYGWIN*)
    SDK_ROOT="${ANDROID_HOME:-${LOCALAPPDATA:-C:/Users/Owner/AppData/Local}/Android/Sdk}"
    SDK_ROOT="${SDK_ROOT//\\//}"
    ADB="$SDK_ROOT/platform-tools/adb.exe"
    JAVA_HOME_DEFAULT="${JAVA_HOME:-C:/Program Files/Android/Android Studio/jbr}"
    ;;
  *)
    SDK_ROOT="${ANDROID_HOME:-$HOME/Android/Sdk}"
    ADB="$SDK_ROOT/platform-tools/adb"
    JAVA_HOME_DEFAULT="${JAVA_HOME:-/usr/lib/jvm/java-21-openjdk}"
    ;;
esac
APK="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
ADDR_FILE="$MOBILE_DIR/.phone-addr"
PACKAGE="com.spragginsdesigns.sureword"
# Regex, not a literal: adb 37+ prints the model as SM_S928U (underscore),
# older adb printed SM-S928U — match either so an SDK update can't break discovery.
PHONE_MODEL="SM[-_]S928U"

export ADB_MDNS_OPENSCREEN=1

log() { echo "[push-phone] $*"; }

run_with_timeout() {
  local seconds="$1"
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$seconds" "$@"
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$seconds" "$@"
  else
    perl -e 'alarm shift; exec @ARGV' "$seconds" "$@"
  fi
}

if [[ "${1:-}" == "pair" ]]; then
  [[ $# -eq 3 ]] || { echo "usage: push-phone.sh pair <ip:port> <code>"; exit 1; }
  "$ADB" pair "$2" "$3"
  log "Paired. Now find the Wireless debugging *connect* address (shown on the main Wireless debugging screen, different port than pairing) and run: push-phone.sh connect <ip:port>"
  exit 0
fi

if [[ "${1:-}" == "connect" ]]; then
  [[ $# -eq 2 ]] || { echo "usage: push-phone.sh connect <ip:port>"; exit 1; }
  "$ADB" connect "$2"
  echo "$2" > "$ADDR_FILE"
  log "Saved $2 for future runs."
  exit 0
fi

phone_serial() {
  "$ADB" devices -l | awk -v model="$PHONE_MODEL" '$2=="device" && $0 ~ ("model:" model) {print $1; exit}'
}

device_ready() {
  [[ -n "$(phone_serial)" ]]
}

ensure_device() {
  if device_ready; then return 0; fi

  # Try the last-known wireless debugging address.
  if [[ -f "$ADDR_FILE" ]]; then
    local addr
    addr="$(cat "$ADDR_FILE")"
    log "Trying saved wireless address $addr ..."
    "$ADB" connect "$addr" >/dev/null 2>&1 || true
    sleep 2
    if device_ready; then return 0; fi
  fi

  # Try mDNS discovery of paired wireless-debugging devices on the LAN.
  log "Scanning the network for the phone (mDNS)..."
  "$ADB" kill-server >/dev/null 2>&1 || true
  "$ADB" start-server >/dev/null 2>&1 || true
  sleep 2
  local svc
  svc="$("$ADB" mdns services 2>/dev/null | awk '/_adb-tls-connect/ {print $3; exit}')"
  if [[ -n "$svc" ]]; then
    log "Found $svc - connecting..."
    "$ADB" connect "$svc" >/dev/null 2>&1 || true
    sleep 2
    if device_ready; then
      echo "$svc" > "$ADDR_FILE"
      return 0
    fi
  fi

  # Wireless debugging rotates its port; the phone's IP is usually stable.
  # Port-scan the last-known IP for the new adb-tls port (mDNS is often
  # blocked by the Windows firewall - this is what works in practice).
  if [[ -f "$ADDR_FILE" ]]; then
    local ip
    ip="$(cut -d: -f1 "$ADDR_FILE")"
    log "Port-scanning $ip for the rotated debug port..."
    local ports
    ports="$(node -e '
      const net = require("net");
      const HOST = process.argv[1];
      const open = []; let port = 30000;
      const probe = (p) => new Promise((res) => {
        const s = net.connect({ host: HOST, port: p, timeout: 400 });
        s.on("connect", () => { open.push(p); s.destroy(); res(); });
        s.on("timeout", () => { s.destroy(); res(); });
        s.on("error", () => res());
      });
      const worker = async () => { while (port <= 49999) await probe(port++); };
      Promise.all(Array.from({ length: 400 }, worker)).then(() => console.log(open.join(" ")));
    ' "$ip")"
    local p
    for p in $ports; do
      "$ADB" disconnect >/dev/null 2>&1 || true
      "$ADB" connect "$ip:$p" >/dev/null 2>&1 || true
      sleep 2
      if device_ready; then
        echo "$ip:$p" > "$ADDR_FILE"
        log "Reconnected on rotated port $p."
        return 0
      fi
    done
  fi

  return 1
}

if [[ "${1:-}" != "--skip-build" ]]; then
  if [[ ! -d "$MOBILE_DIR/node_modules" ]]; then
    log "Installing mobile dependencies..."
    (cd "$MOBILE_DIR" && npm ci)
  fi

  # `android/` is generated and gitignored. Expo 57 clears it even for a
  # non-clean prebuild, so stamp the native inputs and regenerate only when a
  # fresh checkout or config/dependency change actually requires it.
  PREBUILD_STAMP="$MOBILE_DIR/android/.sureword-prebuild-sha"
  PREBUILD_SHA="$(sha256sum \
    "$MOBILE_DIR/app.json" \
    "$MOBILE_DIR/package.json" \
    "$MOBILE_DIR/package-lock.json" \
    | awk '{print $1}' | sha256sum | awk '{print $1}')"
  if [[ ! -x "$MOBILE_DIR/android/gradlew" \
    || ! -f "$PREBUILD_STAMP" \
    || "$(cat "$PREBUILD_STAMP")" != "$PREBUILD_SHA" ]]; then
    log "Syncing the generated Android project..."
    (cd "$MOBILE_DIR" && npx expo prebuild --platform android --no-install)
    printf '%s\n' "$PREBUILD_SHA" > "$PREBUILD_STAMP"
  else
    log "Generated Android project is current."
  fi

  log "Building arm64 release APK..."
  cd "$MOBILE_DIR/android"
  # local.properties is gitignored. sdk.dir is universal; the CMake pin is a
  # Windows-only workaround for the SDK's broken default CMake 3.22.1.
  if [[ ! -f local.properties ]]; then
    SDK_DIR="$SDK_ROOT"
    printf 'sdk.dir=%s\n' "$SDK_DIR" > local.properties
    if [[ "$HOST_OS" == MINGW* || "$HOST_OS" == MSYS* || "$HOST_OS" == CYGWIN* ]]; then
      printf 'cmake.dir=%s/cmake/3.31.6\n' "$SDK_DIR" >> local.properties
      log "Recreated local.properties (sdk.dir + CMake 3.31.6 pin)."
    else
      log "Recreated local.properties (sdk.dir)."
    fi
  fi
  grep -q '^reactNativeArchitectures=arm64-v8a$' gradle.properties || {
    perl -pi -e 's/^reactNativeArchitectures=.*/reactNativeArchitectures=arm64-v8a/' gradle.properties
    rm -rf ../node_modules/*/android/.cxx ../node_modules/@*/*/android/.cxx app/.cxx
  }
  # Expo's generated 512 MB metaspace cap is too small for the release KSP and
  # native-module graph on a clean build. Keep this deterministic across fresh
  # prebuilds rather than relying on a developer's global Gradle settings.
  if grep -q '^org.gradle.jvmargs=' gradle.properties; then
    perl -pi -e 's/^org\.gradle\.jvmargs=.*/org.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8/' gradle.properties
  else
    printf '\norg.gradle.jvmargs=-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8\n' >> gradle.properties
  fi
  NODE_ENV=production JAVA_HOME="$JAVA_HOME_DEFAULT" ./gradlew --no-daemon \
    assembleRelease -x lint -x lintVitalAnalyzeRelease --quiet
  log "Build complete."
fi

[[ -f "$APK" ]] || { echo "APK not found at $APK - build first."; exit 1; }

if ! ensure_device; then
  cat <<'EOF'
[push-phone] Couldn't reach the phone. Try these in order, on the S24 Ultra:

  1. Is the phone on the same Wi-Fi as the PC? (Wireless debugging is per-network.)

  2. Settings -> Developer options -> Wireless debugging
     Make sure the toggle is ON (Samsung turns it off after some reboots).
     Then just re-run this command - it rescans automatically.

  3. Still failing? On that same Wireless debugging screen, read the
     "IP address & port" shown under the toggle and run:
       bash mobile/scripts/push-phone.sh connect <ip:port>

  4. Says "failed to authenticate" or pairing was reset? On the same screen tap
     "Pair device with pairing code" (shows its own ip:port + 6-digit code):
       bash mobile/scripts/push-phone.sh pair <pair-ip:port> <code>
     then do step 3 with the MAIN screen's ip:port (different port than pairing).

  5. Last resort: plug in a USB cable (with USB debugging on) and re-run.
EOF
  exit 2
fi

SERIAL="$(phone_serial)"
[[ -n "$SERIAL" ]] || { echo "The connected device is not Austin's $PHONE_MODEL - refusing to install."; exit 3; }

# Streaming installs can deadlock over Samsung's encrypted wireless-ADB
# transport even while the connection remains healthy. Non-streaming first
# pushes the APK through the sync protocol (fast and observable), then asks
# Package Manager to commit it. Some Samsung builds commit successfully but do
# not return from that final command, so cap the client and verify the exact
# installed base.apk hash instead of guessing from a hung process.
EXPECTED_SHA="$(sha256sum "$APK" | awk '{print toupper($1)}')"
log "Installing on $SERIAL (non-streaming wireless-safe path) ..."
set +e
run_with_timeout 240 "$ADB" -s "$SERIAL" install --no-streaming -r "$APK"
INSTALL_STATUS=$?
set -e

INSTALLED_APK="$("$ADB" -s "$SERIAL" shell pm path "$PACKAGE" 2>/dev/null | sed -n 's/^package://p' | head -n 1 | tr -d '\r')"
INSTALLED_SHA=""
if [[ -n "$INSTALLED_APK" ]]; then
  INSTALLED_SHA="$("$ADB" -s "$SERIAL" shell sha256sum "$INSTALLED_APK" 2>/dev/null | awk '{print toupper($1)}')"
fi

if [[ "$INSTALLED_SHA" != "$EXPECTED_SHA" ]]; then
  echo "Install verification failed (adb status $INSTALL_STATUS): installed APK hash does not match the build."
  exit 4
fi
if [[ $INSTALL_STATUS -ne 0 ]]; then
  log "Installer client returned $INSTALL_STATUS after Package Manager committed; exact APK hash verified."
fi

"$ADB" -s "$SERIAL" shell am start -n "$PACKAGE/.MainActivity" >/dev/null
log "Installed and launched. To God be the glory."
