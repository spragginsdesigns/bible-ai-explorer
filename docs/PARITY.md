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
| Assistant markdown normalizer + renderer parity (one Scripture card per quote, fences/lists/HTML/CRLF repaired, verse-link forms, 97-vector shared corpus) | ✅ 1.32.0 | ✅ | ❌ own renderer, no normalizer | ❌ | Shared vectors in `tests/fixtures/assistant-markdown-corpus.json`; server prompt rules + persistence fix reach every client |
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
| Answer survives a lost connection (backgrounded app, locked screen, network change) | ✅ 1.24.0, collects on app resume | ✅ collects on tab focus | ❌ | ❌ | Server-side half is shared and already live for every client: `/api/ask-question` drains its own copy of the SSE stream (`consumeSseStream`), so a client disconnect can no longer cancel generation or persist a truncated reply. Each client then polls `GET /api/conversations/{id}` until the finished answer appears and swaps it in instead of showing an error (`answerRecovery.ts`, mirrored). macOS/iOS still surface a stream failure as a failure |
| "Your answer is ready" push when the answer lands after you left | ✅ 1.24.0, own channel + Settings → Chat toggle | ❌ no browser notifications | ❌ | ❌ | Sent only when the requesting client disconnected mid-stream (`req.signal.aborted`); tapping opens that conversation. Android suppresses the push for an answer the user deliberately stopped, which the server cannot distinguish from a dropped connection. Needs a registered push token, which now survives switching the Verse of the Day off (`PushToken.chatReplies`). Same cold-start deep-link gap as the morning push |
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
| Highlights tool in chat (`getHighlights`: the verses the user marked, with colour name + exact text) | ✅ | ✅ | ✅ | ✅ | Server-side tool over the `VerseHighlight` table (`src/lib/highlights.server.ts`); scoped by book/chapter or the most recent 25 across the Bible, newest first. Chapters load once each, so a heavily-marked book is a handful of reads. Read-only — the assistant never adds or removes a highlight |
| Attachments survive a model that cannot read files | ✅ | ✅ | ✅ | ✅ | A file part sent to Kimi K3 was a hard provider 400 that killed the whole answer. `resolveModel({requireAttachments})` now runs any message carrying files on the first attachment-capable model the user has credentials for and streams a status line saying so; with no capable provider unlocked, file parts are stripped and the assistant says it cannot see them |
| Scripture retrieval: Neon pgvector + keyword hybrid with degraded-mode fallback | ✅ | ✅ | ✅ | ✅ | `searchScripture` now queries the `VerseEmbedding` pgvector table in the production Neon DB (AstraDB retired after its free tier hibernated and silently broke retrieval); IDF keyword hits merge in for exact-wording recall, and keyword-only results serve if the vector store is ever unreachable |
| Streaming activity labels for the new tools (readNote/updateNote/crossrefs/originals) | ✅ 1.18.0 | ✅ | ✅ | ✅ | Older installed builds show the generic "Working" label; completed tool parts are skipped safely |
| Live status updates while thinking/working (server-sent `data-status` part) | ✅ | ✅ | ❌ | ❌ | Server streams a single stable-id status part ("Getting ready" → "Reading <file>" → "Thinking" → "Searching the Scriptures"); it arrives before the first token, so the assistant bubble appears immediately. Tool labels still win while a tool is mid-flight; stray persisted `data-` parts are dropped on restore |
| "Pick Up Your Cross updated" receipt card → opens the new day | ✅ 1.15.0 | ✅ | ✅ 1.2.0 | ✅ | Only the replace shows a card; reading the day is silent |
| Save whole answer to notes (new note or append via picker) | ✅ | ✅ | ✅ | ✅ | Shared route `POST /api/notes/append` |
| Slash commands (`/new` `/clear` `/history` `/note` `/verse` `/search` `/web` `/memory` `/cross`) | ✅ | ✅ | ✅ | ✅ | `/cross` added 1.15.0 — shows today's word, never replaces it |
| Verse attachment pill (`?prompt=`, `?attachRef&attachText&attachTranslation=`) | ✅ | ✅ | ✅ via in-app state | ✅ via in-app state |  |
| Multimodal file attachments (PNG/JPEG/WebP/GIF, PDF, TXT/MD/CSV/JSON) | ✅ camera, gallery, document picker, clipboard; direct Gboard image paste on Android 12+ | ✅ picker, drag/drop, pasted screenshots | ✅ picker, drag/drop, paste (⌘V) | ✅ photo library, camera, files, clipboard paste | Private durable Blob storage; max 5 files, 10 MB image/PDF, 1 MB text, 25 MB/message |
| Welcome screen with 6 suggested questions | ✅ | ✅ | ✅ | ✅ |  |
| Opening questions personalized from the user's own walk (+ shimmer while they load) | ✅ 1.16.0 | ✅ | ✅ 1.3.0 | ✅ | `GET /api/suggested-questions`; generator `src/lib/suggested-questions.ts` over the shared `src/lib/study-context.ts`. Cached in memory per session and per account on every client, never persisted - the chips quote the user's own study. Static six for a new account or any failure |
| Gold label on every opening question (reference, or `MEMORY` / `YOUR NOTES` / `TODAY'S VERSE` / `APPLY` / `NEXT CHAPTER` / `DOCTRINE`) | ✅ 1.27.0 | ✅ | ❌ | ❌ | The route returns `{ questions: string[], items: { question, label }[], personalized }` — `questions` stays the plain array every already-installed client reads (Android 1.26 and earlier, the shipped DMG filter out non-strings, so changing that key would have silently dropped them to the static six), and `items` carries the labels in the same order. The server keeps a label only if it is one of the fixed kinds or parses whole as a reference, else falls back to a reference found in the question text, else `null`. Android renders it in the same gold slot as the old reference caption, web above the chip text; both prefer `items`, fall back to `questions`, and upper-case through the mirrored `questionPresentation.ts`. macOS/iOS still read `questions` only |
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

## Reading Plans

| Feature | Android | Web | macOS | iOS | Notes |
|---|---|---|---|---|---|
| Plan screen (one plan at a time: progress, streak, today's reading, the whole day list) | ✅ 1.29.0 `/bible/plan` | ✅ `/bible/plan` | ❌ | ❌ | `GET /api/reading-plans` → `{ active, presets }`. `ReadingPlan` + `ReadingPlanCompletion` tables (migration `20260826150000_reading_plans`); plan days are JSON `[{ day, readings: [{ book, chapter }], focus }]` |
| Four preset plans (Gospels 30 / Psalms & Proverbs 31 / New Testament 90 / Whole Bible in a Year) | ✅ 1.29.0 | ✅ | ❌ | ❌ | GENERATED from the KJV chapter table in `src/lib/reading-plan-presets.ts`, never hand-typed; `tests/reading-plans.test.mjs` asserts the table mirrors `src/data/books.json` and that every day is real Scripture |
| "Build my own": a goal in the user's words + a day count, written by the model | ✅ 1.29.0 goal field + day stepper | ✅ same | ❌ | ❌ | `POST /api/reading-plans` `{ goal, days }` (7-365, `maxDuration = 120`); one structured utility-model call grounded in `loadStudyContext`, then EVERY book/chapter validated against the KJV canon and dropped if invalid |
| Progress fills in from what they actually read - no ticking | ✅ 1.29.0 | ✅ | ❌ | ❌ | A day is done when every chapter of it has a `ReadingEvent` at or after the plan's `startDate`; the same `POST /api/reading-events` the reader already sends. Rules are pure and tested in `src/lib/reading-plan-progress.ts` |
| "Mark done" toggle for reading done outside the app | ✅ 1.29.0 per day + on today's card | ✅ same | ❌ | ❌ | `POST /api/reading-plans/[id]/days/[day]` `{ done }` → the whole plan with fresh progress. Explicit completions live in `ReadingPlanCompletion`, unique on `(planId, day)` |
| Today's chapters open the reader | ✅ 1.29.0 chips → `/bible/chapter` | ✅ links → `/bible/chapter` | ❌ | ❌ | Same navigation the cross study path uses |
| Streak + percent + day states (done / today / upcoming) | ✅ 1.29.0 | ✅ | ❌ | ❌ | Behind on the plan, `currentDay` is the oldest unfinished day, not the calendar day - the user is handed what they missed. Presentation rules mirrored in `mobile/src/features/plan/planView.ts` and `src/components/plan/planView.ts` (vitest suite on the mobile copy) |
| Archive a plan (overflow ⋯, with confirm) | ✅ 1.29.0 | ✅ | ❌ | ❌ | `DELETE /api/reading-plans/[id]` archives; nothing is deleted, and starting a plan archives the previous one (one live plan per user, enforced in `src/lib/reading-plans.ts`) |
| "Reading plan" card at the top of the Bible screen | ✅ 1.29.0 | ✅ | ❌ | ❌ | Shows today's reading, or "Start a plan and read through Scripture" |
| Pick Up Your Cross aligns its study path with today's plan reading | ✅ 1.29.0 "FROM YOUR PLAN" tag | ✅ same tag | ❌ | ❌ | Server side is shared and reaches every client: `loadStudyContext` gained a `planBlock`, and `daily-cross.ts` instructs that the study path IS today's plan reading unless the user pinned a verse or steered the day |
| Assistant knows the plan (`getReadingPlan` / `startReadingPlan` / `markReadingPlanDay`) | ✅ 1.29.0 | ✅ | ✅ shared backend | ✅ shared backend | `startReadingPlan` is prompt-gated like `setDailyCross` AND takes `confirmed: true` - it archives the plan they are on. Activity labels mirrored in `src/lib/tool-activity-labels.ts` and `mobile/src/lib/chatView.ts`; older clients render the tools silently |
| `/plan` slash command | ✅ 1.29.0 | ✅ | ❌ | ❌ | Added to both `slashCommands.ts` copies and to `slashCommandGuidance`; shows today's reading, never starts or changes a plan |

## Timeline, People & Places

The macOS and iOS columns below are source-complete but remain 🟡 until the
native schemes build and the flows are exercised on a Mac runner. Windows
cannot honestly turn those cells green.

| Feature | Android | Web | macOS | iOS | Notes |
|---|---|---|---|---|---|
| Timeline screen (nine eras, gold rail, Creation to Revelation) | ✅ `/bible/timeline` | ✅ `/bible/timeline` | 🟡 source implemented | 🟡 source implemented | 220 KJV-grounded events; a one-row era navigator preserves the rail without spending three mobile rows on filters |
| Timeline / People / Places explorer modes | ✅ bundled directories | ✅ authenticated paged directories | 🟡 native list/detail | 🟡 native full-screen | Search is global and grouped; mode, era, query, journey and detail are persistent client state |
| Tap an event: summary, references, who and where | ✅ full-screen route | ✅ full-height sheet on small screens, list/detail on desktop | 🟡 detail pane | 🟡 pushed detail | Stable event lookup is `GET /api/bible/atlas/event?id=` |
| Reference chips open the reader | ✅ 1.30.0 to `/bible/chapter` | ✅ links to `/bible/chapter` | 🟡 resolved into `BibleModel` | 🟡 pushed `ChapterReaderView` | Every client rejects references its reader cannot resolve |
| Person / place entry (description, aliases, key verses, typed relationships, events) | ✅ pushed screen `/bible/atlas/[id]` | ✅ responsive detail panel | 🟡 source implemented | 🟡 source implemented | 186 people, 93 places and 83 reviewed relationships. Collision-prone names carry disambiguators |
| Person journeys and clickable entity-event rows | ✅ | ✅ | 🟡 source implemented | 🟡 source implemented | Shows five anchor events, then filters the rail with `personId` for the full journey |
| Immediate family and Trace connection | ✅ offline routes | ✅ cited detail controls | 🟡 source implemented | 🟡 source implemented | Family is a linear immediate neighborhood; trace uses the shortest reviewed path and shows certainty plus KJV refs |
| "Ask about this" opens chat with a prefilled prompt | ✅ 1.30.0 | ✅ | 🟡 source implemented | 🟡 source implemented | Each native shell switches to Chat with a prompt filled in; it never sends for the user |
| Search people, places and events by name or alias | ✅ 1.30.0 local, instant | ✅ debounced `GET /api/bible/atlas?q=` | 🟡 shared API model | 🟡 shared API model | Ranking is one shared function: "saul of tarsus" finds Paul, "Elias" finds Elijah, "Calvary" finds Golgotha |
| "Who’s in this chapter" from the chapter reader | ✅ 1.30.0 people icon in the header | ✅ people icon in the header | 🟡 reader button | 🟡 reader toolbar | Opens the atlas with a validated book/chapter scope and deduplicates people and places from its events |
| "Timeline & People" card on the Bible screen | ✅ 1.30.0 | ✅ | 🟡 Bible sidebar | 🟡 Bible tab | Native Apple entry points use their platform's existing Bible navigation |
| Ussher dating, labelled as tradition and not Scripture | ✅ inline provenance + footnote | ✅ inline provenance + footnote | 🟡 source implemented | 🟡 source implemented | Structured dates preserve `yearLabel`; undated events are not mislabeled as traditional dates |
| Assistant knows the atlas (`lookupBibleEntity` / `getBibleTimeline`) | ✅ 1.30.0 | ✅ | ✅ shared backend | ✅ shared backend | Read-only, no permission gate. Activity labels mirrored in `src/lib/tool-activity-labels.ts` and `mobile/src/lib/chatView.ts`; older clients render the tools silently. `lookupBibleEntity` also reports how many KJV verses name the person (`findOccurrences`, an exact word scan of the bundled text) |
| `/who` slash command | ✅ 1.30.0 | ✅ | ❌ | ❌ | Added to both `slashCommands.ts` copies and to `slashCommandGuidance` |
| Works offline | ✅ bundled JSON on the device | 🟡 needs the API | 🟡 needs the API | 🟡 needs the API | Deliberate for v2: Android is the primary offline client; the other clients use the authenticated shared API |

## Verse of the Day

| Feature | Android | Web | macOS | iOS | Notes |
|---|---|---|---|---|---|
| AI-personalized daily verse (context: reading history + chat + notes + memories; never repeats last 30) | ✅ 1.14.0 | ✅ via `/cross` | ✅ 1.1.0 via Daily Cross | ✅ via the Daily Cross sheet | Shared backend engine: hourly Vercel cron `GET /api/cron/verse-of-day`, utility model, `VerseOfDay` table, John 3:16 fallback. Only Android registers a push token, so web and macOS generate the day on demand when opened — same entry, pulled instead of pushed |
| Listen (spoken devotional): play/pause, elapsed/total, scrubber, "Read along" transcript | ✅ 1.28.0 (`expo-audio`) | ✅ `<audio>` + custom controls on `/cross` | ❌ | ❌ | `GET`/`POST /api/verse-of-day/audio`; script written by the utility model from the stored day plus real study context, narrated by ElevenLabs (`eleven_multilingual_v2`), MP3 in private Vercel Blob against the `VerseOfDay` row. Generated **once per day, WITH the day** (`scheduleDailyCrossAudio` at every point a cross is stored - on-demand GET, `replaceDailyCross`, and the cron, which narrates after the pushes with a per-run cap and time budget), never on a tap; POST survives only as the manual retry. Playback goes through `GET|HEAD /api/verse-of-day/audio/stream` on our own origin with `Range` forwarded both ways - Chrome's media loader never loads a presigned private-blob URL - so the payload carries `streamUrl` beside `url` and nothing hands `url` to a player. With no `ELEVENLABS_API_KEY` the routes answer `status: "unavailable"` and BOTH clients render nothing at all, timeline stop included. Shared state rules mirrored in `src/components/cross/listen.ts` and `mobile/src/features/cross/listen.ts` |
| Listen playback speed (0.75x / 1x / 1.25x / 1.5x / 2x, remembered) | ✅ 1.30.0 | ✅ | ❌ | ❌ | Cycling chip beside play. Persisted **per client**: web `localStorage` `sureword.listenRate`, Android settings store. Web `audio.playbackRate`; Android `player.setPlaybackRate(rate, "high")` with `shouldCorrectPitch`. Elapsed/total stay in real seconds at every speed. Cycle + normalization rules are pure and tested on both sides |
| Listen: background playback + media notification | ✅ 1.32.0 | ✅ OS media card via `navigator.mediaSession` | ❌ | ❌ | Android: `expo-audio`'s own media3 `MediaSessionService` - the config plugin's `enableBackgroundPlayback: true` adds `FOREGROUND_SERVICE` + `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and declares `expo.modules.audio.service.AudioControlsService`, and the card calls `setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: "doNotMix" })` plus `player.setActiveForLockScreen(true, metadata, { showSeekBackward: true, showSeekForward: true })`. Both are required: without the audio mode the native module pauses every player the instant the activity backgrounds (a screen timeout), and without the lock-screen registration Android kills background audio after ~3 minutes. Notification carries title, `Pick Up Your Cross · <reference>`, the square SureWord mark, play/pause, ±10s (fixed by the library) and the system scrubber; Bluetooth/headset keys come free with the media session. **Needs `expo prebuild` + a new build** - the manifest changed. Web needs no service: browsers hand an `<audio>` element to the OS themselves, so the card only supplies `MediaMetadata` and `seekbackward`/`seekforward`/`seekto` handlers. Neither client survives the card unmounting (the player is released with it) |
| Listen is a SureWord Pro benefit (locked panel for free accounts) | ✅ 1.30.0 | ✅ | ❌ | ❌ | `User.plan` column OR the `PRO_USER_IDS` env allowlist (`src/lib/entitlements.ts`; pure `resolvePlan` in `entitlements-rules.ts`). Server answers `status: "locked"` **before** any DB write, model call or ElevenLabs request, and the stream route refuses too - a free account costs nothing and cannot reach a narration directly. Both clients render an identical lock panel with NO button, since there is nowhere for one to go until billing exists. `GET /api/preferences` also returns `plan` |
| Morning push notification carrying the verse text | ✅ 1.14.0, verse-text body + heads-up channel 1.17.0 | ❌ | 🟡 local reminder only | 🟡 local reminder only | Expo push; body is the KJV text itself and a tap while the app is running opens the Pick Up Your Cross screen. KNOWN GAP: a tap that cold-starts the app loses its deep link (upstream expo-notifications bug, see `usePushNotifications.ts`). macOS shows a local daily reminder that carries no verse and opens the Daily Cross; carrying the verse needs an APNs key from the paid Apple Developer Program. iOS is the same story: the app registers for remote notifications, but the target ships no `aps-environment` entitlement, so APNs never delivers a token and the local reminder (tap → Daily Cross sheet) is the delivery path |

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
