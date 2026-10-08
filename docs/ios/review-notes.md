# App Review notes (PRD H6)

Status: **entered in App Store Connect 2026-10-08** (Notes field). Was a template; Paste the block below into App Store Connect → App
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
- The account has SureWord Pro through the server allowlist `PRO_USER_IDS`
  (decision (d) in `docs/ios/PROGRESS.md`), so every feature, including
  Listen, is unlocked without a purchase.
- Contact: Austin Spraggins, spragginsdesigns@gmail.com, phone: TODO (Austin
  fills in App Store Connect).

## Notes (paste)

```
Thank you for reviewing SureWord.

WHAT IT IS
A Bible study app for Christians, made by LineCrush Inc. The Bible text is the King James Version (public domain), built in and readable offline. An AI assistant answers Bible questions by first searching the Scripture text, then quoting and citing it.

DEMO ACCOUNT
Use the Sign-in Information above: enter the email, tap Continue, then enter the password. The account has every feature unlocked, including Pro.

IN-APP PURCHASE
SureWord Pro is an optional monthly auto-renewing subscription (com.spragginsdesigns.sureword.pro.monthly), bought through StoreKit at Settings (gear, top right) > AI > SureWord Pro, with Restore Purchases on the same screen. It adds the spoken devotional (Listen) and unlimited voice-message transcription. The demo account already has Pro granted on our server; to test the purchase itself, use a Sandbox Apple Account on that screen. Free accounts get a daily allowance of AI answers.

AI CONSENT
Before the first AI request, a one-time sheet names the providers that receive requests (OpenAI or the user's own provider; Tavily for web search; ElevenLabs for spoken devotionals) and links to the privacy policy. Nothing is sent until the user taps Agree and continue.

MAIN FEATURES
1. Chat tab: ask e.g. "What does John 3:16 mean?". Verse references open the reader.
2. In the composer, "/check Jesus never claimed to be God" weighs a claim against Scripture; "/reply" drafts a gentle reply.
3. The + button left of the text field attaches photos, documents or an audio file (e.g. a Voice Memos recording saved to Files); audio is transcribed with OpenAI and the chip shows the transcript.
4. Bible tab: choose a book and chapter; tap a verse for an explanation, word study, highlights, copy, share and save to note.
5. Pick Up Your Cross (a daily verse chosen for the user): the card at the top of the Bible tab. Its Listen card plays the devotional aloud (ElevenLabs), in the background with lock-screen controls.
6. Settings > My church: search e.g. "First Baptist Church Dallas". Details come from Google Places; no location permission is requested.
7. Notes tab: create a note; the AI button helps compose it.

OWN AI KEY (OPTIONAL)
Settings > AI accepts the user's own OpenAI, Anthropic, Moonshot or OpenRouter key, billed by that provider. Keys are validated, encrypted at rest and never shown again. Not needed for review.

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
