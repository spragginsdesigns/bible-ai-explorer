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

---

## Listen - the spoken devotional

*Shipped 2026-08-26 · Android 1.28.0 + web*

The same day, read aloud. A "Listen" card sits under the verse on both Daily
Cross surfaces: one tap turns today's cross into a 2-6 minute spoken
devotional the user can play on a commute, with a scrubber, elapsed/total
times and an expandable **Read along** transcript.

### What gets said

`generateDevotionalScript()` in `src/lib/daily-cross-audio.ts` runs one
structured `generateText` call on the user's **utility-tier** model, under the
same `PERSONA` as the day itself (imported from `src/lib/daily-cross.ts` - the
voice you read and the voice you hear are one believer, not two). The prompt
carries the stored day (`reason`, `whyToday`, `application`, `studyPath`,
`question`), the same `loadStudyContext()` evidence the day was built from,
the verses three either side of the day's verse, and up to five ranked
cross-references (`src/lib/bible/crossRefs.ts`) - all with exact KJV wording
read from the bundled corpus, never from the model.

The script greets them, reads the verse in full, says why it was set before
them today, opens the passage up, walks the study path, prays, and ends on the
carry-through question. Length is the model's call between **250 and 900
words**, chosen by how much *real* context exists - the same honesty rule as
`whyToday`: a thin day gets a short devotional rather than a padded one.

Because it is spoken, the model is told to write numerals and references the
way they are *said* ("First Corinthians thirteen, verse four"), and
`sanitizeDevotionalScript()` (`src/lib/daily-cross-audio-script.ts`) strips
anything a narrator would otherwise read out loud - markdown headings,
emphasis, bullets, block quotes and stage directions like `[pause]` - then
trims at a paragraph boundary under ElevenLabs' 10,000-character request cap.

### Narration and storage

`synthesizeSpeech()` POSTs the script to
`https://api.elevenlabs.io/v1/text-to-speech/{voice_id}` with `model_id:
eleven_multilingual_v2` (the stability-first long-form model) and
`output_format=mp3_44100_128`, using plain `fetch` - one endpoint does not
earn an SDK dependency. The MP3 goes to **private** Vercel Blob at
`daily-cross-audio/<userId>/<verseOfDayId>.mp3`, the same access model as chat
attachments, and clients are handed a freshly signed URL on every read rather
than a stored link that would outlive its own expiry. That signature is good
for **24 hours** (`createAttachmentPreviewUrl` grew an optional
`expiresInSeconds`; the 15-minute default other callers use is unchanged):
a devotional is several minutes of audio someone may pause and come back to,
and a URL that dies under them mid-listen is a broken feature, not a security
posture. If playback does fail on a URL a client has been holding for more
than ten minutes, both cards silently re-fetch **once** and resume at the same
position before showing anything went wrong.

`VerseOfDay` gained `audioUrl`, `audioPathname`, `audioScript`, `audioTitle`,
`audioDurationSec`, `audioStatus` and `audioGeneratedAt` (migration
`20260826120000_daily_cross_audio`, all nullable). Replacing the day with
"↻ A different word for today" deletes the old blob best-effort - the new row
carries no audio, so the old narration is unreachable anyway.

### API

`GET /api/verse-of-day/audio` reports state without doing work (what a client
polls every 3s while preparing). `POST` prepares it or returns what is already
prepared. Both answer:

```
{ status: "unavailable" | "none" | "pending" | "ready" | "failed",
  url, title, script, durationSec, generatedAt }
```

`"unavailable"` means the deployment has no `ELEVENLABS_API_KEY`. It is
returned before any database or model work - the answer is the same for every
user - and **both clients render nothing at all for it**, timeline stop
included. An unconfigured server therefore shows no Listen card rather than a
button that can only ever fail. This is what production serves until the key
is added.

A `pending` row younger than three minutes is returned as-is, so two clients
tapping play at once never pay for two narrations; older than that, the
generation is assumed dead and starts again. `durationSec` is estimated from
the word count at 150 wpm - every client replaces it with the file's real
duration once the audio loads.

### Cost - why it is never pre-generated

The morning cron deliberately does **not** make audio. ElevenLabs bills per
character, a devotional is ~3,000-5,500 characters, and most users never tap
play; generating for every user every morning would bill the whole table for
a feature a fraction of it uses. Audio is made on the first tap and reused for
the rest of that day.

### Environment

| Variable | Required | Meaning |
|---|---|---|
| `ELEVENLABS_API_KEY` | yes | Without it the routes answer `status: "unavailable"` and both clients hide the feature entirely. `synthesizeSpeech` still throws `ELEVENLABS_API_KEY is not set` if it is ever reached, so the failure is never a silent no-op |
| `ELEVENLABS_VOICE_ID` | no | Overrides the default voice without a deploy. Default `JBFqnCBsd6RMkjVDRZzb` ("George", ElevenLabs' own default library voice used in their quickstart) - warm, unhurried, mature male narration |

### Surfaces

- Android: `mobile/src/features/cross/ListenCard.tsx` via `expo-audio`
  (**a native module - needs `expo prebuild` + a new build to reach a device**)
- Web: `src/components/cross/ListenCard.tsx`, an `<audio>` element with custom
  play/pause, a range scrubber and the transcript expander
- Shared, tested state rules: `src/components/cross/listen.ts` +
  `mobile/src/features/cross/listen.ts`
- The card owns its own timeline stop (`TimelineStop`, now its own module on
  both clients) - a card that can decide to render nothing has to own the node
  and label above it, or an empty ♪ would hang on the rail
- macOS/iOS: not yet

---

## An app-aware assistant, and changing today's cross from chat

*Shipped 2026-08-17 · Android 1.15.0 + web + macOS 1.2.0*

Two halves of one idea: the assistant should know the app it lives in, and it
should be able to act on the one part of that app that is about *today* — the
user's "Pick Up Your Cross".

### Half one — `appKnowledge`

`src/utils/systemPrompt.ts` carries a block describing SureWord itself: the
three clients, what lives on each screen, the slash commands, the settings, how
Pick Up Your Cross is built, and what memory is. It is written from
[`PARITY.md`](PARITY.md), which is the inventory, and it ends with the rule that
matters most: **never invent a feature, screen or setting**; say you are not
sure instead.

Two deliberate details:

- It is **not** run through `forTranslation`. That helper swaps every "KJV" for
  the user's chosen translation, and this block talks *about* the translation
  setting — swapping inside it produces nonsense ("New King James by default,
  New King James selectable in Settings").
- The per-note AI panel gets it too (`noteAISystemPrompt`), so a question asked
  from a note is answered by an assistant that knows the same app.

### Half two — `getDailyCross` / `setDailyCross`

Both live in the shared tool set (`src/lib/ai-tools.ts`), so chat and the note
panel have them. `getDailyCross` reads today's day, preparing one if the user
has none yet — the same behaviour as opening the screen. `setDailyCross`
replaces it, optionally centred on a `focus` in the user's own words or pinned
to a verse they named.

**Confirmation is a prompt rule, not a UI gate.** `dailyCrossGuidance` requires
the assistant to name what would be replaced and wait for a clear yes before
calling `setDailyCross`; a wish ("I wish today's verse spoke to my anxiety") is
explicitly not a yes. This was chosen over an interactive Yes/No tool card
because the conversational form behaves identically on all three clients today
and needs no human-in-the-loop tool-result plumbing in Swift, TypeScript and
React at once. What keeps it safe is that the act is small and recoverable: the
displaced row stays in `VerseOfDay` as history, and because the generator
excludes the last 30 picks, a replacement never hands back the verse it just
replaced.

### The shared write path

`POST /api/verse-of-day/today` — body `{ focus?, book?, chapter?, verse? }` —
is the single way today's day gets replaced, used by both the tool and the ↻
control on every client. It calls `replaceDailyCross()`
(`src/lib/daily-cross.ts`), which generates, stores, and reports the reference
it displaced. Storing simply appends the newest row inside the 20h reuse
window, so every client's next `findTodayCross` sees the new day with no
invalidation protocol.

`generateDailyCross(userId, request)` grew two paths:

- **Chosen** (unchanged): the model picks the verse, with the exclusion list in
  the prompt.
- **Pinned**: the reference is resolved and validated *before* the try block, so
  "make today Psalm 151:1" comes back as a `DailyCrossReferenceError` → 400 and
  a correction, instead of being swallowed by the fallback. The model then fills
  only the prose (`pinnedCrossSchema` omits book/chapter/verse), the exclusion
  list is dropped — it exists to stop repeats, not to argue with a user's own
  choice — and a generation failure degrades to a plain day *on that verse*
  rather than to John 3:16.

### Surfaces

- Receipt card after a replace, opening the new day: `src/components/ChatMessage.tsx`,
  `mobile/src/features/chat/CrossActionCard.tsx`,
  `CrossActionCard` in `macos/SureWord/Chat/Views/ChatCards.swift`. Only the
  write earns a card; `getDailyCross` is silent.
- "↻ A different word for today" at the end of the timeline on all three Daily
  Cross screens: confirm, optionally type a focus, and the day is prepared again
  in place.
- **macOS needs one extra wire.** Android and web rebuild (and refetch) their
  Daily Cross screen on every visit, so a replace made from chat is picked up
  for free. `DailyCrossModel` deliberately outlives the sidebar, so it would go
  on showing the word that was just replaced — `ChatView` fires
  `onCrossReplaced` when a `crossActions` receipt lands, and `MainWindow` drops
  the cached day.

---

## The opening questions

*Shipped 2026-08-17 · Android 1.16.0 + web + macOS 1.3.0*

The six chips on the empty chat screen used to be a constant (`commonQuestions`)
— the same six for every user, forever. They are now drawn from that user's own
walk, so the app opens with their real next questions already sitting there.

### `src/lib/study-context.ts` — one reading of a user

Extracted from `daily-cross.ts`, which had this logic inline, and now shared by
both features: chapters read in the last 30 days (most-read first), the user's
last 15 questions, 10 notes, their memories, and the recently sent daily verses.
The extraction was deliberate rather than incidental — **both features are only
honest if they look at the same evidence.** Two different notions of "recent"
would let the chips claim a study today's verse knows nothing about. The daily
cross's prompt text is unchanged byte-for-byte.

`isEmpty` reports a brand-new account (no reading, no questions, no notes, no
memories). Daily picks deliberately do not count toward it — the cron writes
those whether or not the user ever opened the app.

### `src/lib/suggested-questions.ts`

One utility-model call over that context plus today's Pick Up Your Cross (read
with `findTodayCross`, **never generated** — the welcome screen must not trigger
a day as a side effect). Rules that matter, in the prompt's own priority order:

1. **The user is the one asking.** The chip is sent word-for-word as their
   message the moment they tap it, so it has to read the way they would type it
   — "Why does God answer Job with questions instead of answers?", never "You
   noted Job's silence — why does God answer with questions?". A chip that reads
   like the app talking is wrong even when its subject is right.
2. Grounded strictly in the given context — the daily cross's honesty rule.
3. Spread across the six: the passage they are living in, a doctrine their
   questions circle, something following today's verse, an application question,
   a next step in their reading.
4. Never re-ask something already in their history.
5. One sentence, under 110 characters (two lines on a phone chip).
6. **Every question carries a label** - the small gold caption above it, saying
   where the question came from. A Scripture reference when the question is
   anchored to one passage ("James 3:5-6"); otherwise exactly one kind out of
   `SUGGESTED_QUESTION_KINDS`: `MEMORY`, `YOUR NOTES`, `TODAY'S VERSE`, `APPLY`,
   `NEXT CHAPTER`, `DOCTRINE`. A reference always beats a kind.

`sanitize()` trims, strips wrapping quotes, drops anything overlong, dedupes
case-insensitively, labels each survivor, and **tops up from the static six**,
so a model that returns four good questions still fills the grid. Every failure
path - no credentials, bad output, an empty account - returns the static six
with `personalized: false`.

`sanitizeLabel()` will not let an invented label through: a label is kept only
if it matches a kind exactly (case, curly apostrophes and stray punctuation
forgiven) or parses whole as a reference, which is then normalized to one
display form ("james 3:5-6" → "James 3:5-6"). Anything else falls back to a
reference lifted out of the question text, and to `null` when there is none -
an empty gold slot is honest, a guessed one is not.

The API returns `{ questions: string[], items: { question, label }[],
personalized }`, and the redundancy is deliberate. Every client already
installed - Android 1.26 and earlier, the shipped macOS DMG - reads
`questions: string[]` and **filters out anything that is not a string**, so
turning that key into objects would have dropped every existing install back to
the static six without a single error. `questions` therefore stays exactly what
it was; the labels ride alongside in `items`, same questions, same order.
Clients prefer `items` and fall back to `questions` when talking to a deploy
that predates labels (`parseSuggestedQuestionsResponse`).

`SuggestedQuestionSet.questions` stores the labelled array as JSON (no schema
change - the column was already a JSON string). Rows written before labels
existed are plain strings; `findTodaySet` maps those through the same fallback,
so a set stored earlier today keeps serving with references where the text
supplies one.

### Caching: in memory, per session, per account, never persisted

`GET /api/suggested-questions` is uncached server-side; each client generates
once per session and holds the result in memory. Deliberately *not* in
localStorage / AsyncStorage / UserDefaults: **these questions quote the user's
own study**, and a shared browser or a sign-out must not hand them to the next
account. The web and Android caches are keyed by Clerk user id for that reason;
macOS gets it for free, since `AppModel` (which owns `SuggestedQuestionsModel`)
is rebuilt on every sign-in.

Only a success settles the cache, so a failed attempt retries the next time the
welcome screen appears rather than pinning the static six for the session.

### Surfaces

`src/components/useSuggestedQuestions.ts` ↔
`mobile/src/features/chat/useSuggestedQuestions.ts` ↔
`macos/SureWord/Chat/SuggestedQuestions.swift` — same state machine. Each
welcome screen shows six chip-shaped shimmer placeholders while the set is
prepared (the language of the Daily Cross skeleton), then fills them in. Because
a tap **sends immediately** on every client, the chips must never swap under a
reading finger — which is why there is a loading state at all rather than
showing the static six and replacing them a second later.
