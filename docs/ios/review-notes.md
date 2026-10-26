# App Review notes (PRD H6)

Status: **entered in App Store Connect 2026-10-08** (Notes field); DEMO
ACCOUNT, IN-APP PURCHASE, CHINA MAINLAND and item 5 rewritten for the
1.21.0 resubmission on 2026-10-20 after the 2026-10-21 rejection (submission
6f4d1a78). OWN AI KEY section and the "user's own provider" consent clause
removed on 2026-10-25 (personal API keys are gone), in this file and in the
live ASC Notes; the version is now 1.26.0 on build 1.26.0 (2). Resubmitting
still waits on the physical-device sandbox purchase recording. Apple rejected again on 2026-10-22 (submission be22f349, 2.1(b)):
the SureWord Pro IAP "could not be found in the submitted binary", and Apple
asks for a new binary plus a screen recording on a physical device that starts
at the Home Screen, signs in with the demo account and shows a successful
sandbox purchase. On 2026-10-22 the rejected version was renamed 1.24.0 and
pointed at build 1.24.0 (1), and the DEMO line now reads "tap Sign in" for
the new welcome card; resubmitting waits on that recording. The live ASC text is trimmed to stay under 4,000 characters. Was a template; Paste the block below into App Store Connect → App
Review Information → Notes, after walking every path in it on the submission
build as the demo account. Navigation labels follow the iOS source on
2026-10-07; the Settings hub is being rebuilt (PRD B5), so re-check each path
against the final build and fix the wording here first.

## Sign-in information (App Store Connect fields, not the notes)

- **Sign-in required:** Yes.
- **User name / Password:** the dedicated review account. Credentials are
  entered directly in App Store Connect and stored in Austin's 1Password. They
  are **never** written in this repo, in a commit, or in these notes.
- The account is a Clerk password account (PRD A3 makes password sign-in work
  on iOS). Device Trust is off, so it signs in from a new device without an
  email code.
- The account (applereviewer@icloud.com, Clerk `user_3KOBQzqtHTJT6xHN4xksvJBWBoK`)
  is a **free** account. It had Pro through `PRO_USER_IDS` (decision (d) in
  `docs/ios/PROGRESS.md`); `PRO_USER_IDS` was emptied on 2026-10-21, because
  a Pro account sees "Pro is active on your account" and no Subscribe button.
  That was not what got 1.21.0 rejected under 2.1(b), though: the demo
  account never signed in to production. App Review used Sign in with Apple
  ("John Apple", a privaterelay.appleid.com address, free plan, created
  during the review), so it reached the Subscribe screen, but the
  subscription was "Developer Rejected" and not part of the submission, so
  StoreKit had no product to load. A first subscription must be submitted
  together with its group and the app version. Keep this account out of
  `PRO_USER_IDS` and `SERVER_CREDENTIAL_USER_IDS` for every review. It is a
  different account from the Google Play reviewer.
- SureWord is not offered in China mainland (removed in Pricing and
  Availability 2026-10-20) because of guideline 5 (OpenAI) and the China
  Internet Publishing License required for book content.
- Contact: Austin Spraggins, spragginsdesigns@gmail.com, phone: TODO (Austin
  fills in App Store Connect).

## Notes (paste)

```
Thank you for reviewing SureWord.

WHAT IT IS
A Bible study app for Christians, made by LineCrush Inc. The Bible text is the King James Version (public domain), built in and readable offline. An AI assistant answers Bible questions by first searching the Scripture text, then quoting and citing it.

DEMO ACCOUNT
Use the Sign-in Information above: on the welcome screen tap Sign in, enter the email, tap Continue, then enter the password. The demo account is now a normal free account (it no longer has Pro granted), so the SureWord Pro purchase screen shows the Subscribe button.

IN-APP PURCHASE
SureWord Pro (com.spragginsdesigns.sureword.pro.monthly), an optional monthly auto-renewing subscription sold with StoreKit 2, is submitted with this version. Find it at Settings (gear) > AI > SureWord Pro: price, Subscribe, Restore Purchases, terms, Privacy Policy and EULA. Use a Sandbox Apple Account to buy. Pro unlocks Listen (spoken devotional) and more daily AI messages.

CHINA MAINLAND
The app is no longer offered in China mainland (removed in Pricing and Availability), so the guideline 5 and publication permit items no longer apply.

AI CONSENT
Before the first AI request, a one-time sheet names the providers that receive requests (OpenAI; Tavily for web search; ElevenLabs for spoken devotionals) and links to the privacy policy. Nothing is sent until the user taps Agree and continue.

MAIN FEATURES
1. Chat tab: ask e.g. "What does John 3:16 mean?". Verse references open the reader.
2. In the composer, "/check Jesus never claimed to be God" weighs a claim against Scripture; "/reply" drafts a gentle reply.
3. The + button left of the text field attaches photos, documents or an audio file (e.g. a Voice Memos recording saved to Files); audio is transcribed with OpenAI and the chip shows the transcript.
4. Bible tab: choose a book and chapter; tap a verse for an explanation, word study, highlights, copy, share and save to note.
5. Pick Up Your Cross (a daily verse chosen for the user): the first card on the Today tab (the first tab); tap Read today's word. Its Listen card (Pro) plays the devotional aloud with lock-screen controls; on a free account it opens the SureWord Pro screen.
6. Settings > My church: search e.g. "First Baptist Church Dallas". Details come from Google Places; no location permission is requested.
7. Study tab (the last tab) > Notes: create a note; the AI button helps compose it.
8. SureWord Pro: on the Today tab, tap the gear at the top > AI > SureWord Pro. The row is always shown, even before the membership details load.


REPORTING AND MODERATION
The thumbs-down under every answer reports it with a reason (Not KJV, Doctrinally off, Missed my question, Wrong or missing verse, Too long). Settings > Send feedback messages the developer. Every report and message is read and marked reviewed by the developer in a private review queue.

ACCOUNT DELETION
Settings > tap your name at the top > Delete account, then confirm. This permanently deletes the account and its data and signs out. Please do not delete the demo account.

NOTIFICATIONS
Optional. Permission is requested only when the user turns on a reminder, never at launch.

CONTENT
All Scripture is KJV (NKJV and BSB optional). Answers are written from a Christian perspective that holds the Bible as the Word of God. No user-to-user messaging and no ads.

Privacy: https://sureword.app/privacy
Support: https://sureword.app/support
Contact: spragginsdesigns@gmail.com
```

## Before pasting, confirm each claim on the submission build

| Claim in the notes | PRD row that must be `verified` in `docs/ios/PROGRESS.md` |
|---|---|
| Password sign-in for the demo account | A3, B1 |
| AI consent sheet | A4 (client UI not built; see `docs/ios/ai-consent.md`) |
| No purchase UI, locked panel without a link | F1 (and the (f) StoreKit decision) |
| /check, /reply | D6 |
| Voice messages, transcript chip | D7 |
| Listen in the background with lock-screen controls | D4 (device gate) |
| My church | B5 (exact Settings path) |
| Thumbs-down reasons | D3 |
| Send feedback | B4 |
| Delete account | A1 client |
| Notification permission timing | B6, B6a |
| "+ button" to attach | `ChatInputBar.swift` draws `plus` (accessibility label "Attach photos or files"); re-check after the design pass (G2) |

If a row is not verified, remove or reword its line rather than submitting a
claim App Review cannot reproduce. If guideline 3.1.3(b) leads to StoreKit in
v1.0 (decision (f)), rewrite "NO PURCHASES IN THE APP" to describe the
in-app subscription and how to test it in the sandbox.

Example inputs (the church name, the /check claim) must be tried on the
submission build first; replace any that do not produce a good result.
