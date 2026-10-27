# Prayer & Testimony (`prayer`)

**Where:** SureWord Beta, Learn → Prayer & Testimony, `/beta/learn/prayer`
(founders only, web only). **Issue:** LC-17723, item 5 of Jay's SureWord 2030
brief (LC-17689): "Prayer requests could become living entries with updates,
associated Scripture, reminders and user-confirmed outcomes ... a personal
testimony archive rather than a simple prayer checklist."

## What it does

- **Your prayer list, as living entries.** The requests are the prayer list
  SureWord already keeps (`UserMemory`, category `prayer`: the ones you add in
  Settings → Memory, ask SureWord to remember in a conversation, or add at the
  top of this page through the ordinary `POST /api/memories`). There is no
  second prayer store. Open one and it gathers:
  - **Dated updates**, in your words, deletable one by one. Writing an update
    is revisiting the prayer, so a reminder that has come due is done.
  - **Passages you are standing on** ("phil 4:6" resolves to Philippians 4:6),
    each a link into the reader, kept as the item's `refs` so the Knowledge
    Vault and the Living Study Graph know a prayer touches that passage.
  - **A reminder day**, today up to about two years ahead. On that day the
    request comes back at the top of the page under "To revisit today". It is
    in-app on the web only; there is no push.
  - **What happened, recorded only when you confirm it.** "Record what
    happened": choose "God answered it" or "I laid it down", write what
    happened in your own words (required) and an optional reflection, review
    it, then Confirm. The server refuses an outcome without `confirmed: true`
    and written words. Confirming moves the prayer list row to answered or
    closed exactly as its own buttons do (`prayerStatusUpdate`), so chat stops
    following it up. "Pray on" reopens it, and the words you recorded become a
    dated update, never thrown away.
  - A request that chat marked answered, without your words, shows "Marked
    answered in a conversation" and no outcome until you write one.
- **The testimony timeline**, oldest first and grouped by month on your own
  calendar: when you began praying (with the passages you stand on), each
  update, and what happened with your reflection. It tells the story in your
  words and never counts, scores or judges; a test pins that the timeline's
  code has no streak, score or percentage.
- **Kept beyond the prayer list.** The prayer list holds 60 memories. Each
  entry keeps a copy of its request's words, so a request removed from the
  list keeps its testimony here ("No longer on your prayer list"); "Remove
  from my timeline" deletes it for good.
- **Private by default, shared on purpose.** "Share into a group" is the
  Groups prayer circle's own path (`docs/beta/groups.md`): pick one of your
  groups, see exactly what will be shared and the same words the circle's own
  picker uses, confirm, and only then a copy of that one request is posted
  through `POST /api/beta/groups/:id/posts { kind: "prayer", memoryId }`. Your
  updates, passages and outcome are never shared. SureWord Family (LC-17658)
  had not shipped when this module did; when it has a prayer list of its own,
  it gets the same picker here.

## Data

No table of its own and no migration. One `BetaItem` per request: module
`prayer`, kind `entry`, the fixed title "Prayer request", no `body`, `refs`
from the linked passages, and `data`:

| Field | What |
|---|---|
| `private` | always `true` (README, Private items): no other module reads, indexes, shows or sends it to an AI |
| `memoryId` | the prayer list row (`UserMemory.id`) |
| `request`, `askedAt` | a copy of the request's words (kept in step with the list) and when you began praying |
| `updates` | `{ id, at, text }`, up to 200, 1,000 characters each |
| `passages` | canonical labels, up to 12 |
| `remindOn` | a calendar day, or null |
| `outcome` | `{ kind: "answered" \| "closed", at, words, reflection }`, or null |

Every write is a read-modify-write made conditional on the version it read
(the store's `ifUpdatedAt`), retried once, so two tabs never overwrite each
other. Every `UserMemory` read and write is scoped to the caller's own id and
category `prayer`; the module never creates or deletes a prayer list row
(a test pins both). Account deletion takes the items through the existing
`BetaItem` cascade. Nothing in the module imports an AI (a test pins it).

## API

All under `requireBetaApi()`; a missing or someone else's request is the
ordinary 404. Pass `?tz=<IANA>` for your calendar.

- `GET /api/beta/prayer` → `{ today, requests, timeline }`
- `PATCH /api/beta/prayer/:memoryId { passages?, remindOn? }`;
  `DELETE /api/beta/prayer/:memoryId` (its testimony only)
- `POST /api/beta/prayer/:memoryId/updates { text }`;
  `DELETE /api/beta/prayer/:memoryId/updates/:updateId`
- `PUT /api/beta/prayer/:memoryId/outcome { kind, words, reflection?, confirmed: true }`;
  `DELETE` the same path to pray on

Code: `src/lib/beta/prayer/` (`prayer-rules.ts` pure, tested by
`tests/beta-prayer.test.mjs`), `src/components/beta/prayer/`,
`src/app/beta/learn/prayer/`, `src/app/api/beta/prayer/`.

## Known limits

- Reminders are in-app on the web; there is no push or email.
- Home's personal space does not show an open prayer yet (LC-17689 authorized
  it, but Home was being changed by LC-17689's own run at the time).
- Sharing into Family waits for SureWord Family.
