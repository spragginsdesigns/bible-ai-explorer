# VerseMind for Android — Changelog

All notable changes to the Android app. Versions correspond to the APKs
delivered to the Drive share link and installed via `/push-phone`.

## [1.2.0] — 2026-08-09

### Added
- **Slash commands.** Typing `/` in the chat input opens a glass command
  palette. AI commands are interpreted server-side by the model with its tools:
  `/note` (or `/add`) saves the last answer to notes, `/verse <ref>` quotes a
  passage word-for-word, `/search <topic>` searches the Scriptures,
  `/web <query>` searches the web, `/memory` recalls what VerseMind knows
  about you. Local commands run instantly: `/new`, `/clear` (with confirm),
  `/history`. The note AI panel gets `/suggest`, `/verse`, `/clear`.

### Tooling
- `scripts/push-phone.sh` + the `/push-phone` Claude skill: build and install
  straight to the S24 Ultra over wireless ADB, with port-rotation self-healing
  and a step-by-step recovery ladder when the phone is unreachable.

## [1.1.0] — 2026-08-09

### Changed
- **Sign-in rebuilt as the email-code flow** (enter email → 6-digit code).
  The Clerk instance only allows `email_code` + Google as first factors, so
  the password form could never succeed. Google SSO unchanged.

### Fixed
- Notes filter chips rendered as giant vertical pills (horizontal ScrollViews
  needed `flexGrow: 0`; the notes list needed `flex: 1`).
- (Server, paralleled) `addToNote` no longer creates a stray note when the
  model sends a blank `noteId`, and "this note" in the note chat always means
  the currently open note.

### Verified
- Full emulator pass: sign-in, streamed chat with verse cards, notes CRUD,
  and the AI writing John 3:16 into an open note with the editor updating live.

## [1.0.1] — 2026-08-09

### Fixed
- **Keyboard no longer covers the input fields.** Android 16's mandatory
  edge-to-edge ignores `adjustResize`; every KeyboardAvoidingView now uses
  `behavior="padding"`, and inputs drop the floating-tab-bar clearance while
  the keyboard is up so they sit flush against it. Applies to chat, sign-in,
  the note editor, and the note AI panel.

## [1.0.0] — 2026-08-09

Initial release — full native port of VerseMind (Expo SDK 57 / RN 0.86, arm64).

- **Chat**: streaming answers from GPT-5.6 Terra via the shared Vercel
  backend; retrieved-verse cards with match-strength badges; web-result cards;
  "Added to note" cards; follow-up chips; tool activity indicators
  ("Searching the Scriptures…"); conversation history with server persistence
  and restore; smart auto-scroll.
- **Notes**: folders, colored tags, search, pin, sort; Tiptap-compatible rich
  text editor (HTML round-trips with the web editor); per-note AI panel with
  history, Suggest Verses, and live note-append.
- **Auth**: Clerk native sign-in, session tokens in SecureStore, same account
  and data as the web app.
- **Design**: the web app's dark glassmorphism ported to native tokens —
  Pirata One wordmark, Cormorant Garamond Scripture blockquotes, amber
  accents, glass bottom tab bar. No stock Material UI.
