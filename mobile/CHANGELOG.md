# SureWord for Android — Changelog

All notable changes to the Android app. Versions correspond to the APKs
published to GitHub Releases (`mobile/scripts/release-apk.sh`) and installed
via `/push-phone`.

## [1.18.0] - 2026-08-19

### Added
- **The assistant can now edit your notes, not just write into them.** Ask it
  to reformat, reorganize, or clean up any note and it reads the whole note
  first, rewrites it faithfully, and confirms. It can also read your notes in
  full and find them by meaning, not just wording ("that note about talking
  to my kids about prayer"), so past study informs new answers.
- **Original-languages word study, grounded in real data.** The assistant now
  quotes the actual Hebrew (Westminster Leningrad Codex) and Greek (Scrivener
  1894 Textus Receptus, the text underlying the KJV) word by word, with
  Strong's numbers, morphology, and KJV glosses, instead of answering Greek
  and Hebrew questions from memory.
- **Cross-references on tap.** A curated cross-reference set (openbible.info,
  Treasury-style) lets the assistant trace a verse across all of Scripture
  with exact KJV text.
- Streaming activity labels for the new tools ("Reading your note",
  "Rewriting your note", "Tracing cross-references", "Opening the original
  text", "Studying the original word").

### Fixed
- **Bible references and retrieved verses are back.** Scripture search had
  been silently broken since Aug 13: the AstraDB free tier hibernated the
  vector database (and scheduled it for deletion). Verse embeddings now live
  in the same production Neon Postgres as everything else (pgvector), with a
  keyword fallback so retrieval can never silently vanish again. Answers also
  quote key verses as proper blockquotes on every model, not just some.

All of the above is server-side and reaches every installed build
immediately; only the new activity labels need this APK.

## [1.17.1] - 2026-08-19

### Fixed
- **Back now takes you back.** The back button used to dump you on Chat from
  almost anywhere — Pick Up Your Cross, Settings, Memories, a note opened from
  chat — because the tab navigator treated Chat as the fallback destination.
  Back now returns to the screen you actually came from (Cross → Bible,
  Memories → Settings, and so on).
- **The Notes tab opens the notes hub again.** Leaving the Notes tab resets it,
  so tapping Notes always shows all your notes instead of whichever note you
  had open last.
- **Back from inside a note goes to the notes hub**, never to chat — even when
  the note was opened straight from a chat card.

## [1.17.0] — 2026-08-19

### Changed
- **The notification now leads with the Scripture itself.** The body shows the
  verse text — *"Casting all your care upon him; for he careth for you." —
  1 Peter 5:7* — instead of the reference plus an explanation line; the
  why-today line waits on the screen the tap opens.
- **It arrives like it matters.** The daily notification now comes through a
  heads-up channel (banner + sound, like a text message) rather than sliding
  silently into the tray, and it wears the day-star mark in SureWord gold in
  the status bar instead of a generic tinted square.

### Known issue
- **Tapping the notification when the app is closed still opens the app to
  Chat instead of the day.** The app now checks for the launching tap on
  startup, and taps while the app is running deep-link correctly — but when
  the tap itself starts the app, Android hands the app no record of the tap
  (an expo-notifications bug, confirmed on-device with instrumentation: the
  response never reaches the app's code by either API). Needs an upstream fix
  or a native workaround in a future release.

## [1.16.0] — 2026-08-17

### Changed
- **The opening questions are now yours.** The six prompts on the empty chat
  screen used to be the same six for everybody ("What is the story of
  creation?"). They are now drawn from your own walk — the chapters you have
  been reading, what you have already asked, your notes, what SureWord
  remembers about you, and the verse you were given today — so opening the app
  puts your real next questions in front of you, ready to tap. They are written
  as questions *you* would ask, and sending one works exactly as before.
  Softly glowing placeholders appear while they are being prepared (once per
  session), and a brand-new account still gets the classic six.

## [1.15.0] — 2026-08-17

### Added
- **SureWord knows SureWord.** The assistant now carries the app itself in its
  head — the Bible reader and tap-a-verse, notes and folders, memory, settings,
  the model picker, and Pick Up Your Cross. Ask it "what can you do?", "how do
  I change my translation?" or "what's my cross today?" and it answers from
  what the app actually has, rather than guessing.
- **Ask for a different word.** You can now ask SureWord in chat to change
  today's Pick Up Your Cross — a new word, one centred on something specific
  ("something on patience"), or built on a verse you name. It always tells you
  what would be replaced and waits for your yes first, then shows a receipt
  card that opens the new day. `/cross` shows today's word without touching it.
- **↻ A different word for today** on the Daily Cross screen: confirm, and
  optionally type what the new day should centre on, and the day is prepared
  again in place — and the verse it replaces is not handed straight back.

## [1.14.0] — 2026-08-17

### Added
- **Pick Up Your Cross — your guided daily walk** (Luke 9:23: *"take up his
  cross daily"*). Each morning, an AI prepares a whole day around one verse
  chosen for you — from the chapters you've been reading, your recent chats,
  your notes, and your saved memories. A morning notification (on/off toggle
  and delivery hour in Settings → Verse of the Day) opens the new Daily Cross
  screen: the verse, **why it was chosen for you today** (grounded only in
  what you've actually been doing — never invented), how it applies to your
  walk, a short study path with tappable passages, and one question to carry
  through the day, plus a "Go deeper in chat" button. Also reachable any time
  from the ✝ card at the top of the Bible tab, and at sureword.app/cross on
  the web. Remote push arrives once FCM is configured; until then the app
  schedules the morning notification locally on your device, so it works
  today.
- **Reading history.** The reader now privately records the chapters you read
  (after a few seconds on screen, stored on the server under your account) so
  the daily verse — and future personalization — reflects where you actually
  are in the Word.

## [1.13.0] — 2026-08-16

### Added
- **Tap-a-verse.** Tapping any verse in the Bible reader now opens the verse
  sheet and immediately streams a short AI explanation of that verse — what it
  says in context and why it matters — generated with your selected model. A
  softly glowing skeleton shows while the model thinks, and explanations are
  cached for the session so re-tapping a verse is instant. The sheet keeps
  Copy, Share, and Save to note, and a new **✦ Expand with AI** button hands
  the verse to chat exactly like the old "Ask AI about this verse" action.
  Long-press still opens the same sheet. (Web ships the same experience.)

## [1.12.0] — 2026-08-13

### Changed
- **The model picker now shows every model your API key unlocks.** Models are
  grouped by provider — tap OpenAI, Anthropic, or Moonshot to expand its list,
  fetched live from the provider itself (GPT-5.6 Terra, Sol, Luna, GPT-5,
  Claude Opus 5, and anything the provider adds later — no app update needed).
  Providers without a key stay locked with a pointer to Settings → AI
  Providers. Reasoning effort is only sent to models that support it.

## [1.11.1] — 2026-08-13

### Fixed
- **Gboard screenshots now paste directly into the chat composer on Android 12+.**
  Selecting an image from Gboard's clipboard now creates a normal SureWord
  attachment and uploads it through the existing private attachment pipeline.
  The manual Add attachment → Paste screenshot action remains available on all
  supported Android versions.

## [1.11.0] — 2026-08-12

### Added
- **Choose your AI model and reasoning depth.** A new sparkles button in the
  chat header opens a model picker: GPT-5.6 Terra, Claude Opus 5, Claude
  Sonnet 5, and Kimi K3, plus an Auto/Low/Medium/High reasoning selector.
  Your pick becomes the account default across Android, web, and macOS.
- **Bring your own API keys.** Settings → AI Providers lets you connect your
  own OpenAI, Anthropic, or Moonshot (Kimi) key. Keys are validated with the
  provider, stored encrypted, and unlock that provider's models in the picker.
  Models without a key show locked with a pointer to Settings.

## [1.10.0] — 2026-08-11

### Added
- **Attach images and study files directly to chat.** Take a photo, select up
  to five images, choose a PDF/TXT/Markdown/CSV/JSON file, or paste a
  screenshot from the clipboard. SureWord can answer from the attachment even
  when the message has no typed text.
- **Private, durable attachment history.** Files are stored in a private Vercel
  Blob store, reopened with short-lived signed links, and restored with the
  conversation on Android and web. Deleting the conversation removes its
  stored files too.

### Fixed
- **The Android bottom bar is a normal three-destination app nav again.** It
  now shows only Chat, Bible, and Notes with consistent icons and active-state
  treatment; push-only Settings and Memories routes cannot leak into it.
- **The attachment source menu matches SureWord instead of Android's stock
  Material alert.** Camera, library, file, and clipboard actions now live in a
  dark branded bottom sheet.
- **NKJV supplied words render as italics instead of raw HTML.** Inline
  `<i>...</i>` markup is converted into the loaded Scripture italic face and
  stripped from copied, shared, saved, and Ask AI text.

### Security
- Uploads use exact-path, size-limited signed URLs and are downloaded again by
  the server for MIME, extension, size, signature, UTF-8, and JSON validation
  before the model can see them. Client-provided file URLs are never trusted.

## [1.9.0] — 2026-08-11

### Added
- **SureWord can now remember you.** A new Memory section in Settings carries
  the ChatGPT-style memory feature: as you chat, SureWord learns the things
  worth holding onto — who you are, what you're praying about, what you're
  studying — so later answers start from knowing you instead of from zero.
- **An "Enable memory" switch, and off really means off.** Turn it off and
  SureWord stops both using what it remembers and learning anything new —
  but nothing is thrown away. Your saved memories are kept untouched, waiting
  for whenever you turn it back on.
- **A Manage memories screen, because it's your memory, not ours.** From
  Settings you can see everything SureWord has saved, grouped by what it's
  about; ask for an AI-written summary of the whole picture; add a memory by
  hand; delete any single one; or clear the lot in one tap. Nothing it
  remembers is hidden from you.

## [1.8.2] — 2026-08-10

### Fixed
- **Tapping a second verse in a chat answer opens the right chapter.** Only the
  first "Read" worked per app session: every later one dropped you back on the
  chapter you had opened first, with nothing highlighted. `bible` is a nested
  stack, so the reader stays mounted once opened and a second deep link reuses
  it and merely updates its params — but the screen read those params only in
  its `useState`/`useRef` initializers, which run at mount and never again. The
  params are now what the reader renders, and chapter paging goes through
  `router.setParams` so they always describe what is on screen.
- **The verse highlight fires on every deep link, not just the first.** The
  scroll-and-flash was armed by a one-shot flag; it is now keyed by the
  reference, and gated on the loaded chapter matching the requested one. Params
  change a render before the new text arrives, and in that gap the effect used
  to burn its guard on the incoming verse while the previous chapter's text was
  still on screen — so the flash never ran once the right chapter loaded.
- Chapter loads can no longer land out of order. Two loads racing (paging fast,
  or deep-linking mid-fetch) could paint the loser's text, since NKJV is fetched
  over the network and the slower response is not always the older request.

## [1.8.1] — 2026-08-10

### Changed
- **New logo.** The old mark was a brain wired into a book — a VerseMind idea,
  since "mind" was the name. SureWord is from 2 Peter 1:19 ("a light that
  shineth in a dark place, until the day dawn, and the day star arise in your
  hearts"), so the mark is now the day star rising over the open Word, its rays
  doubling as the pages. Gold on the app's own near-black.
- The launcher, adaptive, splash, and chat-home icons all come from that one
  master now, so they can no longer drift apart between releases.

## [1.8.0] — 2026-08-10

### Fixed
- **Sign-in works again.** The app shipped a Clerk publishable key encoding
  `clerk.bible-ai-explorer.vercel.app`, a host that no longer resolves, and it
  still passed a `proxyUrl` pointing at the `/__clerk` proxy that was deleted
  when Clerk moved to its own domain. Both are gone: the app now uses the
  production key for `clerk.sureword.app` and lets Clerk reach its Frontend API
  directly, the way a custom-domain instance is meant to work.
- The API base URL now points at `https://sureword.app` instead of the legacy
  `bible-ai-explorer.vercel.app` host.

### Changed
- **The app is now SureWord on the device, not just in the code.** The native
  project was a stale prebuild still carrying `com.spragginsdesigns.versemind`
  and a launcher reading "VerseMind" — the earlier rename only ever touched
  `app.json`. Regenerated it, so the package is now
  `com.spragginsdesigns.sureword` and the launcher reads **SureWord**.
- Dropped the obsolete `edgeToEdgeEnabled` flag (Android 16 makes edge-to-edge
  mandatory and Expo now warns on it).

> **Upgrading:** the package name changed, so this installs alongside the old
> VerseMind app rather than over it. Uninstall VerseMind after confirming
> SureWord signs in.

## [1.7.0] — 2026-08-10

### Added
- **Settings.** A new gear (⚙) button in the chat header opens a Settings
  screen with three sections:
  - **Appearance** — System / Dark / Light. The whole app (every screen,
    sheet, editor, and the tab bar) now follows the choice; System tracks the
    phone's own dark or light mode. `userInterfaceStyle` is now `automatic`.
  - **Bible translation** — a persisted KJV/NKJV default shared with the
    Bible reader's chips and used as the chat verse-attachment fallback.
    (VerseMind's AI answers still quote the KJV by design.)
  - **Account** — your profile and a Sign out button, which the app has
    never had (previously only the web client's Clerk menu could sign out).
- Settings persist across launches (AsyncStorage, hydrated before the splash
  screen hides, so there is no theme flash on startup).

### Changed
- **The design system is now theme-driven.** `src/theme` ships dark and light
  palettes, and every screen resolves colors through the settings store
  (`useTheme` / `useThemedStyles`) instead of a hardcoded dark palette.

## [1.6.1] — 2026-08-10

### Fixed
- **A stale session can no longer masquerade as "signed in".** When the
  backend rejects the session token even after a fresh-token retry (the
  signature of a session cached from the old development Clerk instance after
  the production migration), the app now signs out locally and returns to the
  sign-in screen instead of rendering a signed-in UI where every request
  silently fails. Fixes "ask a question and nothing happens" for any install
  carrying pre-migration credentials.

## [1.6.0] — 2026-08-10

### Added
- **Add any answer to your notes.** Settled assistant messages now have an
  "✎ Add to notes" action that opens a picker sheet: create a new note from
  the whole answer, or append it to any existing note (searchable list).
  Uses the new shared `POST /api/notes/append` route; the same feature ships
  on the web client in the same release (parity rule).

## [1.5.0] — 2026-08-10

### Changed
- **Moved to the Clerk production instance.** Sign-in previously ran through a
  Clerk *development* instance, so the Google consent screen asked users to
  continue to `helpful-jawfish-28.clerk.accounts.dev` — an unfamiliar hostname
  for a Bible study app, and capped at 100 users. It now reads **VerseMind**,
  backed by our own Google OAuth credentials.
- **This build is required.** Tokens issued by the old development instance are
  no longer accepted by the backend, so 1.4.x and earlier cannot sign in. Users
  keep all of their data: accounts are matched by verified email on first
  sign-in and re-attached to their existing conversations, notes and memories.
- Clerk's Frontend API is reached through a proxy on our own domain
  (`/__clerk`), which is what a production instance requires when the app is
  served from a `*.vercel.app` host.

### Added
- **Tap a verse reference, jump to the Bible.** References like "John 3:16"
  or "1 John 5:1–4" in chat messages (assistant and user alike) are now
  tappable amber links that open the Bible reader at that exact verse, with
  the same scroll-and-flash highlight as the Read chip. Ranges jump to the
  start verse; trailing translation tags ("John 3:16 KJV") are handled;
  anything unparseable stays plain text. Parity with the web client, whose
  verse popover now also has a "Read in the Bible" link.

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
