# App Review notes (PRD H6)

Status: **template.** Paste the block below into App Store Connect → App
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
SureWord is a Bible study app for Christians. The Bible text is the King James Version (public domain), built into the app and readable offline. An AI assistant answers Bible questions by first searching the Scripture text and then quoting and citing it. SureWord is made by LineCrush Inc.

DEMO ACCOUNT
Sign in with the user name and password provided in the Sign-in Information fields: on the sign-in screen, enter the email, tap Continue, then enter the password. This account has full access to every feature; nothing in the app requires a purchase.

NO PURCHASES IN THE APP
The iOS app contains no in-app purchases, prices or links to buy anything. Free accounts get a daily allowance of AI answers. A few features (for example Listen, below) are unlocked for some accounts on our server; on iOS, a free account sees a locked panel with no purchase button or external link.

AI CONSENT AND DISCLOSURE
Before the first AI request, the app shows a one-time sheet that names the AI providers that receive the request (OpenAI, or the user's own provider; Tavily for web search; ElevenLabs for spoken devotionals) and links to the privacy policy. Nothing is sent until the user taps Agree and continue.

HOW TO REACH THE MAIN FEATURES
1. AI chat: the Chat tab. Type a question such as "What does John 3:16 mean?" and tap Send. Verse references in the answer open the Bible reader.
2. /check and /reply: in the Chat composer, type "/check" followed by a claim, for example "/check Jesus never claimed to be God". SureWord weighs it against Scripture. Then type "/reply" to draft a short, gentle reply.
3. Voice messages: in the Chat composer, tap the + button to the left of the text field, choose Choose File, and pick an audio file (M4A, MP3, WAV, OGG or WebM, up to 15 minutes), for example a recording made in Voice Memos and saved to Files. SureWord transcribes it once with OpenAI; tap the voice message chip to read the transcript, then ask about it or use /check.
4. Photos and documents: the same + button offers Photo Library, Take Photo, Choose File and Paste Image.
5. Bible: the Bible tab. Choose a book and chapter. Tap any verse for an explanation, word study, highlight colours, copy, share and save to note.
6. Pick Up Your Cross (a daily verse chosen for the user): the card at the top of the Bible tab.
7. Listen: inside Pick Up Your Cross, the Listen card plays the day's devotional read aloud (generated with ElevenLabs). It keeps playing in the background, with lock-screen controls.
8. My church: Settings (gear in the top toolbar) > My church. Search for a church by name and city, for example "First Baptist Church Dallas", and save it. Church details come from Google Places; the app never asks for location permission.
9. Notes: the Notes tab. Create a note; the AI button helps compose it.

YOUR OWN AI KEY (OPTIONAL)
Settings > AI Provider lets a user paste their own API key from OpenAI, Anthropic, Moonshot or OpenRouter to use that provider's models. The key is validated, encrypted at rest on our server and never shown again; that provider bills the user directly. It is optional and not needed to review the app. SureWord does not sell keys or credits.

REPORTING A BAD ANSWER
Under every answer, the thumbs-down button lets the user report it and pick a reason (Not KJV, Doctrinally off, Missed my question, Wrong or missing verse, Too long). Settings > Send feedback sends a message to the developer. Every reported answer and every feedback message is reviewed by the developer in a private review queue, where each one is read and marked reviewed; reported answers can also become test cases in the assistant's answer evaluations.

ACCOUNT DELETION
Settings > Account > Delete account, then confirm. This permanently deletes the account and all of its data on our servers and signs the user out. Please do not delete the demo account during review.

NOTIFICATIONS
Optional. The app asks for permission only after a first answer or a first visit to Pick Up Your Cross, never at launch.

CONTENT
All Scripture is the King James Version (with NKJV available as an option). Answers are written from a Christian perspective that holds the Bible as the Word of God. The app has no user-to-user messaging and no ads.

Privacy policy: https://sureword.app/privacy
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
