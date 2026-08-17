# Feature Deep-Dives

Architecture notes for SureWord features that span the shared backend and both
clients. The complete feature inventory and per-client status lives in
[`PARITY.md`](PARITY.md); this file explains **how** the non-obvious ones work
so they can be maintained without re-deriving the design.

---

## Tap-a-verse

*Shipped 2026-08-16 · Android 1.13.0 + web (`23df5d9`) · macOS 1.1.0 (2026-08-17)*

Tapping a verse in the Bible reader opens the verse sheet and immediately
streams a short AI explanation of that verse — what it says in its immediate
context and why it matters — behind a softly glowing skeleton. The sheet keeps
Copy / Share / Save to note, and **✦ Expand with AI** hands the verse to chat
exactly like the old "Ask AI about this verse" action (same `attachRef` /
`attachText` / `attachTranslation` params).

### Backend — `POST /api/verse-insight`

`src/app/api/verse-insight/route.ts`. Body:
`{ reference, text, translation?, modelId? }` (reference ≤ 120 chars, text
≤ 2500). Response is a **plain-text stream**
(`createTextStreamResponse` + `toTextStream` from `ai`), not a UIMessage
stream — the client just appends chunks.

Deliberate properties, in rough order of importance:

- **The user's universal model pick applies.** Clients send their stored model
  id (`getSettings().chatModelId` on Android, `readModelPref()` on web) and the
  route resolves it through `resolveModel()` (`src/lib/ai/provider.ts`), so
  request pick → account default → app default, with the usual BYOK credential
  checks. A missing provider key returns the standard 403 with the
  "add your key in Settings → AI Providers" message, which the sheet renders
  in place of the explanation (the other verse actions keep working).
- **Reasoning effort is pinned `low`** regardless of the user's chat effort
  default. A tap in the reader must answer in seconds; the model choice is the
  user's, the latency budget is ours.
- **Nothing persists.** No conversation rows, no memory extraction, and —
  unlike `ask-question` — the model used is **not** recorded as the account
  default. A passive tap is not a pick.
- **Prompt** is `verseInsightSystemPrompt(translation)` in
  `src/utils/systemPrompt.ts`: the full canonical SureWord persona plus a task
  addendum (2–4 plain sentences, no headings/lists/`[FOLLOWUP]` lines, never
  restate the verse). Translation-swapped through the same `forTranslation`
  helper as chat, so NKJV readers get NKJV-consistent wording.

### Clients (mirrored hooks)

`mobile/src/features/bible/useVerseInsight.ts` ↔
`src/components/bible/useVerseInsight.ts` — same state machine on both:
`idle → loading → streaming → done | error`.

- **Session cache** keyed `translation:reference` — re-tapping a verse renders
  instantly and never re-bills the model. Partial output is never cached.
- **Run-id guard + AbortController** — only the latest `start()`/`reset()` may
  touch state, so a slow stream for verse A can never bleed into an open sheet
  for verse B; closing the sheet aborts the request.
- **Transport**: Android reads the stream through the `expo/fetch`-backed
  `makeAuthedFetch` (RN's built-in fetch cannot stream); web uses same-origin
  fetch with the Clerk session cookie.

UI: `mobile/src/features/bible/VerseInsightSection.tsx` (Animated glowing
skeleton bars, streamed text with caret, error + retry) inside the existing
`BottomSheet` in `mobile/app/(app)/bible/chapter.tsx`; the web panel in
`src/components/bible/ChapterReader.tsx` uses `animate-pulse` amber bars with
`glow-amber-sm`. On Android both tap and long-press open the same sheet.

The macOS port (`macos/SureWord/Bible/VerseInsight.swift` +
`Views/VerseInsightView.swift`) keeps the same state machine and cache, and
puts the explanation in a **panel pinned under the reader** instead of inline
in the verse list. That placement is load-bearing, not cosmetic: streaming text
into a row of the reader's `LazyVStack` made SwiftUI re-measure every verse in
the chapter on every update, which pegged the main thread hard enough that the
`URLSession` byte stream feeding it never got scheduled again — the explanation
simply never arrived. Two related rules the Swift side has to keep: the byte
loop runs **off** the main actor (a `Task` started from a `@MainActor` method
inherits that isolation), and the skeleton bars carry **definite widths** — a
shape has no intrinsic size, so a greedy one pulsing forever inside a scroll
view keeps re-proposing its width.

### Extending it

- macOS parity: port the two-hook pattern; the route needs nothing new.
- If explanations ever need tools/memories, resist doing it here — that is
  what Expand with AI is for. This endpoint's contract is "fast, cheap,
  stateless".

---

## Pick Up Your Cross

*Shipped 2026-08-17 · Android 1.14.0 + web + macOS 1.1.0*

The personalized daily walk (Luke 9:23 — *"take up his cross daily"*; the
name carries its own proof-text; short UI label "Daily Cross"). A morning
notification opens a guided day built around one verse chosen for the user:
the verse → why it was chosen **today, for them** → personal application →
a 1–3 passage study path with a focus line each → one question to carry →
"Go deeper in chat".

### Persona and honesty guardrails (non-negotiable)

- The AI is **never** framed as the Holy Spirit or Spirit-adjacent. The frame
  is: SureWord is the companion that keeps putting the right Scripture in
  front of you; the Spirit works through the Word.
- `whyToday` may only cite activity actually present in the assembled context
  (chapters read, questions asked, notes written). When the context is thin,
  the model is instructed to encourage plainly and say less — fabricated
  intimacy is treated as worse than a generic word. Both rules live in the
  generator's instructions in `src/lib/daily-cross.ts`.

### The context engine

`generateDailyCross(userId)` in `src/lib/daily-cross.ts` assembles: reading
events from the last 30 days (recorded by both readers after ~5s of a chapter
being on screen → `POST /api/reading-events`, deduped hourly), the last 15
user chat messages, the last 10 notes, all saved memories, and the last 30
picks as an exclusion list. One structured `generateText` call on the user's
**utility-tier** model (cheap sibling of their provider) produces the full
day; every reference is validated against the KJV canon and the verse text is
read from the bundled corpus — the model never supplies Scripture wording.
Any failure degrades to a complete John 3:16 fallback day.

### One day per user per day

`VerseOfDay` rows store the whole guide (`whyToday`, `application`,
`studyPath` JSON, `question` — nullable for pre-guide rows). An entry younger
than 20 hours is "today" (`DAILY_CROSS_REUSE_MS`): the hourly cron
(`/api/cron/verse-of-day`, `CRON_SECRET`-gated, fires each user at their
chosen local hour) reuses an entry generated on demand, and
`GET /api/verse-of-day/today` reuses the cron's — whoever asks first
generates, everyone sees the same day.

### Delivery (Android)

Two paths in `mobile/src/features/notifications/useVerseOfDayNotifications.ts`:

1. **Remote Expo push** — carries the verse + reason in the notification.
   Requires an EAS projectId and FCM credentials, which the locally-prebuilt
   app does not have yet, so today this path fails token retrieval by design.
2. **Local daily scheduled notification** (the current live path) — when no
   push token can be obtained, the app schedules a repeating daily
   notification at the chosen hour ("✝ Pick up your cross — Your word for
   today is ready."). It cannot carry the verse; tapping opens `/cross`,
   which fetches or generates the day. If FCM lands later, the remote path
   registers and cancels the local schedule automatically — no doubles.

Tap routing: notification data `{screen: "cross"}` → `/cross`; legacy
payloads with only a verse reference fall back to the reader.

### Surfaces

- Android: `mobile/app/(app)/cross.tsx` (+ ✝ entry card on the Bible tab)
- Web: `src/app/cross/page.tsx` (+ ✝ entry card on `/bible`) — no browser
  push; the page is the parity surface
- macOS: `macos/SureWord/DailyCross/` — a sidebar section (⌘4) plus the ✝ card
  above the Bible book list. No push token is registered (APNs needs the paid
  Apple Developer Program), so the day is generated on demand at first open and
  a local `UNCalendarNotificationTrigger` fires the morning reminder; clicking
  it posts `.openDailyCross`, which selects the section.
- Settings: Android Settings → Verse of the Day (toggle + hour stepper);
  the same two controls on macOS
