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
ADB="${LOCALAPPDATA:-C:/Users/Owner/AppData/Local}/Android/Sdk/platform-tools/adb.exe"
JAVA_HOME_DEFAULT="C:/Program Files/Android/Android Studio/jbr"
APK="$MOBILE_DIR/android/app/build/outputs/apk/release/app-release.apk"
ADDR_FILE="$MOBILE_DIR/.phone-addr"
PACKAGE="com.spragginsdesigns.sureword"

export ADB_MDNS_OPENSCREEN=1

log() { echo "[push-phone] $*"; }

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

device_ready() {
  "$ADB" devices | awk 'NR>1 && $2=="device" {found=1} END {exit !found}'
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
  log "Building arm64 release APK..."
  cd "$MOBILE_DIR/android"
  # local.properties is gitignored and `expo prebuild --clean` deletes it along
  # with the rest of android/, so a prebuild is otherwise always followed by a
  # failing build. Both lines matter, with forward slashes: without sdk.dir the
  # build dies with "SDK location not found", and without cmake.dir it picks the
  # SDK default CMake 3.22.1, which loops forever on
  # "ninja: manifest 'build.ninja' still dirty" building reanimated.
  if [[ ! -f local.properties ]]; then
    SDK_DIR="${ANDROID_HOME:-${LOCALAPPDATA:-C:/Users/Owner/AppData/Local}/Android/Sdk}"
    SDK_DIR="${SDK_DIR//\\//}"
    {
      printf 'sdk.dir=%s\n' "$SDK_DIR"
      printf 'cmake.dir=%s/cmake/3.31.6\n' "$SDK_DIR"
    } > local.properties
    log "Recreated local.properties (sdk.dir + cmake.dir 3.31.6)."
  fi
  grep -q '^reactNativeArchitectures=arm64-v8a$' gradle.properties || {
    sed -i 's/^reactNativeArchitectures=.*/reactNativeArchitectures=arm64-v8a/' gradle.properties
    rm -rf ../node_modules/*/android/.cxx ../node_modules/@*/*/android/.cxx app/.cxx
  }
  JAVA_HOME="$JAVA_HOME_DEFAULT" ./gradlew assembleRelease -x lint --quiet
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

log "Installing on $("$ADB" devices | awk 'NR==2 {print $1}') ..."
"$ADB" install -r "$APK"
"$ADB" shell am start -n "$PACKAGE/.MainActivity" >/dev/null
log "Installed and launched. To God be the glory."
