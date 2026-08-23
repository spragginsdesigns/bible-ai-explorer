# SureWord Client Parity Tracker

**Rule (see `CLAUDE.md`):** Android (`mobile/`) is the primary client and the
source of truth. Every other client must reach and maintain **1:1 feature
parity**. A feature is not "done" until it is ✅ on every client. Web and macOS
may each be a superset (features Android lacks are allowed), never a subset.

Update this file whenever a feature changes on any client.

Last full audit: 2026-08-17 (Android v1.16.0; the welcome screen's questions are
now personalized on all three clients, on top of 1.15.0's app-aware assistant,
daily-cross tools and "a different word for today" control — shipped to Android,
web and macOS 1.3.0 together. The remaining macOS gaps are all one feature: the
BYOK provider settings and model picker from Android 1.11.0/1.12.0).

iOS audit: 2026-08-18 — the iOS client (`macos/SureWord-iOS/`, iOS 26, SwiftUI)
reached the table below with BYOK included (a feature macOS still lacks). Known
deferrals: editor toolbar undo/redo, hardware-Tab list indent, Dynamic Type
live-rescaling inside the editor canvas, and APNs delivery (no `aps-environment`
entitlement — the local daily reminder covers Verse of the Day). Verified:
iOS 51/51 and macOS 306/306 tests green; signed-in flows are compile- and
unit-tested but not yet run against a live Clerk session.

Legend: ✅ full parity · 🟡 partial / different behavior · ❌ missing · ➕ superset (allowed)

## Clients

| Client | Path | Status |
|---|---|---|
| Android | `mobile/` | Source of truth (v1.16.0) |
| Web | `src/` | Tracked column-by-column below |
| macOS | `macos/` | Native SwiftUI client, tracked column-by-column below. See `macos/README.md`. |
| iOS | `macos/SureWord-iOS/` | Native SwiftUI client (iOS 26, Liquid Glass); shares `macos/Shared/` with macOS. Tracked column-by-column below |

Layout adapts to each form factor, which the parity rule allows: macOS uses a
sidebar, menu bar and keyboard shortcuts (⌘1/2/3 sections, ⌘N, ⌘K, ⌘,) where
Android has a bottom tab bar; iOS uses the stock iOS 26 tab bar with Settings
as a push route from the toolbar gear, and presents tap-a-verse, history, the
model picker and the Daily Cross as native sheets; no *capability* may be
missing. macOS deep links travel through in-app state (`AppModel`) rather
than URL params; iOS uses `sureword://` URLs (`sureword://cross`,
`sureword://verse?ref=…`) buffered through `PendingDeepLinks`, and in-app
hops travel through notifications routed by `TabShell` (the single owner of
tab selection). Same behavior, different plumbing.

## Shell & Auth

| Feature | Android | Web | macOS | iOS | Notes |
|---|---|---|---|---|---|
| Clerk email-code + Google SSO sign-in | ✅ | ✅ | ✅ | ✅ via ClerkKit (native API) | macOS via ClerkKit (native API) |
| Password sign-in for password-bearing accounts (Play review demo account) | ✅ 1.19.1 - Continue detects the password factor, code fallback | ✅ automatic via Clerk `<SignIn>` | ❌ ClerkKit email-code/SSO only | ❌ ClerkKit email-code/SSO only | Only the review demo account has a password; Device Trust disabled 2026-08-20 so it works on new devices |
| Sign-out / account UI | ✅ Settings → Account | ✅ Settings → Account + `UserButton` | ✅ sidebar `UserButton` + Settings | ✅ Settings → Account | Android gained sign-out in 1.7.0 |
| Theme: dark / light / system | ✅ Settings → Appearance | ✅ Settings → Appearance + top-bar toggle | ✅ Settings → Appearance | ✅ Settings → Appearance |  |
| Tab/nav: Chat · Bible · Notes | ✅ bottom tab bar | ✅ bottom tab bar on mobile (`MobileBottomNav`, 1:1 port); top-bar tabs on desktop | ✅ sidebar + ⌘1/2/3 | ✅ stock iOS 26 tab bar (Liquid Glass free); Settings/Memories push-only | Form-factor adaptation |
| Link to Android APK for install | n/a | ✅ | n/a | n/a | Stable GitHub Releases link in `src/lib/constants.ts`; web-only requirement |

## Settings

| Feature | Android | Web | macOS | iOS | Notes |
|---|---|---|---|---|---|
| Settings screen + gear entry point | ✅ `⚙` in chat header → `/settings` (push-only) | ✅ gear in chat top bar → `/settings` | ✅ sidebar gear → sheet, ⌘, and App menu | ✅ toolbar gear on every tab root → push |  |
| Appearance: System / Dark / Light | ✅ persisted (AsyncStorage) | ✅ persisted (next-themes) | ✅ persisted (UserDefaults) | ✅ persisted (UserDefaults) |  |
| Default Bible translation (KJV/NKJV) | ✅ shared with reader chips + chat attach fallback | ✅ same | ✅ same | ✅ same | AI answers quote the selected translation (sent as `translation` in the `/api/ask-question` body); note AI stays KJV |
| Sign out | ✅ confirm dialog → `signOut()` | ✅ button → Clerk `signOut` | ✅ confirm dialog | ✅ confirm dialog |  |
| Memory: enable toggle (off = not used/learned, rows kept) | ✅ Settings → Memory | ✅ Settings → Memory | ✅ Settings → Memory | ✅ Settings → Memory | Server state (`PATCH /api/memories`), enforced in `src/lib/memory.ts` |
| Memory: manage screen (summary, add, delete, clear-all) | ✅ push-only `/memories` | ✅ `MemoryManager` dialog | ✅ sheet from Settings | ✅ push route from Settings | Summary via `POST /api/memories/summary` (on-demand LLM, never auto-fires) |
| About (version, KJV mission note) | ✅ | ✅ | ✅ | ✅ |  |
| AI Providers: BYOK API keys (add / replace / remove, validated + encrypted) | ✅ Settings → AI Providers (1.11.0) | ✅ Settings → AI Providers | ❌ | ✅ Settings → AI Providers | `GET/POST/DELETE /api/providers`; keys unlock that provider's models in the picker; only last4 ever shown |
| Verse of the Day: enable toggle + delivery hour | ✅ Settings → Verse of the Day (1.14.0) | 🟡 no browser notifications; `/cross` page is always available | ✅ 1.1.0 | 🟡 local reminder only | Stored per push token server-side (`POST/DELETE /api/push-tokens`); local hour in the device's timezone. Android delivery: remote Expo push once FCM/EAS is configured, locally scheduled daily notification until then. macOS schedules a repeating local `UNCalendarNotificationTrigger` at the chosen hour and registers no push token (APNs needs the paid program). iOS does attempt APNs registration for `POST /api/push-tokens`, but without the `aps-environment` entitlement (paid program) the registration always fails and the locally scheduled daily reminder is the delivery path |
| Pick Up Your Cross: guided daily screen (verse, why-today, application, study path, question, chat CTA) | ✅ `/cross` + ✝ card on Bible tab (1.14.0) | ✅ `/cross` + ✝ card on Bible page | ✅ 1.1.0 | ✅ sheet over the tab shell + card on the Bible tab | `GET /api/verse-of-day/today` (cron entry reused, else generated on demand); shared generator `src/lib/daily-cross.ts`; docs in `docs/FEATURES.md`. macOS: sidebar section (⌘4) + ✝ card above the Bible book list |
| Pick Up Your Cross: "↻ A different word for today" (confirm + optional focus) | ✅ 1.15.0 | ✅ | ✅ 1.2.0 | ✅ | `POST /api/verse-of-day/today` with an optional `focus`; the replaced verse joins the exclusion list, so it is not handed straight back |

## Chat

| Feature | Android | Web | macOS | iOS | Notes |
|---|---|---|---|---|---|
| Streaming chat via `POST /api/ask-question` | ✅ | ✅ | ✅ | ✅ | Shared backend; macOS has recorded-stream regression fixtures |
| Model + reasoning-effort picker (locked models point at Settings) | ✅ sparkles button in chat header (1.11.0) | ✅ picker on chat input | ❌ | ✅ chat-header button → sheet | Served by `GET /api/ai/models`; sends `modelId`/`effort` in the chat body; last pick persists as the account default |
| Provider-grouped picker with live model lists (tap provider → every model its key unlocks, fetched from the provider) | ✅ accordion in picker sheet (1.12.0) | ✅ accordion in picker | ❌ | ✅ provider sections in picker sheet | Server lists models live per provider with the resolved key; curated registry is label source + outage fallback; effort only sent to models that support it |
| Conversation list / switch / delete / clear-all | ✅ history modal | ✅ sidebar | ✅ sidebar Recents + ⌘K history sheet | ✅ history sheet | Layout adaptation, OK |
| History restore from `metadata.parts` | ✅ | ✅ | ✅ | ✅ |  |
| Tool activity labels while streaming | ✅ | ✅ | ✅ | ✅ |  |
| Retrieved-verses card w/ match-strength badge | ✅ (>0.75 Strong / >0.6 Moderate / Broad) | ✅ | ✅ | ✅ | Defaults collapsed on all three; user expands on demand; thresholds aligned |
| Verse actions: Copy / Share / Save-to-note / Read-in-Bible | ✅ | ✅ | ✅ | ✅ | Share = share sheet / Web Share / `ShareLink` |
| Tappable verse refs in chat → jump to reader | ✅ | ✅ popover + "Read in the Bible" link | ✅ scroll + flash | ✅ scroll + flash |  |
| Tavily web-results card | ✅ | ✅ | ✅ | ✅ |  |
| Follow-up chips (max 2, `[FOLLOWUP]` parsing) | ✅ | ✅ | ✅ | ✅ |  |
| Note-action receipt cards | ✅ | ✅ | ✅ | ✅ tap opens the note in the editor |  |
| App-aware assistant (knows SureWord's screens, settings, commands and features) | ✅ 1.15.0 | ✅ | ✅ 1.2.0 | ✅ | Shared `appKnowledge` block in `src/utils/systemPrompt.ts`, written from this file; also carried by the per-note AI panel |
| Daily-cross tools in chat (read today's word; replace it only after the user confirms) | ✅ 1.15.0 | ✅ | ✅ 1.2.0 | ✅ | `getDailyCross` / `setDailyCross` in `src/lib/ai-tools.ts`; confirmation is enforced in `dailyCrossGuidance`, not by a UI gate |
| Cross-references tool (`getCrossReferences`: curated refs + exact text per verse) | ✅ | ✅ | ✅ | ✅ | Server-side tool over the bundled openbible.info set (`src/data/crossrefs/`, CC-BY); all clients get it through the shared backend |
| Original-languages tools (`getOriginalText` word-by-word WLC Hebrew / Scrivener 1894 TR Greek with Strong's + morphology; `lookupStrongs` dictionary) | ✅ | ✅ | ✅ | ✅ | Server-side tools over `src/data/originals/` (18 MB bundled, built by `scripts/build-original-languages.mjs`); grounds every original-language claim in data instead of model memory |
| Scripture retrieval: Neon pgvector + keyword hybrid with degraded-mode fallback | ✅ | ✅ | ✅ | ✅ | `searchScripture` now queries the `VerseEmbedding` pgvector table in the production Neon DB (AstraDB retired after its free tier hibernated and silently broke retrieval); IDF keyword hits merge in for exact-wording recall, and keyword-only results serve if the vector store is ever unreachable |
| Streaming activity labels for the new tools (readNote/updateNote/crossrefs/originals) | ✅ 1.18.0 | ✅ | ✅ | ✅ | Older installed builds show the generic "Working" label; completed tool parts are skipped safely |
| "Pick Up Your Cross updated" receipt card → opens the new day | ✅ 1.15.0 | ✅ | ✅ 1.2.0 | ✅ | Only the replace shows a card; reading the day is silent |
| Save whole answer to notes (new note or append via picker) | ✅ | ✅ | ✅ | ✅ | Shared route `POST /api/notes/append` |
| Slash commands (`/new` `/clear` `/history` `/note` `/verse` `/search` `/web` `/memory` `/cross`) | ✅ | ✅ | ✅ | ✅ | `/cross` added 1.15.0 — shows today's word, never replaces it |
| Verse attachment pill (`?prompt=`, `?attachRef&attachText&attachTranslation=`) | ✅ | ✅ | ✅ via in-app state | ✅ via in-app state |  |
| Multimodal file attachments (PNG/JPEG/WebP/GIF, PDF, TXT/MD/CSV/JSON) | ✅ camera, gallery, document picker, clipboard; direct Gboard image paste on Android 12+ | ✅ picker, drag/drop, pasted screenshots | ✅ picker, drag/drop, paste (⌘V) | ✅ photo library, camera, files, clipboard paste | Private durable Blob storage; max 5 files, 10 MB image/PDF, 1 MB text, 25 MB/message |
| Welcome screen with 6 suggested questions | ✅ | ✅ | ✅ | ✅ |  |
| Opening questions personalized from the user's own walk (+ shimmer while they load) | ✅ 1.16.0 | ✅ | ✅ 1.3.0 | ✅ | `GET /api/suggested-questions`; generator `src/lib/suggested-questions.ts` over the shared `src/lib/study-context.ts`. Cached in memory per session and per account on every client, never persisted — the chips quote the user's own study. Static six for a new account or any failure |
| Full Markdown answers (Scripture blockquotes, headings, lists, tables) | ✅ | ✅ | ✅ | ✅ | macOS block renderer ported from Android's `MarkdownBody.tsx` |

## Bible Reader

| Feature | Android | Web | macOS | iOS | Notes |
|---|---|---|---|---|---|
| Book picker (testament sections, genre groups) | ✅ | ✅ | ✅ | ✅ drill-down: books → chapters → reader |  |
| Chapter grid | ✅ | ✅ | ✅ | ✅ |  |
| Reading screen (KJV bundled, per-book JSON) | ✅ | ✅ | ✅ | ✅ | Same data bundle on all three (`mobile/src/features/bible/data/`) |
| Parchment page surface (photoreal scroll paper, light + dark variants follow theme) | ✅ 1.19.0 | ✅ | ❌ | ❌ | Textures from `scripts/generate-parchment.mjs` (`mobile/assets/parchment-*.webp`, `public/textures/`); ink tokens `parchmentInk/Number/Highlight` (mobile) and `.parchment-page` (web). Apple clients pending |
| NKJV translation toggle (bolls.life) | ✅ | ✅ | ✅ | ✅ |  |
| Offline verse search + reference quick-jump | ✅ | ✅ | ✅ | ✅ pushed search screen |  |
| Verse actions (Copy / Share / Save to note / Expand with AI) | ✅ tap or long-press sheet | ✅ click/⌥ | ✅ click / context menu | ✅ tap → bottom sheet | Save-to-note = `POST /api/notes` + `PATCH /api/notes/:id` (ported `verseActions`) |
| Tap-a-verse streaming AI explanation (universal model, glowing skeleton) | ✅ 1.13.0 | ✅ | ✅ 1.1.0 | ✅ bottom sheet | `POST /api/verse-insight` plain-text stream; effort pinned low; session-cached per verse. macOS renders it in a panel pinned under the reader rather than inline — streaming into the verse list re-measured the whole chapter per update and starved the stream |
| "✦ Ask AI" whole-chapter attach | ✅ | ✅ | ✅ | ✅ floating Ask AI button |  |
| Prev/Next chapter (rolls across books) | ✅ | ✅ | ✅ | ✅ |  |
| Font-size controls (4 steps) | ✅ session-scoped | ✅ session-scoped | ➕ persisted (UserDefaults) | ➕ persisted (shared `BibleModel`, UserDefaults) | macOS superset: persists across launches |
| Deep links (`/bible/chapter?book=N&chapter=M&verse=V`) | ✅ | ✅ | ✅ via in-app state, scroll + flash | ✅ `sureword://verse?ref=…` + in-app state, scroll + flash |  |
| Reading-history tracking (powers Verse of the Day) | ✅ 1.14.0 | ✅ | ✅ 1.1.0 | ✅ | `POST /api/reading-events` after ~5s on a chapter; server dedupes within 1h |
| Verse highlighting (YouVersion-style: per-verse color wash, 8 presets + custom picker, remove) | ✅ verse sheet | ✅ verse panel | ✅ panel + context menu | ✅ verse sheet | Shared backend: `VerseHighlight` table + `GET/PUT/DELETE /api/highlights`, keyed `(userId, translation, book order int, chapter, verse)`, color stored as `#RRGGBB`; translucent 0.25-alpha wash so it reads in light/dark/parchment. Optimistic writes with rollback; local caches (`sureword.highlights-cache.v1` / web hook / `highlights-cache.v1.json`) for instant paint |

## Verse of the Day

| Feature | Android | Web | macOS | iOS | Notes |
|---|---|---|---|---|---|
| AI-personalized daily verse (context: reading history + chat + notes + memories; never repeats last 30) | ✅ 1.14.0 | ✅ via `/cross` | ✅ 1.1.0 via Daily Cross | ✅ via the Daily Cross sheet | Shared backend engine: hourly Vercel cron `GET /api/cron/verse-of-day`, utility model, `VerseOfDay` table, John 3:16 fallback. Only Android registers a push token, so web and macOS generate the day on demand when opened — same entry, pulled instead of pushed |
| Morning push notification carrying the verse text | ✅ 1.14.0, verse-text body + heads-up channel 1.17.0 | ❌ | 🟡 local reminder only | 🟡 local reminder only | Expo push; body is the KJV text itself and a tap while the app is running opens the Pick Up Your Cross screen. KNOWN GAP: a tap that cold-starts the app loses its deep link (upstream expo-notifications bug, see `useVerseOfDayNotifications.ts`). macOS shows a local daily reminder that carries no verse and opens the Daily Cross; carrying the verse needs an APNs key from the paid Apple Developer Program. iOS is the same story: the app registers for remote notifications, but the target ships no `aps-environment` entitlement, so APNs never delivers a token and the local reminder (tap → Daily Cross sheet) is the delivery path |

## Notes

| Feature | Android | Web | macOS | iOS | Notes |
|---|---|---|---|---|---|
| Rich-text editor, autosave 1.5s | ✅ TenTap | ✅ Tiptap v3 | ✅ native lossless HTML editor | 🟡 native lossless HTML editor | macOS editor round-trips TenTap/Tiptap HTML byte-identically (fixture-tested). iOS shares that editor core (same round-trip fixtures, iOS suite) with three documented deferrals: no toolbar undo/redo (system undo gesture only), no hardware-Tab indent (toolbar buttons only), and the editor canvas does not live-rescale on a Dynamic Type change (applies on next render) |
| Folders / colored tags / pin / search / sort | ✅ | ✅ | ✅ | ✅ |  |
| Per-note AI panel (`/api/note-ai`), append-to-note | ✅ | ✅ | ✅ | ✅ sheet |  |
| Note AI history persist + clear | ✅ | ✅ | ✅ | ✅ |  |
| Note slash commands (`/suggest` `/verse` `/clear`) | ✅ | 🟡 | ✅ | ✅ | Web panel has Suggest-Verses button; slash commands pending |
| Note created from chat `addToNote` tool | ✅ | ✅ | ✅ | ✅ | Shared backend |
| AI reads whole notes on demand (`readNote`) | ✅ | ✅ | ✅ | ✅ | Shared backend; in the per-note panel it defaults to the open note |
| AI rewrites/reformats a note when asked (`updateNote`) | ✅ | ✅ | ✅ | ✅ | Shared backend; prompt-gated: only on explicit request, must `readNote` first, preserves user content |
| Semantic note search (`findNotes` matches by meaning as well as wording) | ✅ | ✅ | ✅ | ✅ | `NoteEmbedding` pgvector table in Neon, re-embedded on every note write on any client (`src/lib/note-embeddings.ts`); backfilled once via `scripts/backfill-note-embeddings.mjs` |

## How to add a feature (the parity workflow)

1. Ship it on Android first (`mobile/`), bump `mobile/app.json` version + `mobile/CHANGELOG.md`.
2. Port it to web, macOS and iOS in the same release cycle — same endpoints, same behavior; adapt only layout idioms.
3. Update this file's tables; every client's cell must be ✅ before the release is done.
4. Verify web with `pnpm lint` / `pnpm build`; Android with `cd mobile && npm run typecheck && npm test`; macOS with `cd macos && xcodegen && xcodebuild -scheme SureWord -destination 'platform=macOS' -derivedDataPath build test`; iOS with `cd macos && xcodebuild -scheme SureWord-iOS -destination 'platform=iOS Simulator,name=iPhone 17' -derivedDataPath build-ios test`.
