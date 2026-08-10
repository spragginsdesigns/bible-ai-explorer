# VerseMind for Android — Changelog

All notable changes to the Android app. Versions correspond to the APKs
delivered to the Drive share link and installed via `/push-phone`.

## [1.4.1] — 2026-08-10

### Changed
- **Instant notes.** The notes library and editor now load from a persistent
  on-device cache (AsyncStorage) and revalidate silently in the background —
  the list and previously-opened notes render immediately with no spinner, and
  edits sync between the editor and the list with no pull-to-refresh.
  Revalidation also runs on tab focus and when the app returns to the
  foreground.

### Fixed
- **Faster notes API.** Read routes no longer write a User row on every
  request, the notes list endpoint serves a lightweight summary payload
  (bodies load per note), the single-note GET no longer ships the whole AI
  chat history, and note PATCH/DELETE are single database round-trips.
- Returning from the editor no longer flashes a refresh spinner over the list.

## [1.4.0] — 2026-08-10

### Added
- **Bible tab.** A new YouVersion-style tab between Chat and Notes: all 66
  books grouped by testament, a chapter-number grid per book, and a full
  chapter reading screen with adjustable type size (A−/A+, remembered for the
  session).
- **Offline KJV.** The complete King James text (31,102 verses) is bundled
  with the app and loads instantly without a network connection.
- **NKJV via network.** A KJV/NKJV toggle on the reading screen fetches NKJV
  chapters from bolls.life (15s timeout, per-session in-memory cache) with a
  friendly error + retry on failure.
- **Verse actions.** Long-press any verse for Copy, Share (Android share
  sheet), Save to note (same Scripture-blockquote note as chat verse cards),
  and Ask AI.
- **Ask AI hand-off.** A floating "✦ Ask AI" button asks about the current
  chapter, and the verse sheet can ask about a single verse; both push to the
  Chat tab with a prefilled, focused input (`?prompt=` — never auto-sent).

### Changed
- **Reading mode replaced.** The old `/reader` screen is gone; verse-card
  "Read" buttons now resolve the reference and open it inside the Bible tab
  (scrolling to and briefly highlighting the exact verse), with prev/next
  navigation that rolls into adjacent books.
- **Tab bar fix.** The custom glass tab bar now skips routes whose
  `options.href === null`, so hidden push-only screens no longer render a
  ghost tab.
- **Chat streaming.** `experimental_throttle: 50` on the AI SDK's `useChat`
  smooths token-by-token rendering during streams.

## [1.3.0] — 2026-08-10

### Added
- **Verse actions.** Every retrieved-verse card now has Copy, Share (Android
  share sheet), Save to note (creates a note titled by the reference with a
  Scripture blockquote, then opens it), and Read.
- **Reading mode.** New full-screen passage view (`/reader`) that fetches the
  exact KJV text via `/api/get-verse`, with adjustable type size (A−/A+),
  per-verse numbering, and copy/share of the whole passage. Reachable from
  verse cards; hidden from the tab bar.
- **EAS build pipeline.** `eas.json` with `development` (debug APK),
  `preview` (internal APK), and `production` (AAB, auto-increment) profiles.
- **OTA updates.** `expo-updates` wired with the `appVersion` runtime policy —
  JS-only fixes can ship via `eas update` instead of a fresh APK.
- **Test harness.** Vitest + `npm test` / `npm run typecheck` scripts. 41
  tests cover slash-command parsing, the chat view-model (tool outputs,
  follow-ups, DB history mapping), relative-date formatting, verse actions
  (share formatting, HTML escaping, create→patch note flow), and the API
  layer's retry/timeout/offline behavior.

### Changed
- **API resilience.** `apiJson` and `makeAuthedFetch` now retry once with a
  freshly-fetched Clerk token on 401 (an expired cached token used to surface
  as a user-facing failure), time out REST calls after 30s, and map network
  failures to a clear "you appear to be offline" error (`ApiError`).
- **Versions synced.** `package.json` and `app.json` both track the app
  version (1.3.0); `appVersionSource: local` in EAS keeps it that way.
- **Typed routes re-enabled** (`experiments.typedRoutes: true`); new
  navigation uses the object form (`router.push({ pathname, params })`).

### Notes for release
- Run `eas init` once to link the EAS project, then `eas update:configure`
  to stamp the updates URL into `app.json` (project id is intentionally not
  committed).
- `package-lock.json` needs a local `npm install` in `mobile/` to pick up the
  new dependencies (the lockfile is too large to commit via the API).
- Clerk publishable key is still the dev instance (`pk_test_…`); swap to the
  live key and configure the Play Store OAuth redirect before distribution.

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
