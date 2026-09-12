# Feature Deep-Dives

Architecture notes for SureWord features that span the shared backend and every
client. The complete feature inventory and per-client status lives in
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
- **Nothing about the user persists.** No conversation rows, no memory
  extraction, and — unlike `ask-question` — the model used is **not** recorded
  as the account default. A passive tap is not a pick.
- **Explanations are cached server-side and shared across accounts**
  (`src/lib/verse-insight-cache.ts`, Prisma `VerseInsight`, added 2026-09-02).
  The prompt carries only the verse — no memories, church or history — so one
  explanation is as right for the next reader as for the first, and a verse
  bills a model only the first time anyone in the world taps it. The route
  checks the cache before it resolves a model, so a hit never needs a key. Key:
  `(translation, reference, textHash, promptVersion)` — `textHash` is a sha256
  of the whitespace-normalised verse text the client sent, so altered text
  under a real reference cannot poison another reader's sheet;
  `VERSE_INSIGHT_PROMPT_VERSION` (`src/lib/verse-insight-key.ts`) must be
  bumped whenever `verseInsightSystemPrompt` changes so stale wording ages out.
  Only a naturally finished (`finishReason === "stop"`), non-empty answer is
  stored, written from `onEnd` after `result.consumeStream()` so closing the
  sheet mid-stream still fills the cache. A hit is a single `text/plain` body
  with `X-Verse-Insight-Cache: hit` (misses carry `miss`); clients read both
  through the same stream path. Rows are kept for good — the table caps at
  roughly 31k verses x 2 translations, a few MB. If the prompt ever takes user
  context, this cache must become per-user or be removed.
- **Prompt** is `verseInsightSystemPrompt(translation)` in
  `src/utils/systemPrompt.ts`: the full canonical SureWord persona plus a task
  addendum (2–4 plain sentences, no headings/lists/`[FOLLOWUP]` lines, never
  restate the verse). Translation-swapped through the same `forTranslation`
  helper as chat, so NKJV readers get NKJV-consistent wording.

### Clients (mirrored hooks)

`mobile/src/features/bible/useVerseInsight.ts` ↔
`src/components/bible/useVerseInsight.ts` — same state machine on both:
`idle → loading → streaming → done | error`.

- **Session cache** keyed `translation:reference` — re-tapping a verse in the
  same session renders without a request. Partial output is never cached. The
  server cache above covers everything else (other sessions, other users).
- **Android sheet scrolls** (1.45.0): `BottomSheet` gained a `scroll` mode
  (`mobile/src/features/notes/components/primitives.tsx`) that caps the sheet
  at 88% of the screen and scrolls the body under a pinned title. The verse
  sheet uses it because its content grows twice after opening (the streamed
  explanation, then the original-language words); before, a long verse plus
  Greek pushed Expand / Highlight / Copy / Share / Save off the bottom with no
  way to reach them.
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

The Apple port (`macos/Shared/Bible/VerseInsight.swift` +
`macos/Shared/Bible/VerseInsightView.swift`) keeps the same state machine and cache, and
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

- Apple clients use the shared Swift state machine above; the route needs no
  platform-specific behavior.
- If explanations ever need tools/memories, resist doing it here - that is
  what Expand with AI is for. This endpoint's contract is "fast, cheap,
  stateless".

### Original language (shipped 2026-09-02, Android 1.44.0 + web)

Under the explanation, the verse sheet shows the words behind the verse in
their original script: Westminster Leningrad Codex Hebrew for the Old
Testament, Scrivener 1894 Textus Receptus Greek for the New. Each word is a
chip; tapping one opens a card with the lemma, transliteration, Strong's
number and morphology code, the KJV gloss, and the Strong's definition.

- **Data stays on the server.** `src/data/originals/` is 18 MB, four times the
  KJV the Android app bundles, so two public routes serve it:
  `GET /api/bible/original?book=<1-66>&chapter=&verse=` (the verse, word by
  word, from `getOriginalVerse` in `src/lib/bible/originals.ts`) and
  `GET /api/bible/strongs?number=H430` (`lookupStrongsEntry`). Both validate
  input (400), answer 404 for a verse the original versification does not
  carry, and send `Cache-Control: public, max-age=86400, s-maxage=604800`.
  They are public-domain text with no user state, so `src/middleware.ts`
  exempts them from Clerk and the CDN can cache them.
- **Hebrew reads right to left.** The chip row flips direction for Hebrew
  (`dir="rtl"` on web, `row-reverse` on Android, `layoutDirection` on Apple)
  and cantillation marks (U+0591 to U+05AF) are stripped for display while
  vowel points are kept; the pure helpers live in
  `src/lib/bible/original-text.ts` and `mobile/src/features/bible/originalText.ts`.
- **System fonts, on purpose.** Atkinson Hyperlegible carries no Hebrew or
  Greek glyphs, so the original script is rendered with the platform's own
  fallback (Noto Sans Hebrew and Roboto on Android, system-ui on web) instead
  of the app font. Android uses React Native's bare `Text` for those glyphs,
  not `AppText`, which would force the app face.
- **Quiet failure.** A 404 or any transport error simply removes the section;
  the sheet is complete without it. 404s are cached per session, transport
  failures are not, so a reconnect still works. Strong's entries are cached
  for the sheet's lifetime because the lexicon never changes.

Files: `src/components/bible/OriginalLanguageSection.tsx` +
`useOriginalVerse.ts` (web), `mobile/src/features/bible/OriginalLanguageSection.tsx`
+ `useOriginalVerse.ts` (Android), `macos/Shared/Bible/OriginalLanguageView.swift`
+ `OriginalLanguage.swift` (macOS and iOS, shared).

---

## The house model

*Shipped 2026-09-02 · server + web + Android 1.44.0*

Before this, an account with no API key of its own, and not on the
`SERVER_CREDENTIAL_USER_IDS` allowlist, got "Add your OpenAI API key in
Settings" on every question. A first-time user could not get a single answer.

Now `resolveModel()` (`src/lib/ai/provider.ts`) decides an **access** for every
call, from the pure rule in `src/lib/ai/access.ts`:

- **`keys`**: the account owns at least one `ProviderCredential` row, or is
  allowlisted. Behaviour is unchanged: their keys, their picks, their stored
  defaults.
- **`house`**: everyone else. The call runs on the server's `OPENAI_API_KEY`
  with `HOUSE_MODEL_ID` (`openai/gpt-5.6-luna`, "GPT-5.6 Luna") at
  `HOUSE_EFFORT` (`medium`). Medium is a ceiling, not a floor: a call site
  that asks for `low` (tap-a-verse) keeps low, and nothing above medium is
  honoured no matter what the request says. Utility work (memory extraction,
  suggested questions, church profile, reading plans, memory summary) runs on
  the OpenAI utility model with the same key, so those features now work for
  keyless accounts too. A house answer is the server's choice, so
  `ask-question` never writes it to `User.defaultModelId` / `defaultEffort`.
  If the server has no `OPENAI_API_KEY`, the call throws
  `HouseModelUnavailableError`, which still classifies as
  `provider_key_missing` but says the server is unconfigured rather than
  telling the user to add a key.

`GET /api/ai/models` is what every picker renders from, and it now says which
world the account is in:

```
{ access: "house" | "keys",
  providers: [...only providers the account unlocked; [] in house mode],
  models:    [...only models it can run; exactly Luna in house mode],
  defaults:  { modelId, effort },          // house: Luna + "medium"
  house:     { modelId, label, effort, note } | null }
```

Locked providers are no longer returned at all, so no client shows a padlocked
"Add your API key" row; in keys mode `defaults.modelId` is the stored default
when its provider is available, else the first listed model, never an id the
picker did not list. In house mode the web picker (`src/components/ModelPicker.tsx`),
the Android sheet (`mobile/src/features/chat/ModelPickerSheet.tsx` +
`modelPickerRules.ts`) and the Apple popover/sheet (`ModelPickerRules` in
`macos/SureWord/Chat/Views/ModelPickerPopover.swift`) render one selected row,
the note "Included with SureWord. Add your own API key in Settings to choose
other models.", and an "Add an API key" link into Settings, and hide the
reasoning chips. Clients also pin their stored model/effort prefs to the house
values so the chip and the request agree.

The registry default (`DEFAULT_MODEL_ID`) moved from Terra to Luna at the same
time, and Luna and Sol joined the curated `MODELS` list ahead of Terra.

**Cost note.** House mode means SureWord pays for every keyless account's
questions. That is the product decision (2026-09-02); the allowlist still
exists only to let allowlisted accounts pick any model on server keys.

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

`generateDailyCross(userId)` in `src/lib/daily-cross.ts` now separates choosing
from writing. A bounded `ToolLoopAgent` in `src/lib/daily-cross-selector.ts`
runs on SureWord's built-in **GPT-5.6 Sol at xhigh reasoning** and must use both
read-only tools: personal-context search (individual reading events, organic
questions, labelled Daily Cross follow-ups, notes, memories, plan and church)
and hybrid KJV Scripture search. It returns a reference, stable theme key,
human theme, evidence ids/summaries, novelty rationale and confidence - not the
devotional prose.

Code then canonicalizes the book, reads the exact verse from the bundled KJV,
and enforces a rolling 30-day exact-verse exclusion plus a rolling three-day
primary-theme exclusion. An explicit focus bypasses the theme guard only; a
pinned verse is the user's choice and bypasses both. A rejected selection gets
one retry with the exact policy failure. GPT-5.6 Sol at high reasoning then
writes the guided day around the locked selection and bounded evidence. The
model never supplies Scripture wording and cannot change the selected verse.

If selection fails twice, a deterministic pool of more than 30 validated,
cross-testament KJV references chooses outside both windows. If the writer
fails, the validated selected verse is preserved with a plain local guide. The
old unconditional John 3:16 fallback is gone.

### Longitudinal context and provenance

Every new `VerseOfDay` row stores `primaryTheme`, a stable theme key/tags,
selection mode/reason/evidence, selector and writer model/effort, and explicit
fallback state. Legacy rows remain null rather than receiving invented labels.

"Go deeper in chat" carries the stored Daily Cross id on Android, web, macOS
and iOS. The next user message persists a server-validated
`metadata.origin = { surface: "daily-cross", verseOfDayId, reference,
action: "go-deeper" }`; organic questions have no origin. Context formatting
keeps follow-up study but labels it as continuation evidence, so studying the
day SureWord just gave someone does not masquerade as an unrelated new interest
and feed the same topic back tomorrow.

### One day per user per day

`VerseOfDay` rows store the whole guide plus the selection provenance above
(`whyToday`, `application`, `studyPath` JSON and `question` remain nullable for
pre-guide rows). An entry younger
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
- iOS: `macos/SureWord-iOS/Views/Cross/CrossView.swift` — a sheet over the tab
  shell plus the ✝ card on the Bible tab; its local reminder uses the same
  `.openDailyCross` notification path.
- Settings: Android Settings → Verse of the Day (toggle + hour stepper);
  the same two controls on macOS and iOS

---

## Listen - the spoken devotional

*First shipped 2026-08-26 · Android 1.28.0 + web; macOS 1.5.0 shipped and
exercised; iOS source/simulator path present, with device and distribution
verification kept separate*

The same day, read aloud. A "Listen" card sits under the verse on each Daily
Cross surface. The scheduled generator turns today's cross into a 2-6 minute
spoken devotional the user can play on a commute, with a scrubber, elapsed/total
times and an expandable **Read along** transcript. The card does not start
generation on a tap; tapping is only playback (or an explicit retry after a
failure).

### What gets said

`generateDevotionalScript()` in `src/lib/daily-cross-audio.ts` runs one
structured call on SureWord's built-in **GPT-5.6 Sol at high reasoning**, under the
same `PERSONA` as the day itself (imported from `src/lib/daily-cross.ts` - the
voice you read and the voice you hear are one believer, not two). The prompt
carries the stored day (`reason`, `whyToday`, `application`, `studyPath`,
`question`), the locked theme/reason/evidence the selector actually used,
the verses three either side of the day's verse, and up to five ranked
cross-references (`src/lib/bible/crossRefs.ts`) - all with exact KJV wording
read from the bundled corpus, never from the model.

The script is written to be *heard*, not read (rewritten 2026-09-11 after the
first version came out as an essay: "Hello." for an opening, no contractions,
every sentence the same length, and "this verse was set before you"). It opens
like a friend - by first name, matched to the part of their day - then gives
the reference before the verse, reads it in full, says in the first person why
it was chosen, opens the passage up, walks the study path, prays for them by
name, and ends on the carry-through question. The model is told to use
contractions, vary sentence length, and never announce a section. Length is
the model's call between **250 and 900 words**, chosen by how much *real*
context exists - the same honesty rule as `whyToday`: a thin day gets a short
devotional rather than a padded one.

Three inputs feed that opening (`loadListener` in `src/lib/daily-cross-audio.ts`):
the first name from `User.name`, fetched from Clerk and stored the first time
it is empty (the sign-in profile sync never ran for most accounts, so the
column was blank for nearly everyone); the part of day in the timezone of
their newest push token, since the day is written at their notify hour; and
the first two sentences of their last four devotionals, which the model is
told not to reuse, so the greeting is not the same every morning.

Because it is spoken, the model is told to write numerals and references the
way they are *said* ("First Corinthians thirteen, verse four"), and
`sanitizeDevotionalScript()` (`src/lib/daily-cross-audio-script.ts`) strips
anything a narrator would otherwise read out loud - markdown headings,
emphasis, bullets, block quotes and stage directions like `[pause]` - then
trims at a paragraph boundary under ElevenLabs' 10,000-character request cap.
At synthesis only, `withSpokenPauses()` turns every paragraph break into a
`<break time="0.9s" />` tag, because a blank line is not a reliable pause in
`eleven_multilingual_v2` and a break tag is; the stored script, which "Read
along" shows, never carries the tag.

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
than ten minutes, each card silently re-fetches **once** and resumes at the same
position before showing anything went wrong.

### Playback goes through our own origin, not the blob host

*Fixed 2026-08-26*

The signed blob URL is real, valid and useless to a media element.
**Chrome's media loader never loads a presigned private-blob URL**: on an
`<audio>` element it sits at `readyState: 0`, `networkState: 2`, with no
`error` event, forever - and opening the same URL in a tab does exactly the
same thing in Chrome's own player. `fetch` and `curl` of that URL both
succeed (200/206, `audio/mpeg`, `accept-ranges: bytes`,
`content-disposition: inline`), and a `blob:` URL built from the fetched bytes
plays instantly at the full 225 seconds. HEAD on it answers 403, because the
signature is bound to the method. So the MP3 is fine and the signature is
fine; Chrome's media loader and the private-blob host simply do not get along.

`GET|HEAD /api/verse-of-day/audio/stream` is the fix: same origin, ordinary
session auth, a real HEAD, and the caller's `Range` header forwarded to the
blob host and its `Content-Range` forwarded back, so seeking still works. The
upstream body is piped straight through - a several-megabyte MP3 never sits in
the function's memory. Whether the answer is `206` is decided by the
`Content-Range` the blob host actually sent, never by the range the client
asked for: a client can ask for `bytes=0-` and be handed the whole file with a
plain 200, and answering 206 to that is a lie a media player acts on
(`devotionalStreamResponseInit`, tested in `tests/daily-cross-audio.test.mjs`).

The audio payload therefore carries **both**: `url` (the signed blob URL,
still fine to `fetch`) and `streamUrl` (`/api/verse-of-day/audio/stream`,
relative). Nothing should hand `url` to a player. Web plays the proxy path
same-origin; Android joins it onto `API_URL` and passes the Clerk bearer token
through `AudioSource.headers`, minted fresh because a session token lives
about a minute and the player only proves it when it opens its connection - a
stall therefore earns one fresh token and a rebuilt player, resuming in place,
before anything is called a failure.

`VerseOfDay` gained `audioUrl`, `audioPathname`, `audioScript`, `audioTitle`,
`audioDurationSec`, `audioStatus` and `audioGeneratedAt` (migration
`20260826120000_daily_cross_audio`, all nullable). Replacing the day with
"↻ A different word for today" deletes the old blob best-effort - the new row
carries no audio, so the old narration is unreachable anyway.

### API

`GET /api/verse-of-day/audio` reports state without doing work (what a client
polls every 3s while scheduled generation is preparing). `POST` is reserved for
an explicit retry after a failed generation, or returns what is already
prepared. Both answer:

```
{ status: "unavailable" | "none" | "pending" | "ready" | "failed",
  url, streamUrl, title, script, durationSec, generatedAt }
```

`streamUrl` is what clients play; `url` is the signed blob URL and is only
safe to `fetch`. See "Playback goes through our own origin" above.

`"locked"` means the account is not on SureWord Pro; unlike "unavailable" the
clients **do** render for it - a benefit someone could have should be visible,
not hidden - and they never poll behind it, since the answer cannot change.

`"unavailable"` means the deployment has no `ELEVENLABS_API_KEY`. It is
returned before any database or model work - the answer is the same for every
user - and **every client renders nothing at all for it**, timeline stop
included. An unconfigured server therefore shows no Listen card rather than a
button that can only ever fail. This is what production serves until the key
is added.

A `pending` row younger than three minutes is returned as-is, so two clients
tapping play at once never pay for two narrations; older than that, the
generation is assumed dead and starts again. `durationSec` is estimated from
the word count at 150 wpm - every client replaces it with the file's real
duration once the audio loads.

### Made with the day, and gated behind Pro

*Changed 2026-08-26*

Audio is generated **once per day, alongside the cross itself** - not on a tap.
`scheduleDailyCrossAudio()` runs at every point a cross is stored: the
on-demand `GET /api/verse-of-day/today`, `replaceDailyCross()` (hooked inside
the lib, so the "a different word for today" control and the `setDailyCross`
chat tool both get it), and the morning cron. It marks nothing itself - it
defers to `getOrCreateDailyCrossAudio()` behind `waitUntil`, so the HTTP
response never waits on a ~30-60s narration. Opening Pick Up Your Cross now
finds the devotional ready, or watches it finish within a minute.

**The once-per-day guarantee is structural, not a flag.** Audio hangs off the
`VerseOfDay` row, and `getOrCreateDailyCrossAudio()` reuses a ready row and a
pending row under three minutes old - so the scheduled generation, a client
polling mid-flight, and the manual retry buy exactly one narration between
them. A replaced day is a new row, and gets exactly one more.

The cron narrates **after** the pushes are away, sequentially, capped at
`MAX_AUDIO_PER_RUN` (60) and bounded by `AUDIO_BUDGET_MS` (240s of the 300s
function). A slow narration must never cost someone their morning
notification, and whoever the budget skips is picked up the moment they open
the screen - the on-demand path schedules audio too.

What keeps the bill honest is no longer the tap, it is the tier: **Listen is a
SureWord Pro benefit.** `readDailyCrossAudio`, `getOrCreateDailyCrossAudio`,
`scheduleDailyCrossAudio` and the stream route all answer `"locked"` *before*
any database write, model call or ElevenLabs request, and the cron only
narrates for Pro accounts - so a free account costs nothing at all, and cannot
reach a narration by calling the routes directly either.

**Flagging a user as Pro**, either way works:

- `UPDATE "User" SET plan = 'pro' WHERE id = '<clerk_id>';` - what billing will
  write when it exists.
- Add the Clerk id to the `PRO_USER_IDS` env var (comma-separated, same
  convention as `SERVER_CREDENTIAL_USER_IDS`, and they share a parser). This is
  how comped accounts are flagged today, with no database write at all, and it
  **wins over the column** - that is the whole point of it.

Anything else in `plan` reads as free: a typo in that column must never hand
out a paid feature. The rules are pure and tested (`resolvePlan` in
`src/lib/entitlements-rules.ts`, split from the `server-only`
`src/lib/entitlements.ts` for exactly that reason).

### Playback speed

*Shipped 2026-08-26*

0.75x / 1x / 1.25x / 1.5x / 2x on a cycling chip beside the play button, on
every client. Persisted **on the account** since 2026-09-04: the rate lives in
`User.listenRate` and travels with the rest of the preferences document, so the
pace someone settled on during a commute is the pace the desktop plays at that
evening. Each client's own store (`localStorage` `sureword.listenRate` on web,
the settings store on Android, `SettingsStore` on Apple) is now a first-paint
cache of that value rather than the record of it. Web sets
`audio.playbackRate`; Android calls `player.setPlaybackRate(rate, "high")` with
`shouldCorrectPitch`, so 1.5x sounds like someone reading quickly rather than a
chipmunk. Elapsed and total stay in **real seconds** at every speed - the clock
reports the file, not the pace. A stored rate this build no longer offers
normalizes back to 1x rather than leaving the chip outside its own cycle.

### Playing with the screen off

A devotional is something you put on and then put the phone down, so Listen
behaves like a media app rather than like a sound effect: playback continues
with the screen off, and Android shows a real media notification and lock-screen
card - the SureWord mark, the devotional's title, `Pick Up Your Cross · <ref>`
beneath it, play/pause, skip back/forward and the system's own scrubber. Headset
and Bluetooth buttons work because it is a genuine media session, not a
notification with buttons drawn on it.

None of that needed a new library. `expo-audio` 57 already runs its Android
playback through an `androidx.media3.session.MediaSessionService`
(`expo.modules.audio.service.AudioControlsService`); it is simply off by
default. Turning it on takes **three** things, and missing any one of them looks
like a different bug:

1. `enableBackgroundPlayback: true` on the `expo-audio` config plugin in
   `mobile/app.json`. This is what adds `FOREGROUND_SERVICE` and
   `FOREGROUND_SERVICE_MEDIA_PLAYBACK` and declares the service, so it only
   reaches a device through a **prebuild and a new build**. `recordAudioAndroid`
   stays `false` - SureWord records nothing and must not ask for a microphone.
2. `setAudioModeAsync({ shouldPlayInBackground: true, interruptionMode: "doNotMix" })`.
   Without the first flag the native module pauses **every** player the moment
   the activity backgrounds, which is exactly what a screen timeout does - that
   was the original bug, and it looks like a crash rather than a setting. The
   second is not optional either: lock-screen controls hang off audio focus, and
   a player set to `mixWithOthers` never asks for any.
3. `player.setActiveForLockScreen(true, metadata, { showSeekBackward: true, showSeekForward: true })`
   once the source is loaded. This is what starts the foreground service; without
   it Android stops background audio after roughly three minutes anyway. Title
   changes afterwards go through `updateLockScreenMetadata`, which updates the
   session in place - calling `setActiveForLockScreen` again tears the media
   session down and rebuilds it.

Two limits worth knowing before someone files them as bugs. The skip buttons
jump **10 seconds**, not 15: the interval is a constant in expo-audio's service
and there is no option for it, so web matches Android rather than the other way
round. And the artwork is fetched by native code with a bare `java.net.URL` - no
bearer token, no bundled-asset resolution - so it is a public URL on the API host
(`/web-app-manifest-512x512.png`), and a failed fetch costs the picture, not the
playback.

Web needs none of this scaffolding: browsers already hand an `<audio>` element to
the OS media controls. What they do not do is label it, so the web card sets
`navigator.mediaSession.metadata` and registers `seekbackward` / `seekforward` /
`seekto` handlers, every call guarded for browsers without the API.

On Android and web, the card **unmounting** releases the player through
`useAudioPlayer`, so navigating away ends the listen. The Apple `ListenModel` is
owned by the shared `DailyCrossModel`, so macOS and iOS keep the player alive as
their Daily Cross surface changes. Backgrounding the app and locking the phone
are what keep playback going on each platform.

### Environment

| Variable | Required | Meaning |
|---|---|---|
| `ELEVENLABS_API_KEY` | yes | Without it the routes answer `status: "unavailable"` and every client hides the feature entirely. `synthesizeSpeech` still throws `ELEVENLABS_API_KEY is not set` if it is ever reached, so the failure is never a silent no-op |
| `ELEVENLABS_VOICE_ID` | no | Overrides the default voice per environment. Default `UgBBYS2sOqTuMpoF3BR0` ("Mark - Natural Conversations") - casual, natural American conversational delivery |
| `PRO_USER_IDS` | no | Comma-separated Clerk ids granted SureWord Pro without a `User.plan` write. Wins over the column. With neither set, every account is free and Listen renders the locked panel for everyone |

### Surfaces

- Android: `mobile/src/features/cross/ListenCard.tsx` via `expo-audio`
  (**a native module - needs `expo prebuild` + a new build to reach a device**,
  and the media-session manifest entries above make that mandatory again)
- Web: `src/components/cross/ListenCard.tsx`, an `<audio>` element with custom
  play/pause, a range scrubber and the transcript expander, plus the
  `navigator.mediaSession` description of what is playing
- Apple: `macos/Shared/DailyCross/ListenCard.swift` and
  `macos/Shared/DailyCross/ListenModel.swift`, mounted by
  `macos/SureWord/DailyCross/DailyCrossView.swift` and
  `macos/SureWord-iOS/Views/Cross/CrossView.swift`; macOS is shipped and
  exercised in 1.5.0, while iOS remains source/simulator-only
- Shared, tested state rules: `src/components/cross/listen.ts` +
  `mobile/src/features/cross/listen.ts` + `macos/Shared/DailyCross/Listen.swift`
- The card owns its own timeline stop (`TimelineStop`, now its own module on
  each client) - a card that can decide to render nothing has to own the node
  and label above it, or an empty ♪ would hang on the rail

---

## An app-aware assistant, and changing today's cross from chat

*Shipped 2026-08-17 · Android 1.15.0 + web + macOS 1.2.0*

Two halves of one idea: the assistant should know the app it lives in, and it
should be able to act on the one part of that app that is about *today* — the
user's "Pick Up Your Cross".

### Half one — `appKnowledge`

`src/utils/systemPrompt.ts` carries a block describing SureWord itself: the
four clients, what lives on each screen, the slash commands, the settings, how
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
because the conversational form behaves identically on all four clients today
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
  `CrossActionCard` in `macos/SureWord/Chat/Views/ChatCards.swift` and
  `macos/SureWord-iOS/Views/Chat/ChatCards.swift`. Only the write earns a card;
  `getDailyCross` is silent.
- "↻ A different word for today" at the end of the timeline on all four Daily
  Cross screens: confirm, optionally type a focus, and the day is prepared again
  in place.
- **Apple clients need one extra wire.** Android and web rebuild (and refetch)
  their Daily Cross screen on every visit, so a replace made from chat is picked
  up for free. `DailyCrossModel` deliberately outlives both Apple surfaces, so
  it would go on showing the word that was just replaced — macOS `ChatView` and
  iOS `ChatMessageList` fire `onCrossReplaced` when a `crossActions` receipt
  lands, and their shells invalidate the cached day.

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
`macos/Shared/Chat/SuggestedQuestions.swift` — same state machine. Each
welcome screen shows six chip-shaped shimmer placeholders while the set is
prepared (the language of the Daily Cross skeleton), then fills them in. Because
a tap **sends immediately** on every client, the chips must never swap under a
reading finger - which is why there is a loading state at all rather than
showing the static six and replacing them a second later.

---

## Reading plans

*Shipped 2026-08-26 · Android 1.29.0 + web, same release*

A user follows one plan at a time. The point of the feature is what they do
**not** have to do: nothing is ticked off by hand, because a day is finished
when the chapters of it have actually been read in the Bible reader.

### The four modules, and why they are four

| File | Owns | Pure? |
|---|---|---|
| `src/lib/reading-plan-presets.ts` | The KJV chapter table, the four presets, and validation of any plan | ✅ |
| `src/lib/reading-plan-progress.ts` | What "done", "today", "current day", "streak" and "percent" mean | ✅ |
| `src/lib/reading-plans.ts` | Storage, the AI plan writer, one-plan-at-a-time | server |
| `src/app/api/reading-plans/*` | Auth, request shapes, error codes | route |

The two pure modules carry no imports that survive to runtime (the one type
import is erased), which is what lets `tests/reading-plans.test.mjs` drive them
under plain `node --experimental-strip-types` - the same split
`daily-cross-audio-script.ts` has from `daily-cross-audio.ts`.

### The presets are generated, never typed

Four presets ship: **The Gospels in 30 days** (89 chapters), **Psalms &
Proverbs in 31 days** (150 psalms plus the proverb for the date), **New
Testament in 90 days** (260 chapters) and **The Whole Bible in a Year** (all
1,189). Every one is arithmetic over `KJV_BOOK_CHAPTERS`: a hand-typed list of
365 rows of chapter ranges is wrong somewhere by construction.

`splitEvenly` takes its boundaries from `floor(i * n / buckets)` rather than
handing the remainder to the first few days, so the four-chapter days are
spread through the year instead of stacked in January - the classic way a year
plan dies in February.

`KJV_BOOK_CHAPTERS` mirrors `src/data/books.json` (the bundle the reader itself
uses), held here rather than imported so the module stays loadable by the test
runner. The test asserts the two agree name-for-name and count-for-count, so
the copy cannot drift silently.

### Progress, and why nothing is ticked

`computePlanProgress` folds three things together:

1. the plan's days,
2. `ReadingPlanCompletion` rows - days ticked **by hand**,
3. every `ReadingEvent` at or after the plan's `startDate`.

A day is done when it was ticked, **or** when every chapter of it appears in
the reading history. The reader already posts `POST /api/reading-events` after
about five seconds on a chapter (server-deduped within the hour), so a user who
reads their plan in SureWord never touches the plan screen at all. The by-hand
toggle exists only for reading done elsewhere, and the UI says so.

Three rules worth knowing:

- **`todayDay` is whole 24-hour buckets from `startDate`**, not local
  midnights. The server does not know the user's timezone, and the same trade
  is already made by `DAILY_CROSS_REUSE_MS`. Their day rolls over at the hour
  they started.
- **`currentDay` is the oldest unfinished day up to today**, so someone three
  days behind is handed the day they missed rather than watching it slide past.
  Caught up entirely, it is simply today.
- **A streak counts back from today, and today not being done does not break
  it** - the day is not over yet.

Finishing the last day flips the plan to `completed` on the next read, without
the user having to say so.

### The written plan

`POST /api/reading-plans { goal, days }` runs one structured utility-model call
(`Output.object`, the `PERSONA` from `daily-cross.ts`) grounded in
`loadStudyContext`. The model chooses passages; it does not get to invent them.
`sanitizeReadingPlanDays` checks every book against the canon and every chapter
against that book's real length, drops what fails, drops a day left with
nothing, and renumbers what survives - so a hallucinated Psalm 151 costs one
line and not the plan.

### One plan at a time

Enforced in `startPlan`, not by a constraint: starting a plan archives whatever
was running. Archived and completed plans stay in the table as history, which
is why a partial unique index would have had to encode the status rules too.

### The plan and the daily cross

`loadStudyContext` gained a `planBlock` naming today's plan reading, and
`daily-cross.ts` instructs that **the study path IS that reading** unless the
user pinned a verse or steered the day. Every client then shows a small
`FROM YOUR PLAN` tag on the matching study step, so the alignment is visible
rather than a coincidence the user has to notice.

### Surfaces

`mobile/app/(app)/bible/plan.tsx` ↔ `src/components/plan/ReadingPlanScreen.tsx`
(page at `src/app/bible/plan/page.tsx`), with the presentation rules mirrored in
`mobile/src/features/plan/planView.ts` ↔ `src/components/plan/planView.ts` and
the state machine in the two `useReadingPlan.ts` files. Every mutation answers
with the whole plan and fresh progress, so neither client ever has to guess what
a tick did to the streak.

### The chat tools

`getReadingPlan` (read-only), `startReadingPlan` and `markReadingPlanDay`.
`startReadingPlan` archives the plan the user is on, so it carries the same
ask-first rule as `setDailyCross` **and** a `confirmed` flag the model must set
to `true` - a wish is not a yes. `markReadingPlanDay` is only for reading done
outside SureWord; the prompt says so, because chapters read in the app already
count themselves.

---

## Exact-word search (`findVerses`)

*Shipped 2026-09-07 - web + shared backend*

`searchScripture` searches by meaning, which is the wrong instrument for "what
verse says be still and know" or "every verse with loveth". `findVerses` is the
other half: a Postgres full-text index over the whole KJV, one row per verse in
the `KjvVerse` table with a GENERATED `tsvector` column and a GIN index
(migration `20260907190000_kjv_verse_fulltext`, seeded by
`scripts/backfill-kjv-verses.mjs` from the same `src/data/kjv/*.json` the app
quotes from, so a match is byte-identical to the quotation). It costs no
embedding call and no model call, so it is instant and free.

**The dictionary is `simple`, not `english`.** Snowball's English stemmer was
built for modern prose and does not fold the KJV's archaic inflections
(loveth, lovest, believeth) onto their roots, so `english` would buy almost
nothing while destroying the ability to match a word the user typed exactly.
`simple` lowercases and stops there; `buildVerseTsQuery`
(`src/lib/bible/verse-fulltext.ts`) adds the recall back where it belongs, by
turning every bare word into a prefix match (`'lov':*`) and every `"quoted
phrase"` into an ordered phrase of exact lexemes (`'be' <-> 'still'`). It also
strips every character that is not a letter, digit, apostrophe or space, so a
`&` or `!` a user types is searched for, never executed as a tsquery operator.
Requiring all terms is tried first; if that finds nothing and the user typed
two or more bare words, the same terms are retried as "any of these" so a
partial recollection still ranks.

A query that is itself a bare reference ("John 3:16", "Psalm 23") is answered
with that passage rather than a word search, through the same helper
`getPassage` uses. Output is the `ScriptureSearchToolOutput` shape, so the
existing retrieved-verses card renders it unchanged. Every hit reports
`similarity: 1`, as `getPassage` does: these verses literally contain the
words, and `ts_rank_cd` is not a cosine, so feeding it to the match-strength
badge would only mislabel exact matches as broad ones. Rank still orders them.

`searchScripture` is unchanged: its keyword half still uses the in-process
IDF scan, because IDF weighting is what makes a long natural-language query
surface its rare words, and `ts_rank_cd` has no notion of rarity. The index is
for queries that already name the words.

---

## Original-language search (`searchOriginalLanguage`)

*Shipped 2026-09-07 - web + shared backend*

`getOriginalText` answers "what does this verse say in Hebrew". The question a
word study actually asks is the other direction: **where does this word
occur?** `searchOriginalLanguage` answers that one. Give it a Strong's number
(`H2617`), the word pasted in its own alphabet, or a transliteration
(`hesed`, `agape`, `shalom`), optionally scoped to one book or one language,
and it returns the verses of the Westminster Leningrad Codex and Scrivener's
1894 Textus Receptus where the word occurs, each with the matching words
picked out and the user's translation alongside.

It is backed by the `OriginalVerse` table in Neon: one row per verse of the
original text, with a `strongs` `text[]` under a GIN index and a GENERATED
`tsvector` over a `plain` column (consonantal Hebrew, NFD-stripped lowercase
Greek). A Strong's search is an array overlap (`"strongs" && $1::text[]`); a
word search is `"search" @@ to_tsquery('simple', ...)`. A second `count(*)`
over the same predicate returns `total`, so the model can say "245 verses,
showing 20" instead of implying the page is the whole answer.

**The dictionary is `simple` here for the same reason it is for `findVerses`,
and prefix matching does more work.** Postgres has no Hebrew or Greek stemmer
at all, and both languages inflect far more heavily than English, so every
query word becomes a prefix lexeme: `αγαπ:*` reaches ἀγάπη, ἀγάπης and ἀγάπην
alike.

**Transliteration is the interesting half.** Strong's writes its
transliterations in a 19th-century phonetic notation nobody types: H2617 is
`chêçêd`, G26 is `agápē`, H430 is `ʼĕlôhîym`, H3068 is `Yᵉhôvâh`.
`normalizeTranslit` (`src/lib/bible/original-search.ts`) folds both the
dictionary's spelling and the user's onto one skeleton, and the rules are all
there is to it:

| Rule | Why |
|------|-----|
| NFD, lowercase, drop combining marks | Circumflexes and macrons are vowel length; nobody types them |
| `c` + cedilla -> `s` | Strong's writes samekh as `ç`; it is an /s/, and stripping the cedilla alone leaves the misleading "checed" |
| Superscripts `ᵉ ᵃ ᵒ ᵘ` -> their base letter | Shewa and the hatephs are real vowels a reader spells out; dropping them turns `Yᵉhôvâh` into "yhovah" |
| Drop everything not a-z | Removes the aleph and ayin marks (`ʼ ʻ`), spaces, punctuation, digits |
| `ch` -> `h` | Strong's spells both Hebrew chet and Greek chi `ch`, while readers write "hesed" as often as "chesed". Safe because the dictionary side is folded too |
| `iy` -> `i`, `ow` -> `o`, `uw` -> `u` | Mater lectionis: a vowel written with a consonant letter, so `ʼĕlôhîym` is "elohim" and `shâlôwm` is "shalom" |
| A four-entry alias table | "Jehovah", "Yahweh" and "YHWH" are not transliterations of `Yᵉhôvâh` at all, but they are what readers type |

Resolution then ranks **exact transliteration > transliteration prefix >
gloss word**, and only the best tier is actually searched: mixing an exact
transliteration with loose gloss matches would bury the word the user asked
about under every entry sharing one English rendering. The gloss tier is what
makes "lovingkindness" find H2617, and it needs one trick - Strong's writes
that rendering as `(loving-) kindness`, so each comma-separated segment of the
KJV column is indexed both as its bare words and as its letters-only squash.
Gloss keys go through the same fold as the query, or "charity" would index as
itself while a user's "charity" normalized to "harity" and never met it.

**The versification caveat is real and the prompt names it.** The Hebrew and
Greek carry their own verse numbering - a Psalm's title is verse 1 in the WLC -
so the table holds the original coordinates in `book/chapter/verse` and the
aligned KJV coordinates in `kjvBook/kjvChapter/kjvVerse`, which are null when
the alignment is unknown. An aligned hit reports its KJV reference and quotes
the user's translation. An unaligned hit reports its own reference with
`(WLC numbering)` or `(TR numbering)` appended, sets `kjvAligned: false`, and
shows the original text itself in place of a translation; the model is told to
say so plainly rather than pass it off as a KJV reference.

Output extends `ScriptureSearchToolOutput`, so the existing retrieved-verses
card renders it unchanged on every client, with `total`, `resolved` (the
Strong's entries actually searched) and `matches` (the matching words, with
lemma, transliteration and gloss) added for the model and for any client that
later wants to render a word-study card. Every hit reports `similarity: 1`,
for the same reason `findVerses` does. Activity label: **Searching the Hebrew
and Greek**.

---

## Timeline, People & Places

A KJV-grounded reference for **when** things happened and **who** and **where** -
so neither the user nor the model has to reach for the web to answer "who was
Melchizedek?" or "when did the exile begin?".

Reached from the **Timeline, People & Places** card on the Bible screen
(`/bible/timeline` on web; native Bible navigation elsewhere), and from the
chapter reader's people icon, which opens it
filtered to the chapter being read.

### What it holds

| | Count | File |
|---|---|---|
| Events, Creation to the writing of Revelation | 220 | `src/data/bible-atlas/events.json` |
| People | 186 | `src/data/bible-atlas/people.json` |
| Places | 93 | `src/data/bible-atlas/places.json` |
| Reviewed, typed relationships | 83 | `src/data/bible-atlas/relations.json` |

Events are divided into nine eras, in order: Creation & the Patriarchs, Egypt &
the Exodus, Conquest & Judges, United Kingdom, Divided Kingdom, Exile & Return,
Between the Testaments, Life of Christ, The Early Church. The "Between the
Testaments" era is deliberately thin - only what Scripture itself supports
(Daniel's prophecy of the kingdoms, and Malachi's last word before the silence).

### Explorer modes, journeys and relationships

The screen has three first-class modes: **Timeline**, **People** and **Places**.
Search remains global and groups matching people, places and events with counts;
the directory modes make entries browseable even when the reader does not know
which name to search. Era, query, journey and selected-detail state are carried
in route parameters so refresh, Back and shared links return to the same study.

Person entries show five anchor events and a **View journey** action that filters
the rail to every event the person appears in. Reviewed relationships carry a
type, certainty and exact supporting KJV references. Immediate family stays a
small, linear neighborhood rather than an unreadable whole-Bible canvas, and
**Trace connection** finds the shortest reviewed, cited path between two people.

### The dates are Ussher's, and are labelled as such

Every `yearLabel` follows the **traditional Ussher chronology** - the dating
printed in the margins of most KJV editions since the eighteenth century, and a
computation from the genealogies and reign lengths of Scripture rather than part
of the inspired text. Every timeline client carries the same footnote under the timeline
(`USSHER_NOTE`), every numeric label is marked "c.", and the system prompt tells the
model to say "traditionally dated" and never to present a date as though
Scripture gave it. Where Scripture gives no date at all, the label says so.
Each event view also carries structured provenance and a sortable signed year
range without removing the backward-compatible `yearLabel` used by older
clients and AI tools.

### Regenerating and validating the data

```bash
node scripts/build-bible-atlas.mjs
```

The script is the validator as well as the mirror. It **exits non-zero** on:

- a reference that does not resolve to a real KJV book, chapter and verse - it
  opens the bundled text and checks the verse numbers exist;
- a duplicate or non-kebab-case id;
- an event naming a person or place that does not exist, a dangling legacy
  `related` id, or a relation with an invalid endpoint, type, certainty or ref;
- events filed out of chronological order;
- **a person or place whose name (or one of its `alsoCalled` aliases) does not
  actually appear in any of the verses it cites.** This is the check that stops
  invented Scripture: it reads the verse text itself. It is also why aliases
  matter - the KJV writes `Elias` for Elijah, `Booz` for Boaz and `Esaias` for
  Isaiah, and the alias is what makes those references verifiable.

On success it copies the four JSON files to `mobile/src/data/bible-atlas/` and
`src/lib/bible/atlas-core.ts` to `mobile/src/features/atlas/atlasCore.ts`.
**Never hand-edit anything under `mobile/`** - edit the source and re-run.

Two suites re-check it from the outside: `tests/bible-atlas.test.mjs`
(`pnpm test:logic`) and `mobile/src/features/atlas/atlas.test.ts` (`npm test` in
`mobile/`). Both include a drift check that fails if the mirrored copies differ
from the source.

### One corpus, four clients

`src/lib/bible/atlas-core.ts` has **no imports at all**, and everything that
could drift lives in it: reference parsing, search ranking, era grouping and
entity resolution. The build script copies it verbatim to Android, so the two
TypeScript clients cannot disagree about what "Elias" matches or which events touch
Exodus 14.

- **Android reads the bundled JSON directly** (`mobile/src/features/atlas/atlas.ts`),
  so the screen works with no network, exactly like the Bible reader.
- **Web reads the same data over the API** (`src/components/atlas/useAtlas.ts`),
  so the browser never downloads the atlas.
- **macOS and iOS use the same authenticated API contract** through
  `macos/Shared/Atlas/AtlasModel.swift`, with platform-native explorer views.

### API

| Route | What it answers |
|---|---|
| `GET /api/bible/atlas?q=moses` | Ranked people, places and events |
| `GET /api/bible/atlas?id=moses` | One entity: description, aliases, key verses, related, events |
| `GET /api/bible/atlas?kind=person&era=&cursor=&limit=` | Stable People or Places directory page |
| `GET /api/bible/atlas?book=1&chapter=22` | Who and where a chapter is about, plus its events |
| `GET /api/bible/atlas/event?id=the-flood` | One fully resolved event |
| `GET /api/bible/atlas/connection?from=moses&to=aaron` | Shortest reviewed, cited person path |
| `GET /api/bible/atlas/timeline?era=&book=&chapter=&personId=` | Ordered events grouped by era, plus `allEras` |

All read-only over bundled data; auth is the same `getAuthUserId()` the sibling
Bible routes use.

### Chat tools

- **`lookupBibleEntity({ query })`** - best matches with what the Bible says about
  them, their key references, the names Scripture also calls them by, who they
  are connected to, the events they appear in, and (for the top match) how many
  verses of the whole KJV name them. That count comes from `findOccurrences`, an
  exact word-match scan of the bundled text - punctuation- and case-insensitive,
  so "Abimelech's" counts and "Beer-sheba" matches "Beersheba".
- **`getBibleTimeline({ era?, book?, chapter?, personId? })`** - ordered events for
  a filter, with their Ussher labels and references.

Both are read-only and need no permission. The system prompt tells the model to
**prefer them over `webSearch`** for every who/where/when question about the
Bible, and to say so plainly rather than guessing when the atlas has no entry.
The `/who <name>` slash command runs `lookupBibleEntity` on its argument.

---

## My church

*Shipped 2026-08-27 · Android 1.36.0 + web; macOS 1.5.0 shipped and exercised;
iOS source/simulator path present, with device and distribution verification kept
separate*

Settings → My church lets a user search for their home church by name or
city, pick it out of the results, and keep it on their account. The saved
profile renders as a card (photo or logo, address, phone, website, "Open in
Google Maps", mission statement, about), and the server hands it to the
assistant on every chat turn, so SureWord knows the congregation the user
belongs to without being told again. "Change church" reopens the search;
"Remove" clears it.

### The routes

| Route | What it does |
|---|---|
| `GET /api/church` | The saved church, or `null` |
| `GET /api/church/search?q=` | Ranked Google Places matches: `placeId`, `name`, `address`, `hasPhoto`. A query shorter than 3 characters is rejected with 400, so no client sends one |
| `PUT /api/church` | Saves `{ placeId }` and answers with the resolved profile. Slow on purpose: the server resolves the place, fetches the church's own website and extracts its mission statement with a model, so a save can run to roughly 20 seconds |
| `DELETE /api/church` | Clears it |
| `GET /api/church/photo?placeId=` | Same-origin proxy for a Places photo, so the Places key never reaches a client and the image has a stable URL. `photoUrl` on the profile is already absolute: either the church website's own logo or this proxy |

`ChurchProfile` is `{ placeId, name, address, phone, website, mapsUrl,
photoUrl, mission, about, missionSource, updatedAt }`, every optional field
nullable.

### Unavailable means invisible

`GOOGLE_PLACES_API_KEY` is required for this feature and nothing else. Without
it every route answers `{ status: "unavailable" }` and every client renders
**nothing at all** for the section, its heading included. That is the same rule
Listen follows without an ElevenLabs key: an unconfigured deploy shows no
half-working search box rather than a control that fails when tapped. The web
section also renders nothing while the first `GET` is in flight, so the heading
never flashes before disappearing.

### The prompt block

A saved church becomes a short block in the chat system prompt (name, address,
website, and the mission statement when one was found). It is context, not
instruction: it tells the assistant which congregation the user belongs to so
answers can speak to their setting. Scripture stays the final authority and the
block never softens the KJV persona.

### Surfaces

| Client | Where |
|---|---|
| Web | `src/components/settings/ChurchSection.tsx`, mounted in `src/app/settings/page.tsx` beside Memory; types and fetch helpers in `src/lib/church-client.ts` |
| Android | `mobile/src/features/church/ChurchSection.tsx` in Settings, same routes and contract |
| macOS | `macos/Shared/Church/ChurchView.swift`, mounted by `macos/SureWord/Settings/SettingsView.swift`; shipped in 1.5.0 and exercised on the live path |
| iOS | `macos/Shared/Church/ChurchView.swift`, mounted by `macos/SureWord-iOS/Views/Settings/SettingsView.swift`; source/simulator status only, with device/runtime/distribution still unverified |

Web behavior worth preserving, and mirrored on Android:

- Search is debounced 350ms and each keystroke aborts the in-flight request, so
  a slow answer for "grace" can never overwrite the results for "grace chapel".
- The input never calls the route below 3 characters; it says so instead.
- Enter picks the first result, which is marked `aria-selected` in the
  `role="listbox"` result list.
- While a save runs the list is disabled and the section says "Looking up your
  church and reading its website", because a 20-second silent wait reads as a
  broken button. A 404 answers "Couldn't load that church, try another result."
- The photo is a plain `<img>` (unknown hosts, so not `next/image`) in a 64px
  rounded square with `object-fit: cover`, falling back to a church glyph when
  `photoUrl` is null or the image fails to load.
- A long mission clamps to six lines behind "Show more" and carries a muted
  "From <hostname>" link to `missionSource`, so the user can see where the text
  was taken from.

## Note wikilinks, backlinks, and properties

*Shipped 2026-08-30 · Android 1.41.0 + web; macOS/iOS pending their next Mac
build cycle (tracked in `PARITY.md`)*

Notes link to each other the way Obsidian's do: typing `[[Note Title]]` in a
note body (or picking a note from the editor's insert-link button) creates a
link, and every note shows the links it makes plus the "Linked mentions" that
point back at it. Notes also carry metadata beyond tags: aliases (alternate
titles) and free-form properties - text, number, checkbox, or list values.

How it works, and the decisions that shaped it:

- **The server owns the link graph.** `src/lib/note-links.ts` parses
  `[[Target]]` / `[[Target|display]]` / `[[Target#heading]]` out of a note's
  `plainText` on every write path (create, PATCH, AI append, AI rewrite) and
  rebuilds that note's `NoteLink` rows. plainText is the one body field every
  client writes identically, which is why parsing does not touch the Tiptap
  JSON or HTML. Clients never compute backlinks - list rows do not even carry
  bodies.
- **Links are plain text in the body (v1).** No Tiptap/ProseMirror wikilink
  node on either client; the editor inserts the literal `[[Title]]` text and
  the graph lives in the info panel/sheet. This kept the feature out of the
  tentap webview's custom-build territory.
- **Unresolved links are first-class.** A link to a title that no note holds
  is stored with `targetNoteId = NULL` and rendered dimmed with a one-tap
  create affordance. Creating or renaming a note claims every pending link
  matching its title or aliases (`resolvePendingLinks`); deleting a target
  unresolves its links via the FK's ON DELETE SET NULL. Resolution is
  case-insensitive over title + aliases, and because titles are not unique,
  the most recently updated note wins a collision. A rename never steals or
  unresolves an already-resolved link.
- **Sync survives the 1.5s autosave race.** Two overlapping syncs of one note
  serialize on a per-note `pg_advisory_xact_lock` (transaction-scoped, so safe
  over Neon's pooled connection), then upsert `ON CONFLICT` and trim - the
  same idempotency discipline as `syncNoteEmbeddings`, for the same reason.
- **API**: `GET /api/notes/[id]/links` returns `{ outgoing, backlinks }` with
  snippets captured at parse time; `POST /api/notes` and `PATCH
  /api/notes/[id]` accept `aliases` and `properties`, validated and capped
  (`validateAliases` / `validateProperties`). `aliases` rides in the list
  summary so pickers and search can match on it; `properties` stays out of
  list payloads.
- **Android** (1.41.0): a link button beside the editor toolbar opens a picker
  sheet (cached-note search, "Link to:" row for new titles) inserting at the
  caret via tentap `injectJS` + `execCommand('insertText')` - the bundled
  webview exposes no tiptap global, so text enters the same way typing does
  and flows through the normal autosave. The top bar's info icon opens the
  properties + links sheet; opening it flushes the editor first so a
  just-typed link is present. The notes cache key bumped to
  `sureword.notes-cache.v2` because v1 rows lack the new fields.
- **Web**: same capabilities, web-native layout - a toolbar button with a
  popover picker, and a collapsible "Properties & links" drawer under the
  editor.
- **The AI knows the graph.** `toolGuidance` (chat + note panel) instructs the
  assistant to write cross-references in note content as `[[Exact Note Title]]`
  (pending links to not-yet-written notes included), and the note panel's
  system prompt carries the open note's outgoing links and backlinks
  (`describeNoteLinks` in `src/lib/note-links.ts`), so it can answer "what
  connects to this note" and extend the web of notes itself. Proven live
  2026-08-30: asked about connections, the assistant listed the injected links
  plus thematic matches from findNotes as wikilinks, then appended a
  `[[...]]` reference that synced and resolved to a real note.

## Run options: reasoning, speed, length, mode

The picker used to offer three reasoning levels and nothing else, which was
both too few (GPT-5.6 takes six, Kimi K3 defaults to a level we never sent) and
too blunt (nothing controlled answer length, the thing readers actually notice).
Four option rows now sit under the model list: **REASONING**, **SPEED**,
**LENGTH**, **MODE**.

**The vocabulary** lives in `src/lib/ai/models.ts`. Effort widened to the union
of every provider's levels, ordered `none minimal low medium high xhigh max`.
Speed is `standard | fast`, length (verbosity) `low | medium | high`, mode
`standard | pro`. Each has a type guard, and each is nullable on the wire:
null means the user expressed nothing, which is not the same as choosing the
default.

**Capabilities are derived, never assumed.** `deriveCapabilities(provider, id)`
answers what one head accepts from its provider and id alone, verified against
the installed SDK types and each vendor's model pages. GPT-5.6 takes `max`,
older 5.x stops at `xhigh`, gpt-4 and chatgpt heads take no effort at all.
Haiku and Sonnet 4.5 list none (Anthropic's SDK has no guard, so sending one is
a hard 400). Fast mode exists on GPT-5.x except nano and chat variants, on
Opus 5 and Opus 4.8, and on every OpenRouter head (where it is throughput
routing rather than a premium tier). Verbosity is a real parameter only on
OpenAI; everywhere else it travels as a sentence appended to the system prompt.
Pro mode is GPT-5.6 only. Curated price, context window, tagline and tier come
from a table keyed by model id, so they attach to live catalog rows too, and an
uncurated model simply has none.

**Nothing unsupported is ever sent.** `buildProviderOptions` gates every option
on the definition of the model actually being built before mapping it:
`reasoningEffort` / `textVerbosity` / `serviceTier` / `reasoningMode` for
OpenAI, `effort` / `speed` for Anthropic, `reasoningEffort` for Moonshot,
`reasoning.effort` / `provider.sort: "throughput"` for OpenRouter. It also
sends `reasoningSummary: null` on every OpenAI call: the SDK silently defaults
that to `"detailed"` whenever an effort is set, and no SureWord client renders
reasoning parts, so we were paying for summaries nobody saw.

**OpenRouter's chips are refreshed at request time.** Its per-model reasoning
levels and verbosity parameter exist only in its live `/models` response, so a
definition resolved from a stored id alone advertises neither. `resolveModel`
therefore looks the id up in `listProviderModels("openrouter", key)` after the
key is in hand and merges the live capabilities over the derived ones
(`overlayLiveDefinition`, pure and unit-tested). Without it, every OpenRouter
chip the picker rendered would be clamped away here and do nothing. The list is
cached five minutes per key and never throws, so a failed fetch simply leaves
the derived definition in place.

**The house stays out of it.** A keyless account has no picker, so the house
branch ignores speed, verbosity and mode outright. Fast mode alone roughly
doubles the bill, and that bill is SureWord's.

**Only chat opts in.** `resolveModel` takes the run options in a `run` bag, and
passing it at all is what enables the user's stored defaults for them. Chat is
the only caller that does, so tap-a-verse (whose cache key does not include
them) and background utility work are never reshaped by a chat preference.

**Persistence** mirrors the existing model/effort rule: the raw requested value
of each option, when valid and outside house mode, is written to
`User.defaultSpeed` / `defaultVerbosity` / `defaultMode` in the same
`waitUntil` block. The stored value survives switching to a model that cannot
honour it, because clamping happens at resolution rather than on write. The
options that actually shaped a turn, where they differed from the model's
ordinary behaviour, are recorded on the assistant message metadata beside
`modelId`.

**Auto is a choice, and effort is the one option a request can clear.** A body
carrying `"effort": null` means the user tapped **Auto**, so the stored default
must not fill it back in: the route sets `ignoreStoredEffort`, the pure
`resolveEffortPreference` in `src/lib/ai/models.ts` skips the stored value, and
the persistence block writes `defaultEffort: null`. A body with no `effort` key
at all is unchanged, still meaning "no opinion" (Apple omits nil rather than
sending null). Before this, choosing Auto after High quietly kept running High
for the rest of the account's life. Speed, length and mode need no equivalent,
because their clients send the explicit default value (`standard`, `medium`,
`standard`) when the default chip is tapped, and null there keeps meaning "no
opinion".

`GET /api/ai/models` carries `speeds`, `verbosities`, `modes`, `defaultEffort`,
`tagline`, `tier`, `contextWindow`, `pricing` and `fastModeNote` on every entry,
and `defaults` grew `speed`, `verbosity` and `mode`. The mechanism behind
verbosity is deliberately not sent: a client needs the values it may offer, not
how they are delivered. Every new field is optional on the client side, so a
build talking to an older server falls back to speeds `["standard"]`,
verbosities `[]`, modes `["standard"]` and nulls.

## Account preferences

*Shipped 2026-09-04 · Android 1.49.0 + web; Apple compiled and iOS-simulator tested, Mac install pending*

Translation, parchment and the Listen rate used to never leave the device that
set them, and the model pick rode along with a chat request while Memory had its
own route. `GET/PATCH /api/preferences` is now the whole account document:
`plan` (read-only), `webSearchEnabled`, `memoryEnabled`, `translation`,
`parchment`, `listenRate`, and a `chat` bag of the raw stored `modelId`,
`effort`, `speed`, `verbosity` and `mode`. Validation is pure in
`src/lib/preferences-contract.ts` (`tests/preferences-contract.test.mjs`) and
runs before any write, so a body with one bad field writes nothing.

**The server is the record; every local store is a first-paint cache.** Clients
hydrate the whole document on sign-in and on every return to the foreground,
throttled to one fetch per 15 s, and a local `editSeq` discards a response that
landed after the user edited something. Each change writes locally, PATCHes only
the key that changed, and rolls back with a non-blocking notice if that fails.
Settings, notes and highlight caches carry the Clerk user id they belong to and
are discarded when a different user signs in, and on sign-out.

**Upgrading resets nobody, and stale caches overwrite nobody**: a first launch
after the upgrade reads the account first, then pushes up in one PATCH only the
local non-default values whose column the account has never written. An account
that already chose elsewhere always wins over whatever an old cache holds (on a
shared device that cache may not even be this user's). **Auto is null on
the wire** - the auto reasoning chip encodes as `chat.effort: null`, which
clears the stored default instead of filling it back in.

Device-only by decision: theme, reader font step, and the notification hour and
switch, which was already stored per push token and so already per device.

---

## Contracts for the 2026-09-12 plan (receipts, Learn a verse)

Published first so the three lanes in
[`product-changes-review-2026-09-12.html`](product-changes-review-2026-09-12.html)
build against one shape. The backend lane owns the server half of both; the
frontend lane renders receipts; the Windows/Learn lane builds the Learn screens.
Change a contract here before changing it in code.

### Receipts: one line for everything the assistant saves

Every **state-changing** tool leaves exactly one receipt on the assistant
message; **no read tool does** (reads keep the transient activity line). The
parsers (`src/components/useChat.ts`, `mobile/src/lib/chatView.ts`,
`macos/Shared/Chat/ChatViewMessage.swift`) derive receipts from persisted
`tool-*` parts, so history replays the same line. Clients render all receipts of
a turn as **one line** of tappable fragments joined by " · ", in the accent
colour, under the answer. The existing `noteActions` and `crossActions` stay on
the view model until every client renders receipts, then they are removed.

```ts
export type ChatReceiptKind =
	| "note" | "memory" | "highlight" | "plan" | "cross" | "preference" | "church";

export type ChatReceiptTarget =
	| { screen: "note"; noteId: string }
	| { screen: "memories"; memoryId?: string }
	| { screen: "chapter"; book: number; chapter: number; verse?: number; translation?: "KJV" | "NKJV" }
	| { screen: "plan" }
	| { screen: "cross" }
	| { screen: "settings"; section?: "memory" | "church" | "preferences" };

export interface ChatReceipt {
	/** Stable within the message: `${toolCallId}` or `${toolCallId}:${index}`. */
	id: string;
	kind: ChatReceiptKind;
	/** The whole user-facing fragment, already worded: "Saved to Romans study". */
	label: string;
	target: ChatReceiptTarget;
	/** Present only when the client can undo from the fragment. */
	undo?: { type: "forgetMemory"; memoryId: string };
}
```

| Tool part (output-available, success) | label | target | undo |
|---|---|---|---|
| `addToNote`, created | `Saved to {noteTitle}` | note | none |
| `addToNote`, appended or `matchedExisting` | `Added to {noteTitle}` | note | none |
| `updateNote` | `Updated {noteTitle}` | note | none |
| `saveMemory` (one per saved memory) | `Remembered` | memories + memoryId | forgetMemory |
| `updateMemory` | `Memory updated` | memories + memoryId | none |
| `deleteMemories` | `Forgot {n} memor{y/ies}` | memories | none |
| `setDailyCross` | `Today's cross: {reference}` | cross | none |
| `startReadingPlan` | `Started {planTitle}` | plan | none |
| `markReadingPlanDay` | `Marked day {n}` | plan | none |
| `highlightVerse` (new) | `Marked {reference}` or `Marked {reference} as {colourName}` | chapter + verse | none |
| `organizeNote` (new) | `Filed {noteTitle}` | note | none |
| `updatePreferences` (new) | `{setting} {on/off/value}` | settings + preferences | none |
| `setChurch` (new) | `Church set to {name}` | settings + church | none |
| `data-memoryExtracted` (new data part, passive extraction) | `Remembered` | memories + memoryId | forgetMemory |

Rules: a failed tool (`success: false` or an error state) leaves no receipt; the
assistant says what failed in prose. `forgetMemory` calls
`DELETE /api/memories/[id]` and, on success, replaces the fragment with
`Forgotten` for the rest of the session. The cross receipt may keep its verse
preview below the line, because that is content, not chrome. Passive
extraction currently writes rows with no part at all; the backend lane adds the
`data-memoryExtracted` part (persisted, not stripped by status narration) so a
passive save and a tool save look identical.

### Learn a verse

One verse per screen, one job. The server stores the queue and the schedule;
Android renders offline from the bundled KJV and syncs reviews when online.

**Table** `VerseMemory` (backend lane migration): `id`, `userId`, `book` (1-66
canonical order), `chapter`, `verse`, `translation` (`KJV` | `NKJV`), `source`
(`sheet` | `highlight` | `chat`), `stage` (0-3), `intervalDays` (int, starts 0),
`dueAt`, `lastReviewedAt?`, `knownAt?`, `createdAt`, `updatedAt`. Unique on
`[userId, book, chapter, verse]` (one card per verse regardless of translation;
re-adding in another translation updates `translation`). Index `[userId, dueAt]`.

**Routes** (all Clerk-authenticated, all user-scoped):

| Method and path | Body | Returns |
|---|---|---|
| `GET /api/learn/today` | none | `{ cards: LearnCard[] (at most 3, due first, then newest unstarted), knownCount, queueCount }` |
| `POST /api/learn` | `{ book, chapter, verse, translation, source }` | `LearnCard` (idempotent; 200 for existing) |
| `POST /api/learn/[id]/review` | `{ result: "again" \| "good" }` | `LearnCard` |
| `DELETE /api/learn/[id]` | none | `{ ok: true }` |

```ts
export interface LearnCard {
	id: string;
	book: number; chapter: number; verse: number;
	translation: "KJV" | "NKJV";
	reference: string;        // "John 3:16"
	text: string;             // server-resolved; Android may prefer the bundled text
	stage: 0 | 1 | 2 | 3;
	intervalDays: number;
	dueAt: string;            // ISO
	knownAt: string | null;
}
```

**The ladder** (same on every client). Stage 0: read the whole verse. Stage 1:
hide every word whose index `% 4 === 3`. Stage 2: hide every word whose index
`% 2 === 1`. Stage 3: show only the reference and blanks for every word. Words
are split on whitespace; leading and trailing punctuation stays visible next to
the blank, so "world:" becomes "____:". Tap a blank to reveal it. Both clients
implement `maskVerse(text, stage)` as a pure function with the same fixture
test (John 3:16 KJV at each stage).

**Scheduling** (server, pure `src/lib/learn-schedule.ts`). `good` at stages 0-2
advances the stage and makes the card due again **the same day** (it stays in
today's three). `good` at stage 3 sets `intervalDays` to `max(1, intervalDays *
2)` (first pass 1, then 2, 4, 8, 16, 32), stays at stage 3, and sets `dueAt =
today + intervalDays` in the user's timezone. `again` at any stage sets stage to
1, `intervalDays` to 0 and `dueAt` to today. `knownAt` is set the first time
`intervalDays >= 16` and never cleared; `knownCount` counts rows with `knownAt`.
No streaks, hearts, levels or badges; the only number a client shows is
"verses you know".

**Entry points.** "Learn this verse" on the verse sheet and on a highlight
(`source: sheet | highlight`); a `learnVerse` chat tool and a chat quiz are the
backend lane's, added later and counted against the tool budget.
