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

Run from the repository root in Git Bash. When native configuration or
dependencies changed, prebuild first with
`(cd mobile && npx expo prebuild --platform android)`; WSL is not supported for
this Windows Android environment.

```bash
bash mobile/scripts/build-aab.sh
# → mobile/android/app/build/outputs/bundle/release/app-release.aab
# → mobile/android/app/build/outputs/apk/release/app-release.apk
```

The script patches the prebuilt `android/` (which is gitignored and ships
debug-signed) to sign releases with the upload key, builds the all-ABI Play AAB
and matching website APK from the same source revision, and refuses to finish
if the AAB came out debug-signed. Every Play upload needs a **higher `versionCode`** in
`mobile/app.json` - same bump discipline as the changelog.

The release command publishes `SureWord.apk` to GitHub immediately after Play
accepts the AAB. Note the two keys differ, so a Play install and a
sideloaded install can't be mixed on one device without uninstalling
(Play App Signing re-signs with Google's key).

## Automated releases (`/push-phone`, since 2026-08-19)

`/push-phone` no longer sideloads over ADB - it publishes to the **internal
testing** track through the Android Publisher API, and Austin's phone updates
from the Play Store. Internal releases normally become available to testers in
minutes and skip review, but live Play state must be confirmed in Play Console:

```bash
bash mobile/scripts/push-phone.sh   # bump + build AAB/APK + publish Play and GitHub
```

Play notes come only from the matching entry in `mobile/CHANGELOG.md`; ad-hoc
note arguments are rejected. The script checks both artifacts before any
upload, publishes Play first, then creates the matching `android-v<version>`
GitHub release. The website's public `/api/native-releases` endpoint discovers
that APK automatically, so no site version constant is updated by hand.

| Thing | Where |
|---|---|
| Service account | `sureword-play-publisher@versemind-auth.iam.gserviceaccount.com` (Play Console → Users and permissions: Release apps to testing tracks + Manage testing tracks, app-level on SureWord) |
| API key | `~/.sureword-signing/play-publisher.json` (env override `SUREWORD_PLAY_KEY`) - back it up with the keystore |
| Uploader | `mobile/scripts/play-upload.mjs` (no npm deps; `--track` defaults to `internal`) |
| App id in console | `4976411638093672168` |
| Internal testers | Email list "SureWord Internal" (both of Austin's gmails) |
| Tester opt-in link | https://play.google.com/apps/internaltest/4701353603485430223 (open once per tester account, tap Join, then install from the Play Store) |

## Current source status (2026-08-31)

The checked-in Android source and current internal release are `1.43.1` /
versionCode `42` (`mobile/app.json`, tag `android-v1.43.1`). The release restores
the Bible chapter reader's original Scripture renderer and spacing while keeping
the cross-app Atkinson Hyperlegible typography system and Hack for code
elsewhere. It is built and published from one bound AAB/APK pair through
`push-phone.sh --skip-build`; the matching
`SureWord.apk` SHA-256 is
`1c827cdb37d5bba5cb858a0fb76886a6efdd2f01a6c695b6ef13279608b3fa51`.

The normal release path is `bash mobile/scripts/push-phone.sh` from Git Bash at
the repository root. It builds the upload-signed AAB and matching APK, publishes
the AAB to the internal track, then publishes `SureWord.apk` to GitHub Releases.

## Historical console setup snapshot (2026-08-20)

Done: app created (`com.spragginsdesigns.sureword`, app id 4976411638093672168),
versionCode 13 live on the internal track and installed on Austin's phone via
the tester link, store listing draft (name/descriptions/icon/feature graphic),
Store settings (Books & Reference; contact spragginsdesigns@gmail.com +
https://sureword.app), privacy policy URL, and declarations: Ads (none),
Advertising ID (none), Government (no), Financial (none), Health (none),
Content rating (IARC submitted → ESRB Everyone), Data safety (filled, saved as
draft - final submit is gated on Target audience).

At that time, the remaining items were (Austin, in order): **App access** (needs a demo account; entering
credentials is his) → **Target audience** (18+, decided 2026-08-20) → reopen
Data safety and hit Save → **2+ phone screenshots** on the store listing →
"Send for review" in Publishing overview. This historical checklist does not
establish their current state. None of this blocks internal-track pushes.

## First-release / production closed-testing walkthrough (historical)

The steps below describe the original production-onboarding flow, not the
normal internal-track release command above. Re-check the current Play Console
requirements before using them.

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
    - Current provider notes: OpenAI/Anthropic/Moonshot/OpenRouter process AI requests;
      ElevenLabs processes Listen narration requests; Google Places powers the
      optional My church search/profile lookup. Re-check the current privacy
      policy and Play form definitions before declaring these as "shared" or
      processor-only; document each provider and the data it receives.
4. **Store listing**:

   > **PENDING (2026-10-09): Play's live listing is behind this file.** The
   > new App name and the full description below are saved as a **draft** on
   > the Play Console default store listing but are not live (the API showed
   > the old "SureWord" title afterwards). The Publishing overview offered no
   > "send for review" while SureWord has no production or closed-testing
   > release, so send the draft whenever the console offers it, at the latest
   > with the first closed-testing/production release. The publisher service
   > account can patch listings but gets 403 on the commit; granting it Store
   > presence in Users and permissions would let an agent publish it by API.
   > Also open: the live short description is "Bible study that stands on the
   > Word - KJV answers, notes, and a daily walk.", not the one below; Austin
   > picks which survives. Delete this block once the live listing matches.
   > TickTick task 6ac950948f089f376a25a421.

   - App name: `SureWord: Personal Bible Guide` (30 of 30 chars; chosen
     2026-10-09, was `SureWord`). Same name as the App Store listing in
     `docs/ios/app-store-listing.md`. The launcher label on the device stays
     `SureWord`; this is the store title only, edited in Play Console → Grow
     users → Store presence → Main store listing, no new build needed.
   - Short description (80 chars):
     `Come hungry for the Word: your personal Bible study companion.`
    - Full description: see below. Refresh it when a user-visible feature lands;
      rewritten 2026-10-09 (3808 of 4000 chars) to cover the whole app under
      the new name, in the same sections as the App Store description in
      `docs/ios/app-store-listing.md`. It names iPhone/iPad only once the iOS
      app is live.
   - Icon: `docs/play-store/icon-512.png` · Feature graphic:
     `docs/play-store/feature-graphic-1024x500.png`
   - Screenshots: at least 2 phone screenshots (capture from the S26 Ultra:
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
Come hungry for the Word.

SureWord is your personal Bible guide, rooted in the King James Bible and made for Christians who hold it as the inerrant, infallible Word of God. Read it, hear it, ask about it and live it, with a guide that learns where you are in your walk with the Lord and meets you there. Every answer searches the Scriptures first and cites the verses in context.

"As newborn babes, desire the sincere milk of the word, that ye may grow thereby." 1 Peter 2:2

PICK UP YOUR CROSS, EVERY MORNING
• One verse chosen for you each day from your own reading, questions and notes, with why it was chosen and how to live it today (Luke 9:23)
• Stay with today's word, or ask for a fresh one
• A morning notification that leads with Scripture itself

ASK, AND SEE WHAT IS WRITTEN
• Ask anything about the Bible and get an answer that quotes the King James text word for word, every reference one tap from the reader
• Find the verse you half remember, by meaning or by exact words
• Cross-references that trace a verse through the whole Bible
• The Hebrew and Greek behind any verse, word by word, with Strong's numbers
• Copy, edit and try again on your questions; share, save or rate any answer
• SureWord AI works the moment you sign in, or bring your own OpenAI, Anthropic, Moonshot or OpenRouter key
• Lock your phone mid-answer and SureWord tells you when it is ready

TRY EVERY WORD BY THE WORD
• /check weighs a claim, a message or a screenshot against Scripture
• /reply helps you answer a friend in your own voice, with grace
• /verify tests what a YouTube video or a web page teaches, claim by claim, with the passages that settle it
• Ask with a photo, PDF, text file or voice message, or share one into SureWord from any app

READ AND HEAR THE BIBLE
• The complete King James Bible built in and readable offline, with the NKJV and the Berean Standard Bible also available
• Audio Bible: the whole KJV narrated, Genesis to Revelation, following along verse by verse
• Words of Christ in red on a parchment page, light or dark
• Tap a verse for a reverent explanation, word study and related passages
• Highlight verses in eight colors and name what each color means
• Pick up right where you left off

GROW IN YOUR WALK
• Your walk: a reflection on your reading, a map of every book, your streak and your history day by day
• Reading plans, guided or built around your own goal
• Learn a verse: practice it word by word until it is written on your heart
• Timeline, People and Places: walk Bible history and see who and where each chapter is about
• Sermon studies: your church's sermons as guided studies for the week, where available

A GUIDE THAT KNOWS YOU
• About me and My testimony: tell SureWord where you are in your walk, privately, so answers meet you there
• My church: save your congregation, and SureWord keeps it in mind
• Prayer requests that come back to you, so you can mark how God answered
• Memory you control: see, add, delete or turn off everything SureWord keeps

YOUR STUDY, KEPT TOGETHER
• Bible study notes with folders, tags, pins, templates, linked notes and Markdown export
• SureWord can find, read, add to and tidy your notes when you ask

SUREWORD PRO
An optional monthly subscription adds Listen (the daily devotional read aloud, with Read along and lock-screen controls), more AI messages each day, deeper reasoning from SureWord AI, and unlimited voice message transcription.

PRIVATE BY DESIGN
• No ads, and your study is never sold
• Delete your account and everything in it from Settings at any time

SureWord is a study aid, not a replacement for your Bible or your local church. Its AI can make mistakes, so search the Scriptures daily to see whether these things are so (Acts 17:11).

Also on the web at sureword.app and on Mac, all kept in step.
```

## Assets

| Asset | Path |
|---|---|
| Store icon 512×512 | `docs/play-store/icon-512.png` |
| Feature graphic 1024×500 | `docs/play-store/feature-graphic-1024x500.png` |
| Screenshots | capture on device (see step 4) |

Both generated from the day-star master (`mobile/assets/icon.png`) - regenerate
with the PIL snippets in the git history of this file if the logo changes.
