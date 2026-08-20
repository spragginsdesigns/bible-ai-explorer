---
name: push-phone
description: Build the SureWord Android AAB and release it to the Play Store internal testing track so Austin's Galaxy S24 Ultra updates through the Play Store. Use when Austin says "push to my phone", "install on my phone", "/push-phone", or wants the latest mobile build on his device.
---

# Push SureWord to Austin's phone (via the Play Store)

Since 2026-08-19 this ships through Google Play, not wireless ADB. The helper
script bumps `versionCode` in `mobile/app.json`, builds the signed all-ABI AAB
(`build-aab.sh`), and releases it to the **internal testing** track through the
Android Publisher API.

## MANDATORY: the changelog entry comes first (since 2026-08-20)

`mobile/CHANGELOG.md` is the single source of truth for Play "What's new"
notes - the script reads the release text from it (`scripts/play-notes.mjs`)
and **refuses to build or upload without an entry for the versionCode being
published**. Ad-hoc notes arguments are rejected. So the workflow is:

1. Read `mobile/app.json` → the next build publishes `versionCode + 1`
   (`--skip-build` publishes the current code).
2. Write the entry at the top of `mobile/CHANGELOG.md`, following the rules at
   the top of that file:

   ```markdown
   ## <versionName> (versionCode <n>) - <YYYY-MM-DD> - internal

   **What's new (Play):**

   NEW
   - <user-facing lines - feature names as the app shows them, under 500 chars total>

   **Dev notes:** <optional engineering detail>
   ```

3. Then run the script:

```bash
bash mobile/scripts/push-phone.sh                # bump + build + release (internal)
bash mobile/scripts/push-phone.sh --skip-build   # upload the existing AAB, no bump
bash mobile/scripts/push-phone.sh --track <name> # non-default track
```

Run it from the repo root. Internal track releases skip review and reach
opted-in testers within minutes - Austin updates from the Play Store listing
(or it auto-updates). Commit the CHANGELOG entry together with the `app.json`
versionCode bump.

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
  app.json bump - re-run without `--skip-build` so it bumps again (and update
  the CHANGELOG entry's heading to the new versionCode).
- **"BLOCKED: mobile/CHANGELOG.md needs an entry":** the mandatory Play
  changelog gate - write the entry (step 2 above), don't bypass it.
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
