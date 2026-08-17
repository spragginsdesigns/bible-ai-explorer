# Feature Deep-Dives

Architecture notes for SureWord features that span the shared backend and both
clients. The complete feature inventory and per-client status lives in
[`PARITY.md`](PARITY.md); this file explains **how** the non-obvious ones work
so they can be maintained without re-deriving the design.

---

## Tap-a-verse

*Shipped 2026-08-16 · Android 1.13.0 + web (`23df5d9`) · macOS pending*

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

### Extending it

- macOS parity: port the two-hook pattern; the route needs nothing new.
- If explanations ever need tools/memories, resist doing it here — that is
  what Expand with AI is for. This endpoint's contract is "fast, cheap,
  stateless".
