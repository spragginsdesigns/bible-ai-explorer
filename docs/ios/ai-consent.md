# AI disclosure and consent (PRD A4)

Status: **copy and server contract proposed, nothing implemented.** Decision
(c) in `docs/ios/PROGRESS.md`: a one-time sheet before the first AI request.
Apple 5.1.2(i) requires disclosing, and getting permission for, personal data
sent to a third-party AI. The same copy ships on all four clients (Parity Rule).

The provider list below must stay identical to the "How AI processing works"
section of `src/lib/marketing/legal-content.ts` (`/privacy`) and to
`docs/ios/app-privacy.md`.

## 1. Sheet copy

**Title:** How SureWord answers you

**Body** (99 words, limit 120):

> SureWord's answers are written by AI. To answer you, SureWord sends your
> question, the conversation, your attachments, and the study context you have
> shared (About me, your testimony, memories, notes, highlights and reading) to
> OpenAI, or to the provider of your own API key when you choose one of its
> models. OpenAI also transcribes voice messages. Web searches go to Tavily, and
> spoken devotionals are voiced by ElevenLabs. They use it only to answer you;
> it is never sold or used for ads. The AI can be wrong, so search the
> Scriptures to see whether these things are so.

**Link** (below the body): "Privacy Policy" → `https://sureword.app/privacy`
(opens in the system browser; on iOS this and `/support` are the only site
links, see PRD F1).

**Buttons:**

- Primary: **Agree and continue**
- Secondary: **Not now**

### Behavior

- Shown once per account, before the first request that reaches an AI provider:
  chat send (including `/check`, `/reply`, slash commands that call the model),
  tap-a-verse Explain and Words, note AI, Build my own plan, a fresh Daily
  Cross, Listen generation, and a voice-message upload (transcription happens at
  upload completion, so the gate must sit before the upload, not before send).
- **Agree and continue** records consent (section 2) and then performs the
  action the person tapped, so they never have to tap twice.
- **Not now** dismisses the sheet and sends nothing. The draft stays in the
  composer. Reading, search, highlights, notes, Atlas and every non-AI screen
  keep working (Apple 5.1.1(iv): do not hold the rest of the app hostage). The
  next AI action shows the sheet again.
- Settings → AI gets one row, "AI data sharing", showing "Allowed on <date>"
  and a **Withdraw** action (confirm dialog). Withdrawing clears consent; the
  next AI action shows the sheet again.
- Signed-out guests on the web landing page ("Try before you sign up") are a
  separate surface with no account to record against; show the same body as a
  one-line notice with the Privacy link under the guest composer instead.

## 2. Server contract proposal

Store consent on the account, not the device, so a person who agreed on Android
is not asked again on iPhone, and so the record is deleted with the account.

### Schema (one migration)

```prisma
model User {
  // ...
  /// AI data-sharing consent (docs/ios/ai-consent.md). The copy version the
  /// person agreed to, and when. Null until they agree; cleared on withdraw.
  aiConsentVersion Int?
  aiConsentAt      DateTime?
}
```

Two columns on `User`, so `DELETE /api/account` removes them with the row and
`ACCOUNT_DATA_MODELS` (the deletion coverage test) needs no change.

### Contract (`src/lib/preferences-contract.ts`)

```ts
/** Bump when the provider list or what is sent changes materially. */
export const AI_CONSENT_VERSION = 1;
```

- `GET /api/preferences` adds
  `aiConsent: { version: number; acceptedAt: string } | null` and
  `aiConsentRequired: number` (the current `AI_CONSENT_VERSION`). A client
  shows the sheet when `aiConsent?.version !== aiConsentRequired`.
- `PATCH /api/preferences` accepts `aiConsent: { version: number } | null`.
  - `{ version }` must equal `AI_CONSENT_VERSION`, else 400 (a stale build must
    not record agreement to copy it never showed). The server stamps
    `aiConsentAt = now()`; the client never sends a time.
  - `null` withdraws (both columns null).
  - Idempotent; one bad field writes nothing, as today.
- Analytics: the existing `setting_changed` event already records the key name
  `aiConsent` and never the value. No new event needed.

### Client caching

Persist the last `aiConsent` per account id with the rest of the per-account
Settings cache (Android `settingsData.ts` / `cacheOwner.ts`, PRD B7), so an
offline cold start does not re-prompt someone who agreed, and an account
switch never inherits another person's consent.

### Copy parity

One source: `src/lib/ai-consent.ts` (title, body, button labels, version),
mirrored in `mobile/src/lib/aiConsent.ts` and `macos/Shared/AIConsent.swift`,
with a mirror test in the style of `tests/answer-feedback.test.mjs` that fails
if any mirror drifts in text or version.

### Server enforcement (decision for Austin)

The client gate alone satisfies 5.1.2(i) for the App Store build. Two server
paths still send personal context to OpenAI without a tap:

1. The morning Daily Cross cron (`src/app/api/cron/verse-of-day/route.ts`)
   personalizes from reading, notes and chat for every account active in the
   last 30 days (`src/lib/cron-audience.ts`).
2. Memory extraction after a chat turn (only after a turn, so already behind
   the gate).

Recommendation: phase 1 ships the client gate on all four clients and the
stored record. Phase 2, once every supported client build carries the gate,
(a) AI routes answer `428 { error: "ai_consent_required" }` without consent,
and (b) the cron falls back to a non-personalized verse for accounts without
consent. Doing (a) before every installed Android build has the sheet would
break those builds, so it must wait. Existing accounts see the sheet once on
their next AI action after the update.

## 3. Thumbs-down reports: do they reach a human?

Update (2026-10-07, later): **the review queue now exists.** `/admin/feedback`
lists every thumbs-down answer (chips, comment, question, answer, model) and
every Send feedback message, newest first, with 7/30/90-day, type and
unreviewed-only filters and a persisted "Mark reviewed"
(`Message.feedbackReviewedAt`, `Feedback.reviewedAt`, migration
`20261007140000_feedback_review_queue`). Only the Clerk ids in
`ADMIN_USER_IDS` can open it; everyone else gets 404. See docs/FEATURES.md,
"Reviewing reports". Recommendation 2 below is done; there is still no
notification (recommendation 1), so "timely" depends on the owner opening the
queue.

Original finding (code read 2026-10-07): **stored and reviewable by hand, but
there is no queue, no admin view and no notification.**

| Path | Where it lands | How a person sees it today |
|---|---|---|
| Answer thumbs down + chips + optional reason | `Message.feedback`, `feedbackTags`, `feedbackReason`, `feedbackAt` (indexed on `feedback, feedbackAt`), written by `PATCH /api/conversations/[id]/messages/[messageId]` | Only by running `node scripts/feedback-to-fixtures.mjs --since <date>` (prints thumbs-down answers as eval-fixture candidates) or section 8 of `scripts/sql/product-metrics.sql` (weekly counts). PostHog `answer_rated` carries the thumb and chip ids, never the text. |
| Settings → Send feedback | `Feedback` table (category, message, platform, version, optional reply email) via `POST /api/feedback` | No admin view and no email; read with a SQL query. The client does not exist on iOS or macOS yet (PRD B4). |

There is no email provider in `package.json`, no `/admin` route, and nothing
alerts anyone when a report arrives. Apple 1.2 and 5.1.2 reviewers ask for a
way to report objectionable AI output **and timely action on it**; a table only
a script can read is weak evidence of that.

Recommendation, smallest first:

1. A daily cron digest (Vercel cron, same `CRON_SECRET` pattern) that posts new
   thumbs-down rows and `Feedback` rows from the last 24 hours to Austin by
   push notification to his own device (the push pipeline already exists) or
   by email once a provider is chosen. No answer text in the push body; a link
   to an admin view.
2. A minimal admin page gated by an `ADMIN_USER_IDS` allowlist (same parser as
   `PRO_USER_IDS`) listing recent thumbs-down answers with their chips, reason
   and the question, plus `Feedback` rows, with a "reviewed" mark.
3. Say in the review notes (`docs/ios/review-notes.md`) that reports are
   reviewed daily, only once (1) exists.
