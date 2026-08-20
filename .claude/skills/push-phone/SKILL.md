---
name: push-phone
description: Build the SureWord Android AAB and release it to the Play Store internal testing track so Austin's Galaxy S24 Ultra updates through the Play Store. Use when Austin says "push to my phone", "install on my phone", "/push-phone", or wants the latest mobile build on his device.
---

# Push SureWord to Austin's phone (via the Play Store)

Since 2026-08-19 this ships through Google Play, not wireless ADB. The helper
script bumps `versionCode` in `mobile/app.json`, builds the signed all-ABI AAB
(`build-aab.sh`), and releases it to the **internal testing** track through the
Android Publisher API:

```bash
bash mobile/scripts/push-phone.sh "what changed in this build"   # bump + build + release
bash mobile/scripts/push-phone.sh --skip-build                   # upload the existing AAB, no bump
bash mobile/scripts/push-phone.sh --track <name>                 # non-default track
```

Run it from the repo root. Notes default to the last commit subject. Internal
track releases skip review and reach opted-in testers within minutes - Austin
updates from the Play Store listing (or it auto-updates).

## Plumbing (all created 2026-08-19 - don't recreate)

- **Service account:** `sureword-play-publisher@versemind-auth.iam.gserviceaccount.com`,
  key at `~/.sureword-signing/play-publisher.json` (override with
  `SUREWORD_PLAY_KEY`). It must hold release permissions in Play Console →
  Users and permissions.
- **Upload signing:** keystore `~/.sureword-signing/sureword-upload.jks` +
  `SUREWORD_UPLOAD_*` in `~/.gradle/gradle.properties` (build-aab.sh wires it in).
- **Uploader:** `mobile/scripts/play-upload.mjs` - zero-dependency Node script
  (JWT via node:crypto, REST via fetch).

## Failure modes

- **401/403 from the API:** the service account lost (or never finished
  propagating) its Play Console grant - check Users and permissions. New grants
  can take a while to propagate.
- **"versionCode already used":** a build was uploaded without committing the
  app.json bump - re-run without `--skip-build` so it bumps again.
- **AAB debug-signed error:** `SUREWORD_UPLOAD_*` entries missing from
  `~/.gradle/gradle.properties`.
- **Prebuild/EBUSY/CMake issues:** same landmines as before - see
  `mobile/README.md` (adb/gradle daemon holding `android/`, `cmake.dir` pin).

## After a successful release

Report the versionName/versionCode released and what changed. The versionCode
bump in `mobile/app.json` must be committed with the change (the script edits
it; never ship without committing it, or the next upload collides).

Sideload fallback (Play outage, urgent debug build): `git log` has the old
ADB-based push-phone.sh (pre-2026-08-19) - or cut a GitHub release with
`bash mobile/scripts/release-apk.sh`.
