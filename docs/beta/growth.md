# Habits & Reflection (`growth`)

**Where:** SureWord Beta, Learn → Habits & Reflection, `/beta/learn/growth`
(founders only, web only). **Issue:** LC-17652, under LC-17631. Jay's "My
Walk" area (LC-17639, [expansion.md](expansion.md)) is Home and holds this
module; it keeps its Learn route, and a place for it on Home is the founders'
call (README, Building a module).

**The ask (Jay, from the study-platform proposal, P2, "inspired by Todoist and
habit trackers"):** voluntary reading goals, prayer reminders, a reflection
journal and periodic follow-ups on insights the founder chose to put into
practice, so learning becomes deliberate daily habits **without reducing
spiritual growth to a score**. The concept board's "Personal Growth" panel
("Build a habit of time with God", an M to S day row, Bible Reading 4 of 5
days, a closing verse) is the visual direction.

## What it does

- **Habits you choose**, each with a weekly target of 1 to 7 days and an
  optional reminder time. Four kinds SureWord knows, one of each, plus any
  number of your own (up to 12 habits in all):

  | Habit | How a day is kept |
  |---|---|
  | Bible reading | Counted from the reading log: any day `ReadingLogDay.entries > 0` (what the Bible reader records as you read, on your own calendar day). |
  | Scripture memory | Counted from Learn a verse: any day with a review (`LearnReviewReceipt.createdAt`, which every client's review leaves, plus each card's `VerseMemory.lastReviewedAt`). |
  | Study | Counted from SureWord Beta: any day you added to or changed an item in another beta module (`BetaItem.createdAt`/`updatedAt`, read through `listBetaActivity` in `store.ts`, timestamps only). |
  | Prayer & reflection | Marked by you, or kept by writing a reflection in the journal that day. |
  | Your own (fasting, worship, serving...) | Marked by you. |

  The ones SureWord can see cannot be ticked by hand (never typed twice); the
  server refuses it.
- **The week**: the board's M to S row (a day is gold when any habit was kept
  on it), and each habit's ring with "4 of 5 days". Tap a habit to see its
  days; for the ones you mark, tap a day to mark or clear it (from the oldest
  week in the history up to today, never ahead). Step back through the last
  eight weeks with the arrows or from **Earlier weeks**, which lists only the
  weeks something was kept, and what: never the weeks it was not.
- **Never a score.** No streaks, no totals, no percentages, no leaderboard. A
  day that was not kept is a plain outline, never red, never crossed out. A
  ring fills to the target and no further. The lines under the week only say
  what happened ("3 days with God that week", "A quiet week").
  `tests/beta-growth.test.mjs` checks the copy for "missed", "behind",
  "streak" and similar.
- **Reminders, in the app.** The beta is web-only, so there is no push. When a
  habit's reminder time has passed and it is not kept yet, the **Today** card
  at the top of the page says so ("It's past 7:00 AM. A few minutes for
  prayer & reflection?") with Mark today, or a link to the Bible, Learn a
  verse or Study. The page rereads the clock each minute while open and starts
  the new day at midnight.
- **A private reflection journal**, with optional prompts ("What did God show
  you in His Word today?", "What are you thankful for?" and four more) and an
  optional passage, which SureWord resolves ("ps 23" is Psalm 23) and keeps as
  a passage key. Edit or delete any entry.
- **Put into practice**: something you want to live out, on its own or from a
  reflection, with a passage if you like and a follow-up in 3 days, a week,
  two weeks, a month, or none. When the day comes, Today asks "How has it
  gone?": write a few words (kept with the practice, dated), choose when to
  be asked again or not at all, say "It's part of me now", or "Tomorrow".
  What has become part of you is kept under the practice list, and can be
  practised again.
- **Talk it over** on any reflection or practice opens Ask SureWord with it
  written in the composer (`/?prompt=`, cut to 1,500 characters). The link is
  never prefetched, so the words leave the page only when it is pressed, and
  they reach the AI only when you send them there.
- **A closing verse** for the week, one of eight, quoted from the bundled KJV
  (`getKjvChapter`), never from memory.

## Privacy

Journal entries and practice items are private to their owner:

- Their words live only in the item's `data` (`text`, the follow-up notes),
  marked `private: true`. The `title` is fixed ("Private reflection", "Put
  into practice") and `body` is never set, so the Knowledge Vault, which
  indexes `title` and `body`, sees that an entry exists and the passage it is
  on, never what was written.
- Other modules read the shared store too, so `docs/beta/README.md` (The
  shared study store, Private items) now says that an item whose `data` has
  `private: true` may be counted, listed and linked by its title, passages
  and dates, but its `data` is never read, indexed, shown or sent to an AI.
- Nothing in the module imports an AI provider, embeddings, memory
  extraction or Scripture search (a test fails the build if one does). The
  only way an entry reaches an AI is Talk it over, which the founder presses
  and then sends. Its links are never prefetched (a test checks), and a
  failed request is logged without its message, since a database error can
  quote what was being saved.
- Every read and write goes through the shared store by owner; another
  account's id is a 404, the same as one that does not exist.
- They are `BetaItem` rows, so account deletion removes them (`BetaItem`
  cascades from `User`, already in `ACCOUNT_DATA_MODELS`).

## Data

Everything is a `BetaItem` with `module: "growth"`. No table of its own and no
migration.

| kind | title | data | refs |
|---|---|---|---|
| `habit` | the habit's name | `type`, `target` (1-7), `reminder` ("HH:MM" or null), `checks` (days marked by hand, sorted), `order` | none |
| `reflection` | "Private reflection" | `text`, `prompt`, `day`, `passage`, `private: true` | the passage key |
| `practice` | "Put into practice" | `text`, `passage`, `day`, `followUpOn`, `status` ("active" or "lived"), `notes` ([{ day, note }]), `reflectionId`, `private: true` | the passage key |

Days are the founder's calendar days: every call sends the browser's IANA
timezone as `?tz=`; without one, the timezone their phone last reported
(`learnTimezone`), else America/Los_Angeles. Reading days use the reading
log's own `localDate`.

Pure rules (weeks, habit and practice validation, kept days, rings,
reminders, follow-ups, the week's verse) are `src/lib/beta/growth/growth-rules.ts`,
tested in `tests/beta-growth.test.mjs`. The server half is
`src/lib/beta/growth/growth.ts`.

## API

All under `/api/beta/growth`, each gated by `requireBetaApi()` (404 to anyone
off `BETA_USER_IDS`, 401 signed out), `Cache-Control: private, no-store`.

| Route | What |
|---|---|
| `GET /api/beta/growth?tz=&week=` | The page for one week (this week by default; clamped to the last 8 weeks): habits with that week's marks and count, the day row, the 8 weeks before this one, reflections (the 500 most recently changed) and practices (200). |
| `POST /habits` | `{ type, name?, target?, reminder? }`, or `{ starter: true }` for Bible reading, prayer and Scripture memory. |
| `PATCH`, `DELETE /habits/:id` | `{ name?, target?, reminder? }`; the kind never changes. |
| `PUT /habits/:id/days` | `{ day, done }` for a habit marked by hand. Idempotent. |
| `POST /reflections`, `PATCH`, `DELETE /reflections/:id` | `{ text, prompt?, passage? }`. |
| `POST /practices` | `{ text, passage?, followUp?: "none" \| "3d" \| "1w" \| "2w" \| "1m", reflectionId? }`. |
| `PATCH /practices/:id` | `{ action: "follow-up", note?, next }`, `{ action: "later" }`, `{ action: "lived", note? }`, `{ action: "reopen", next? }`. |
| `DELETE /practices/:id` | Removes it. |

## Known limits

- A habit marked by hand is a read-modify-write of its `checks`; two tabs
  marking different days at the same instant could lose one. The page waits
  for each tap to save before the next.
- A Learn review made offline and synced on a later day also counts on the
  day it synced (the receipt keeps the sync time, not the review time). Its
  own day counts too while it is that card's latest review.
- Study counts the day an item was made and the day it last changed, not
  every day in between it was edited.

## Proof (LC-17652)

A production build against a throwaway Neon branch of `versemind`, signed in
as the founder stand-in through a Clerk sign-in token. Its reading-log
entries and Learn a verse reviews were made through `/api/reading-log`,
`/api/learn` and `/api/learn/:id/review` and drove the week view, alongside
manual check-ins, journal entries and a follow-up that came due. At 1280 and
375px with touch, light and dark; the off-list account got the ordinary 404
on the page and from every route. Evidence is on LC-17652.
