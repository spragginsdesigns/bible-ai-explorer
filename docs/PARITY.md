# SureWord Client Parity Tracker

**Rule (see `CLAUDE.md`):** Android (`mobile/`) is the primary client and the
source of truth. Every other client must reach and maintain **1:1 feature
parity**. A feature is not "done" until it is ✅ on every client. Web and macOS
may each be a superset (features Android lacks are allowed), never a subset.

Update this file whenever a feature changes on any client.

Last full audit: 2026-08-12 (Android v1.10.0; macOS columned for the first time).

Legend: ✅ full parity · 🟡 partial / different behavior · ❌ missing · ➕ superset (allowed)

## Clients

| Client | Path | Status |
|---|---|---|
| Android | `mobile/` | Source of truth (v1.10.0) |
| Web | `src/` | Tracked column-by-column below |
| macOS | `macos/` | Native SwiftUI client, tracked column-by-column below. See `macos/README.md`. |

Layout adapts to each form factor, which the parity rule allows: macOS uses a
sidebar, menu bar and keyboard shortcuts (⌘1/2/3 sections, ⌘N, ⌘K, ⌘,) where
Android has a bottom tab bar; no *capability* may be missing. macOS deep links
travel through in-app state (`AppModel`) rather than URL params — same
behavior, different plumbing.

## Shell & Auth

| Feature | Android | Web | macOS | Notes |
|---|---|---|---|---|
| Clerk email-code + Google SSO sign-in | ✅ | ✅ | ✅ | macOS via ClerkKit (native API) |
| Sign-out / account UI | ✅ Settings → Account | ✅ Settings → Account + `UserButton` | ✅ sidebar `UserButton` + Settings | Android gained sign-out in 1.7.0 |
| Theme: dark / light / system | ✅ Settings → Appearance | ✅ Settings → Appearance + top-bar toggle | ✅ Settings → Appearance | |
| Tab/nav: Chat · Bible · Notes | ✅ bottom tab bar | ✅ bottom tab bar on mobile (`MobileBottomNav`, 1:1 port); top-bar tabs on desktop | ✅ sidebar + ⌘1/2/3 | Form-factor adaptation |
| Link to Android APK for install | n/a | ✅ | n/a | Stable Drive link in `src/lib/constants.ts`; web-only requirement |

## Settings

| Feature | Android | Web | macOS | Notes |
|---|---|---|---|---|
| Settings screen + gear entry point | ✅ `⚙` in chat header → `/settings` (push-only) | ✅ gear in chat top bar → `/settings` | ✅ sidebar gear → sheet, ⌘, and App menu | |
| Appearance: System / Dark / Light | ✅ persisted (AsyncStorage) | ✅ persisted (next-themes) | ✅ persisted (UserDefaults) | |
| Default Bible translation (KJV/NKJV) | ✅ shared with reader chips + chat attach fallback | ✅ same | ✅ same | AI answers quote the selected translation (sent as `translation` in the `/api/ask-question` body); note AI stays KJV |
| Sign out | ✅ confirm dialog → `signOut()` | ✅ button → Clerk `signOut` | ✅ confirm dialog | |
| Memory: enable toggle (off = not used/learned, rows kept) | ✅ Settings → Memory | ✅ Settings → Memory | ✅ Settings → Memory | Server state (`PATCH /api/memories`), enforced in `src/lib/memory.ts` |
| Memory: manage screen (summary, add, delete, clear-all) | ✅ push-only `/memories` | ✅ `MemoryManager` dialog | ✅ sheet from Settings | Summary via `POST /api/memories/summary` (on-demand LLM, never auto-fires) |
| About (version, KJV mission note) | ✅ | ✅ | ✅ | |
| AI Providers: BYOK API keys (add / replace / remove, validated + encrypted) | ✅ Settings → AI Providers (1.11.0) | ✅ Settings → AI Providers | ❌ | `GET/POST/DELETE /api/providers`; keys unlock that provider's models in the picker; only last4 ever shown |

## Chat

| Feature | Android | Web | macOS | Notes |
|---|---|---|---|---|
| Streaming chat via `POST /api/ask-question` | ✅ | ✅ | ✅ | Shared backend; macOS has recorded-stream regression fixtures |
| Model + reasoning-effort picker (locked models point at Settings) | ✅ sparkles button in chat header (1.11.0) | ✅ picker on chat input | ❌ | Served by `GET /api/ai/models`; sends `modelId`/`effort` in the chat body; last pick persists as the account default |
| Provider-grouped picker with live model lists (tap provider → every model its key unlocks, fetched from the provider) | ✅ accordion in picker sheet (1.12.0) | ✅ accordion in picker | ❌ | Server lists models live per provider with the resolved key; curated registry is label source + outage fallback; effort only sent to models that support it |
| Conversation list / switch / delete / clear-all | ✅ history modal | ✅ sidebar | ✅ sidebar Recents + ⌘K history sheet | Layout adaptation, OK |
| History restore from `metadata.parts` | ✅ | ✅ | ✅ | |
| Tool activity labels while streaming | ✅ | ✅ | ✅ | |
| Retrieved-verses card w/ match-strength badge | ✅ (>0.75 Strong / >0.6 Moderate / Broad) | ✅ | ✅ | Defaults collapsed on all three; user expands on demand; thresholds aligned |
| Verse actions: Copy / Share / Save-to-note / Read-in-Bible | ✅ | ✅ | ✅ | Share = share sheet / Web Share / `ShareLink` |
| Tappable verse refs in chat → jump to reader | ✅ | ✅ popover + "Read in the Bible" link | ✅ scroll + flash | |
| Tavily web-results card | ✅ | ✅ | ✅ | |
| Follow-up chips (max 2, `[FOLLOWUP]` parsing) | ✅ | ✅ | ✅ | |
| Note-action receipt cards | ✅ | ✅ | ✅ | |
| Save whole answer to notes (new note or append via picker) | ✅ | ✅ | ✅ | Shared route `POST /api/notes/append` |
| Slash commands (`/new` `/clear` `/history` `/note` `/verse` `/search` `/web` `/memory`) | ✅ | ✅ | ✅ | |
| Verse attachment pill (`?prompt=`, `?attachRef&attachText&attachTranslation=`) | ✅ | ✅ | ✅ via in-app state | |
| Multimodal file attachments (PNG/JPEG/WebP/GIF, PDF, TXT/MD/CSV/JSON) | ✅ camera, gallery, document picker, clipboard; direct Gboard image paste on Android 12+ | ✅ picker, drag/drop, pasted screenshots | ✅ picker, drag/drop, paste (⌘V) | Private durable Blob storage; max 5 files, 10 MB image/PDF, 1 MB text, 25 MB/message |
| Welcome screen, 6 suggested questions | ✅ | ✅ | ✅ | |
| Full Markdown answers (Scripture blockquotes, headings, lists, tables) | ✅ | ✅ | ✅ | macOS block renderer ported from Android's `MarkdownBody.tsx` |

## Bible Reader

| Feature | Android | Web | macOS | Notes |
|---|---|---|---|---|
| Book picker (testament sections, genre groups) | ✅ | ✅ | ✅ | |
| Chapter grid | ✅ | ✅ | ✅ | |
| Reading screen (KJV bundled, per-book JSON) | ✅ | ✅ | ✅ | Same data bundle on all three (`mobile/src/features/bible/data/`) |
| NKJV translation toggle (bolls.life) | ✅ | ✅ | ✅ | |
| Offline verse search + reference quick-jump | ✅ | ✅ | ✅ | |
| Verse actions (Copy / Share / Save to note / Ask AI) | ✅ long-press sheet | ✅ click/⌥ | ✅ click / context menu | Save-to-note = `POST /api/notes` + `PATCH /api/notes/:id` (ported `verseActions`) |
| "✦ Ask AI" whole-chapter attach | ✅ | ✅ | ✅ | |
| Prev/Next chapter (rolls across books) | ✅ | ✅ | ✅ | |
| Font-size controls (4 steps) | ✅ session-scoped | ✅ session-scoped | ➕ persisted (UserDefaults) | macOS superset: persists across launches |
| Deep links (`/bible/chapter?book=N&chapter=M&verse=V`) | ✅ | ✅ | ✅ via in-app state, scroll + flash | |

## Notes

| Feature | Android | Web | macOS | Notes |
|---|---|---|---|---|
| Rich-text editor, autosave 1.5s | ✅ TenTap | ✅ Tiptap v3 | ✅ native lossless HTML editor | macOS editor round-trips TenTap/Tiptap HTML byte-identically (fixture-tested) |
| Folders / colored tags / pin / search / sort | ✅ | ✅ | ✅ | |
| Per-note AI panel (`/api/note-ai`), append-to-note | ✅ | ✅ | ✅ | |
| Note AI history persist + clear | ✅ | ✅ | ✅ | |
| Note slash commands (`/suggest` `/verse` `/clear`) | ✅ | 🟡 | ✅ | Web panel has Suggest-Verses button; slash commands pending |
| Note created from chat `addToNote` tool | ✅ | ✅ | ✅ | Shared backend |

## How to add a feature (the parity workflow)

1. Ship it on Android first (`mobile/`), bump `mobile/app.json` version + `mobile/CHANGELOG.md`.
2. Port it to web and macOS in the same release cycle — same endpoints, same behavior; adapt only layout idioms.
3. Update this file's tables; every client's cell must be ✅ before the release is done.
4. Verify web with `pnpm lint` / `pnpm build`; Android with `cd mobile && npm run typecheck && npm test`; macOS with `cd macos && xcodegen && xcodebuild -scheme SureWord -destination 'platform=macOS' -derivedDataPath build test`.
