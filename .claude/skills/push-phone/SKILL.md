---
name: push-phone
description: Build the SureWord Android APK and install it directly onto Austin's Galaxy S24 Ultra over wireless ADB (or USB). Use when Austin says "push to my phone", "install on my phone", "/push-phone", or wants the latest mobile build on his device without waiting for a GitHub release.
---

# Push SureWord to Austin's Galaxy S24 Ultra

Build the arm64 release APK and install it straight onto the phone via ADB. The
helper script handles building, device discovery, install, and launch:

```bash
bash mobile/scripts/push-phone.sh              # build + install + launch
bash mobile/scripts/push-phone.sh --skip-build # reuse the existing release APK
```

Run it from the repo root. The build needs nothing extra — the script sets
JAVA_HOME (Android Studio JBR) itself, and `mobile/android/local.properties`
already pins `sdk.dir` + `cmake.dir` (CMake 3.31.6; the SDK default 3.22.1 is
broken on this machine — see memory).

## Device discovery order (handled by the script)

1. Any device already visible in `adb devices` (USB or connected wireless).
2. The saved wireless-debug address in `mobile/.phone-addr`.
3. mDNS scan for paired wireless-debugging phones on the LAN.

Exit code 2 means no phone was reachable.

## If no phone is reachable (exit 2)

Walk Austin through the script's printed ladder ONE step at a time — don't dump
all five steps at once. The usual fix is just step 2:

1. Phone on the same Wi-Fi as the PC? (Wireless debugging is per-network.)
2. **Settings → Developer options → Wireless debugging** — toggle it ON
   (Samsung silently turns it off after some reboots), then simply re-run the
   push; the script rescans and self-heals rotated ports by port-scanning the
   saved IP.
3. Still failing: have him read the **IP address & port** under the toggle →
   `bash mobile/scripts/push-phone.sh connect <ip:port>` → re-run the push.
4. Pairing reset ("failed to authenticate"): **Pair device with pairing code**
   on that screen → `bash mobile/scripts/push-phone.sh pair <pair-ip:port> <code>`
   → then step 3 with the MAIN screen's ip:port (pairing uses a different port).
5. Last resort: USB cable with USB debugging on, or cut a GitHub release (below).

If Developer options aren't enabled at all: Settings → About phone → Software
information → tap **Build number** 7 times.

If Austin can't do the phone-side steps right now, fall back to publishing the
APK to GitHub Releases so he can download it from the site (or sureword.app's
download link) instead:

```bash
bash mobile/scripts/release-apk.sh
```

## After a successful install

The script relaunches the app automatically. Report the APK size and what
changed in this build. Never commit `mobile/.phone-addr` (it is gitignored).
