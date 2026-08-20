# SureWord on Google Play - release guide

Decided 2026-08-19: SureWord publishes under Austin's existing **personal**
Play Console account (display name "LineCrush", account ID 6346962458578497950).
Apps can be transferred to another account later if that ever changes
(Console → Settings → App transfer).

## The signing setup (do not lose this)

| Thing | Where |
|---|---|
| Upload keystore | `~/.sureword-signing/sureword-upload.jks` (alias `sureword-upload`) - **never in the repo** |
| Credentials | `~/.gradle/gradle.properties` → `SUREWORD_UPLOAD_STORE_FILE / _KEY_ALIAS / _STORE_PASSWORD / _KEY_PASSWORD` |
| App signing | Enroll in **Play App Signing** on first upload: Google holds the real app key; our keystore is only the upload key, so a lost upload key is recoverable through support |

**Back up `~/.sureword-signing/` and those four lines of
`~/.gradle/gradle.properties` somewhere off this machine** (password manager +
a copy of the .jks in private cloud storage).

## Building the AAB

```bash
bash mobile/scripts/build-aab.sh
# → mobile/android/app/build/outputs/bundle/release/app-release.aab
```

The script patches the prebuilt `android/` (which is gitignored and ships
debug-signed) to sign releases with the upload key, builds **all ABIs** (the
sideload APK is arm64-only), and refuses to finish if the AAB came out
debug-signed. Every Play upload needs a **higher `versionCode`** in
`mobile/app.json` - same bump discipline as the changelog.

Sideload releases (GitHub `SureWord.apk`, `/push-phone`) are unaffected and
keep their existing flow. Note the two keys differ, so a Play install and a
sideloaded install can't be mixed on one device without uninstalling
(Play App Signing re-signs with Google's key).

## First-release walkthrough (console clicks, in order)

1. **All apps → Create app**: name `SureWord`, default language English (US),
   App (not game), Free. Accept declarations.
2. **App content** (left nav) - work through every item:
   - Privacy policy: `https://sureword.app/privacy`
   - App access: "All functionality is available without special access" is
     FALSE - sign-in required. Choose "All or some functionality is
     restricted" and provide a **demo account** (create a dedicated Google-free
     email+code test account; reviewers need to get in).
   - Ads: **No ads**
   - Content rating questionnaire: category "Reference", no violence/sex/
     profanity/drugs/gambling, no user-to-user interaction, no location
     sharing. Expected: Everyone / PEGI 3.
   - Target audience: 18+ or 13+ (do NOT tick under-13 - avoids Families
     policy). App is general-audience.
   - News app: No. COVID app: No. Data safety: below. Government app: No.
   - Financial features: none.
3. **Data safety form** - declare:
   - Collected: **Personal info → Email address** (account management,
     required); **Name** (optional, account management); **Photos** only if
     user attaches images (App functionality, optional, user-initiated);
     **Files and docs** (optional, attachments); **App activity → In-app
     messages** (chat content, App functionality); **App info & performance**:
     none; **Device IDs**: none.
   - All data **encrypted in transit**: yes. **Deletion mechanism**: yes
     (in-app deletion of content; account deletion via email - link the
     privacy page).
   - Data **shared** with third parties: chat content is processed by AI
     service providers (OpenAI/Anthropic/Moonshot) for app functionality -
     declare under "shared for app functionality" if the form's definition of
     sharing includes processors; Google's current guidance treats service
     providers processing on your behalf as NOT "sharing", so the safe answer
     is: collected yes, shared no, with processors documented in the privacy
     policy.
4. **Store listing**:
   - App name: `SureWord` (30 char limit)
   - Short description (80 chars):
     `Bible study that stands on the Word - KJV answers, notes, and a daily walk.`
   - Full description: see below.
   - Icon: `docs/play-store/icon-512.png` · Feature graphic:
     `docs/play-store/feature-graphic-1024x500.png`
   - Screenshots: at least 2 phone screenshots (capture from the S24 Ultra:
     `adb exec-out screencap -p > shot.png` - chat with verses, Bible reader,
     Pick Up Your Cross, Notes).
   - Category: **Books & Reference**. Contact email: the account's public
     developer email.
5. **Test and release → Closed testing → Create track release**: upload the
   AAB, enroll in Play App Signing when prompted, release notes from
   `mobile/CHANGELOG.md`. Add a tester email list (12+ testers), save, roll
   out. Share the opt-in link with testers; they must **opt in AND install**.
6. The clock: **12 testers opted in continuously for 14 days**, then **Apply
   for production** (dashboard shows the countdown, same as LineCrush's).

## Store listing - full description (paste)

```
SureWord is Bible study that stands on the Word. Ask anything about the
Bible and get answers from an AI assistant that actually believes it -
every response grounded in the King James Version, quoted word for word,
never watered down.

FOUNDED ON SCRIPTURE
• Answers cite and quote the KJV exactly - tap any reference to open it
• Semantic Scripture search finds the verse you half-remember
• Cross-references trace a verse across the whole Bible
• Original languages: see the Hebrew and Greek behind any verse, word by
  word, with Strong's numbers and definitions

A COMPLETE STUDY APP
• Full offline KJV Bible reader (NKJV available) with search and quick-jump
• Tap any verse for an instant, reverent explanation
• Rich Bible study notes with folders and tags - the assistant can find,
  read, and (when you ask) reorganize them
• Attach photos, PDFs, and files to your questions

A DAILY WALK
• Pick Up Your Cross (Luke 9:23): a guided day built around one verse
  chosen for you - from what you have been reading, asking, and noting
• A morning notification that leads with Scripture itself
• The assistant remembers what matters to you across conversations -
  and you control every memory

Your study belongs to you: no ads, no selling of data, and one account
carries your conversations, notes, and daily walk across Android, web
(sureword.app), and Mac.
```

## Assets

| Asset | Path |
|---|---|
| Store icon 512×512 | `docs/play-store/icon-512.png` |
| Feature graphic 1024×500 | `docs/play-store/feature-graphic-1024x500.png` |
| Screenshots | capture on device (see step 4) |

Both generated from the day-star master (`mobile/assets/icon.png`) - regenerate
with the PIL snippets in the git history of this file if the logo changes.
