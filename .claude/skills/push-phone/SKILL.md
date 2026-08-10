---
name: push-phone
description: Build the VerseMind Android APK and install it directly onto Austin's Galaxy S24 Ultra over wireless ADB (or USB). Use when Austin says "push to my phone", "install on my phone", "/push-phone", or wants the latest mobile build on his device without Google Drive.
---

# Push VerseMind to Austin's Galaxy S24 Ultra

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

## If no phone is reachable

Wireless debugging ports rotate when the phone toggles the feature, so a stale
saved address is normal. Ask Austin to open **Settings → Developer options →
Wireless debugging** on the phone (must be on the same Wi-Fi as the PC) and:

- **Already paired before:** read the IP:port shown on that screen, then
  `bash mobile/scripts/push-phone.sh connect <ip:port>` and re-run the push.
- **First-time pairing:** tap **Pair device with pairing code**, then
  `bash mobile/scripts/push-phone.sh pair <pair-ip:port> <6-digit-code>`
  (the pairing screen's port differs from the connect port), then the
  `connect` step above with the main screen's IP:port.
- **Developer options not enabled yet:** Settings → About phone → Software
  information → tap **Build number** 7 times, then find Developer options in
  Settings and enable **Wireless debugging**.

If Austin can't do the phone-side steps right now, fall back to updating the
Google Drive APK in place (same link he already has):

```bash
gws drive files update --params '{"fileId":"1BvfwTE7Na5pAIbwY8VG6Yvkp6vxJpqKu"}' \
  --json '{"name":"VerseMind-<version>.apk"}' \
  --upload mobile/android/app/build/outputs/apk/release/app-release.apk \
  --upload-content-type application/vnd.android.package-archive
```

## After a successful install

The script relaunches the app automatically. Report the APK size and what
changed in this build. Never commit `mobile/.phone-addr` (it is gitignored).
