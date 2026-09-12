# Durable reading history

The Bible reader and AI physical-reading tools share `ReadingLogEntry`: one mutable chapter snapshot per account, session, and canonical chapter. A session contains compact merged verse ranges; no Scripture text or per-verse event rows are stored. Intentional rereading creates a new session. Higher revisions replace a chapter snapshot. Replaying the same revision is a no-op; changing its content is a conflict. Deleted entries retain tombstones so delayed offline requests cannot restore removed history. Explicit corrections seal their snapshots with `correctedAt`: later automatic revisions acknowledge the corrected canonical entry without overwriting it. Further explicit corrections remain possible with a revision guard.

## Storage and query contract

- `POST /api/reading-log` accepts `eventId`, `sessionId`, `revision`, `source` (`reader` or `physical`), canonical `book` (1–66), `chapter`, optional `verseRanges`, `translation`, `occurredAt`, `localDate`, IANA `timezone`, `precision`, `completed`, `evidence`, and `activeSeconds`. Canonical KJV verse counts validate every range. Completion requires coverage of the whole chapter.
- `GET /api/reading-log` returns a bounded keyset page and lifetime totals. Filters include book/chapter, verse overlap, source, timestamps, or calendar dates. Calendar queries use a separate calendar cursor order. Cursors cannot be reused across those two sort modes.
- `PATCH /api/reading-log/:eventId` corrects an owned entry. A supplied revision is an optimistic concurrency guard. `DELETE` accepts the same guard as a `revision` query parameter.
- `recordReadings` supports an atomic batch of at most 150 chapters for AI reports. Physical-session replay must preserve its original chapter set; changing an interpretation requires an explicit correction.

`ReadingLogTotals` serves lifetime counters directly. Chapter summaries have at most 1,189 rows per account. Each chapter stores per-verse occurrence counters, allowing overlap and corrections to remain exact without rereading the event journal. Daily chapter summaries answer annual coverage (maximum 366 days per query). Results without a book filter summarize the 66 books and missing chapters, avoiding a large per-verse AI response. Filtered session and active-day counts are intentionally null; they are not inferred from chapter totals.

Full chapter readings, unique completed chapters, partial readings, sessions, active days, and individual verse frequency are separate quantities. Several partial sessions can cover all verses while still having zero single-session full chapter completions. `coverage` exposes this distinction.

`ReadingLogStreak` stores disjoint active-day intervals. Inserts can join adjacent intervals; deletion can split one. Even a decades-long streak reads one interval instead of thousands of daily rows.

The hot write path is one SQL function call, `sureword_write_readings`, containing the account lock, idempotency checks, entry writes, summary deltas, and streak changes. PostgreSQL applies the entire batch atomically. Corrections and deletions reuse the same `sureword_reading_delta` function. The account row lock serializes simultaneous devices without cross-account contention. Live-row partial indexes support timeline, passage, book, source, calendar, and completed-passage queries. Prisma 6 cannot express their predicates; these indexes are maintained in the additive SQL migration.

## Foreground tracking and durable delivery

Android and web qualify visible verses after eight seconds of foreground dwell. Covering every verse in one session grants chapter completion; later sessions count rereads separately. Thirty minutes of inactivity starts a new session. Translation changes preserve chapter identity. The original timestamp and timezone stay paired while a chapter snapshot grows.

Clients persist each revision before upload and retain only pending snapshots plus the current session locally. Android uses account-scoped AsyncStorage records, web uses storage with cross-tab locks, and Apple uses an atomic account-specific file. An acknowledgment clears only the submitted revision, so a newer local revision remains pending. No server acknowledgment means the local reading remains queued.

Dwell uses one-shot timers and stops when the reader is obscured, unfocused, or backgrounded. Android/web coalesce saves over fifteen seconds, bound each complete upload (including authentication) to fifteen seconds, and cap exponential retries at six attempts. Apple uses a thirty-five-second complete-request deadline and the same retry cap. Foreground, reconnect signals, and manual retry resume delivery. These clients do not schedule background polling or acquire wake locks. Disk failures preserve existing data and show an actionable error instead of repeatedly writing to a full device.

## Time and provenance

`reportedAt` is the server receipt timestamp. Exact readings keep their original `occurredAt`, including delayed offline saves. Coarse reports such as "this morning" preserve `localDate`, `precision`, and timezone; public entries return `occurredAt: null`. Internally their timestamp is the earliest possible instant of that local day, calculated across timezone/DST boundaries. It is an ordering and plan-eligibility bound, never an invented reading time. A coarse report counts toward a plan automatically only if even that earliest instant follows the plan start.

Reading-plan automatic progress consumes the shared chapter summaries. The existing manual plan-day checkbox keeps its original checklist semantics for this release: it does not create or delete reading-journal sessions. Physical reading reported through the AI is logged in the journal and contributes to plan progress.

Automatic qualified viewing and explicit physical reports retain distinct evidence. Migrated and old-client five-second observations retain `source: legacy`, `precision: legacy`, and `evidence: legacy`; their timestamps describe the original recorded observation, not proof that the chapter was finished.

## Migration and rollout

1. Apply `20260913010000_durable_reading_log` before deploying readers or tool code that writes the new endpoint. Inspect the existing `ReadingEvent` table size first: its new `(userId, id)` backfill index uses standard `CREATE INDEX`, which briefly blocks writes during construction. For a large legacy table, prepare that index concurrently in a separate migration before rollout. This creates tables, indexes, constraints, and functions only; it does not backfill a large production journal inside deployment.
2. Deploy the server compatibility layer and drain in-flight old-server writes before backfill. `/api/reading-events` continues accepting old clients, preserves its legacy one-hour suppression, and writes explicitly labeled legacy observations to the shared log.
3. Run the resumable backfill in a controlled process with the production database environment:

   ```sh
   NODE_OPTIONS=--conditions=react-server pnpm dlx tsx scripts/backfill-reading-history.ts
   ```

   `--user=<Clerk ID>` limits scope. Each 50-row transaction commits the account's cursor along with its new summaries. Original `ReadingEvent` rows are never deleted. Unknown book mappings or invalid chapters stop that account with the original event ID; resolve these records deliberately before resuming.
4. Require every historical account's `legacyBackfilled` flag before claiming complete lifetime history. While it is false, compatibility consumers retain bounded access to old history and the new stats expose `historicalBackfillPending: true`. Release should wait for the backfill to finish; the fallback is not a permanent lifetime query implementation.
5. Keep the original table through rollback verification. A rollback to old app code will not read new-only sessions, so preserve the new tables and reconcile before any server rollback. Never drop the new journal as a rollback step.

## Verification and production observation

Run the repository logic/type checks and real PostgreSQL checks against an explicitly supplied isolated local database:

```sh
READING_TEST_DATABASE_URL=postgresql://localhost/test node scripts/verify-reading-log.mjs
READING_TEST_DATABASE_URL=postgresql://localhost/test node scripts/verify-reading-log-integrity.mjs
```

The first suite covers concurrent retries, morning/evening rereading, partial revisions, atomic batch rejection, account isolation, deletion replay, corrections, coarse dates, and keyset pagination. Its `--benchmark` mode loads one million rows and examines actual PostgreSQL plans. Integrity checks independently fold the journal and compare totals/verse counters, test streak splitting/merging, and resume a twenty-year legacy backfill without duplicate or lost original records.

`[reading.metrics]` records mutation operation, duration, outcome, status, and source/entry counts. It includes no account IDs, passages, message content, or tokens. Use these metrics plus the device outbox's retained/retried status to measure production delivery and latency. Local tests establish behavior; they do not establish a 99.99% production delivery rate or device battery impact.
