# SureWord Client Parity Tracker

**Rule (see `CLAUDE.md`):** Android (`mobile/`) is the primary client and the
source of truth. The web client (`src/`) must reach and maintain **1:1 feature
parity**. A feature is not "done" until it is ✅ on both clients. Web may be a
superset (features Android lacks are allowed), never a subset.

Update this file whenever a feature changes on either client.

Last full audit: 2026-08-10 (Android v1.7.0).

Legend: ✅ full parity · 🟡 partial / different behavior · ❌ missing · ➕ web-only (allowed superset)

## Shell & Auth

| Feature | Android | Web | Notes |
|---|---|---|---|
| Clerk email-code + Google SSO sign-in | ✅ | ✅ | |
| Sign-out / account UI | ✅ Settings → Account | ✅ Settings → Account + `UserButton` | Android gained sign-out in 1.7.0 |
| Theme: dark / light / system | ✅ Settings → Appearance | ✅ Settings → Appearance + top-bar toggle | Android was dark-only until 1.7.0 |
| Tab/nav: Chat · Bible · Notes | ✅ bottom tab bar | ✅ bottom tab bar on mobile (`MobileBottomNav`, 1:1 port); top-bar tabs on desktop | Web bottom nav ported 1:1 from `mobile/app/(app)/_layout.tsx` 2026-08-11 |
| Link to Android APK for install | n/a | ✅ | Stable Drive link in `src/lib/constants.ts` |

## Settings

| Feature | Android | Web | Notes |
|---|---|---|---|
| Settings screen + gear entry point | ✅ `⚙` in chat header → `/settings` (push-only) | ✅ gear in chat top bar → `/settings` | Added 2026-08-10 |
| Appearance: System / Dark / Light | ✅ persisted (AsyncStorage) | ✅ persisted (next-themes) | |
| Default Bible translation (KJV/NKJV) | ✅ shared with reader chips + chat attach fallback | ✅ shared with reader chips + chat attach fallback | AI answers quote the selected translation (sent as `translation` in the `/api/ask-question` body); note AI stays KJV |
| Sign out | ✅ confirm dialog → `signOut()` | ✅ button → Clerk `signOut` | |
| About (version, KJV mission note) | ✅ | ✅ | |

## Chat

| Feature | Android | Web | Notes |
|---|---|---|---|
| Streaming chat via `POST /api/ask-question` | ✅ | ✅ | Shared backend |
| Conversation list / switch / delete / clear-all | ✅ history modal | ✅ sidebar | Layout adaptation, OK |
| History restore from `metadata.parts` | ✅ | ✅ | |
| Tool activity labels while streaming | ✅ | ✅ | |
| Retrieved-verses card w/ match-strength badge | ✅ (>0.75 Strong / >0.6 Moderate / Broad) | ✅ | Thresholds aligned 2026-08-10 |
| Verse actions: Copy / Share / Save-to-note / Read-in-Bible | ✅ | ✅ | Share = Web Share/clipboard fallback |
| Tappable verse refs in chat → jump to reader | ✅ | ✅ popover + "Read in the Bible" link | Web shows KJV popover first; both deep-link to reader scroll+flash |
| Tavily web-results card | ✅ | ✅ | |
| Follow-up chips (max 2, `[FOLLOWUP]` parsing) | ✅ | ✅ | |
| Note-action receipt cards | ✅ | ✅ | |
| Save whole answer to notes (new note or append via picker) | ✅ | ✅ | Shared route `POST /api/notes/append`; added 2026-08-10 |
| Slash commands (`/new` `/clear` `/history` `/note` `/verse` `/search` `/web` `/memory`) | ✅ | ✅ | Added 2026-08-10 |
| Verse attachment pill (`?prompt=`, `?attachRef&attachText&attachTranslation=`) | ✅ | ✅ | Added 2026-08-10 |
| Welcome screen, 6 suggested questions | ✅ | ✅ | |

## Bible Reader

| Feature | Android | Web | Notes |
|---|---|---|---|
| Book picker (testament sections, genre groups) | ✅ | ✅ | Added 2026-08-10 |
| Chapter grid | ✅ | ✅ | |
| Reading screen (KJV bundled, per-book JSON) | ✅ | ✅ | Same data bundle as `mobile/src/features/bible/data/` |
| NKJV translation toggle (bolls.life) | ✅ | ✅ | |
| Offline verse search + reference quick-jump | ✅ | ✅ | |
| Verse actions (Copy / Share / Save to note / Ask AI) | ✅ long-press sheet | ✅ click/⌥ | Web uses click instead of long-press |
| "✦ Ask AI" whole-chapter attach | ✅ | ✅ | |
| Prev/Next chapter (rolls across books) | ✅ | ✅ | |
| Font-size controls (4 steps) | ✅ | ✅ | |
| Deep links (`/bible/chapter?book=N&chapter=M&verse=V`) | ✅ | ✅ | |

## Notes

| Feature | Android | Web | Notes |
|---|---|---|---|
| Rich-text editor (Tiptap), autosave 1.5s | ✅ TenTap | ✅ Tiptap v3 | |
| Folders / colored tags / pin / search / sort | ✅ | ✅ | |
| Per-note AI panel (`/api/note-ai`), append-to-note | ✅ | ✅ | |
| Note AI history persist + clear | ✅ | ✅ | |
| Note slash commands (`/suggest` `/verse` `/clear`) | ✅ | 🟡 | Web panel has Suggest-Verses button; slash commands pending |
| Note created from chat `addToNote` tool | ✅ | ✅ | Shared backend |

## How to add a feature (the parity workflow)

1. Ship it on Android first (`mobile/`), bump `mobile/app.json` version + `mobile/CHANGELOG.md`.
2. Port it to web in the same release cycle — same endpoints, same behavior; adapt only layout idioms.
3. Update this file's tables; both cells must be ✅ before the release is done.
4. Verify web with `pnpm lint` / `pnpm build`; Android with `cd mobile && npm run typecheck && npm test`.
