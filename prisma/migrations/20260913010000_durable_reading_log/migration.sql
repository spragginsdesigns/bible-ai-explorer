-- CreateTable
CREATE TABLE "ReadingLogEntry" (
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "source" TEXT NOT NULL,
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verseRanges" JSONB NOT NULL,
    "translation" TEXT NOT NULL DEFAULT 'KJV',
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "localDate" VARCHAR(10) NOT NULL,
    "timezone" TEXT NOT NULL,
    "precision" TEXT NOT NULL,
    "completed" BOOLEAN NOT NULL,
    "evidence" TEXT NOT NULL,
    "activeSeconds" INTEGER NOT NULL DEFAULT 0,
    "deletedAt" TIMESTAMP(3),
    "correctedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReadingLogEntry_pkey" PRIMARY KEY ("userId","eventId")
);

-- CreateTable
CREATE TABLE "ReadingLogChapter" (
    "userId" TEXT NOT NULL,
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "chapterReadings" INTEGER NOT NULL DEFAULT 0,
    "partialReadings" INTEGER NOT NULL DEFAULT 0,
    "verseCounts" INTEGER[],
    "lastReadAt" TIMESTAMP(3),
    "lastCompletedAt" TIMESTAMP(3),
    "lastCompletedDate" VARCHAR(10),

    CONSTRAINT "ReadingLogChapter_pkey" PRIMARY KEY ("userId","book","chapter")
);

-- CreateTable
CREATE TABLE "ReadingLogDay" (
    "userId" TEXT NOT NULL,
    "localDate" VARCHAR(10) NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "chapterReadings" INTEGER NOT NULL DEFAULT 0,
    "partialReadings" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReadingLogDay_pkey" PRIMARY KEY ("userId","localDate")
);

-- CreateTable
CREATE TABLE "ReadingLogSession" (
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ReadingLogSession_pkey" PRIMARY KEY ("userId","sessionId")
);

-- CreateTable
CREATE TABLE "ReadingLogTotals" (
    "legacyBackfilled" BOOLEAN NOT NULL DEFAULT false,
    "legacyCursor" TEXT,
    "userId" TEXT NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "chapterReadings" INTEGER NOT NULL DEFAULT 0,
    "partialReadings" INTEGER NOT NULL DEFAULT 0,
    "uniqueChapters" INTEGER NOT NULL DEFAULT 0,
    "activeDays" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),

    CONSTRAINT "ReadingLogTotals_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "ReadingLogChapterDay" (
    "userId" TEXT NOT NULL,
    "localDate" VARCHAR(10) NOT NULL,
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "entries" INTEGER NOT NULL DEFAULT 0,
    "chapterReadings" INTEGER NOT NULL DEFAULT 0,
    "partialReadings" INTEGER NOT NULL DEFAULT 0,
    "verseCounts" INTEGER[],

    CONSTRAINT "ReadingLogChapterDay_pkey" PRIMARY KEY ("userId","localDate","book","chapter")
);

-- CreateTable
CREATE TABLE "ReadingLogStreak" (
    "userId" TEXT NOT NULL,
    "startDate" VARCHAR(10) NOT NULL,
    "endDate" VARCHAR(10) NOT NULL,

    CONSTRAINT "ReadingLogStreak_pkey" PRIMARY KEY ("userId","startDate")
);

-- CreateIndex
CREATE INDEX "ReadingLogEntry_userId_sessionId_idx" ON "ReadingLogEntry"("userId", "sessionId");

-- CreateIndex
CREATE INDEX "ReadingLogEntry_userId_localDate_idx" ON "ReadingLogEntry"("userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "ReadingLogEntry_userId_sessionId_book_chapter_key" ON "ReadingLogEntry"("userId", "sessionId", "book", "chapter");

-- CreateIndex
CREATE INDEX "ReadingLogStreak_userId_endDate_idx" ON "ReadingLogStreak"("userId", "endDate");

-- CreateIndex
CREATE INDEX "ReadingEvent_userId_id_idx" ON "ReadingEvent"("userId", "id");

-- AddForeignKey
ALTER TABLE "ReadingLogEntry" ADD CONSTRAINT "ReadingLogEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLogChapter" ADD CONSTRAINT "ReadingLogChapter_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLogDay" ADD CONSTRAINT "ReadingLogDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLogSession" ADD CONSTRAINT "ReadingLogSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLogTotals" ADD CONSTRAINT "ReadingLogTotals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLogChapterDay" ADD CONSTRAINT "ReadingLogChapterDay_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadingLogStreak" ADD CONSTRAINT "ReadingLogStreak_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Guard persisted invariants even if a future writer bypasses the service.
ALTER TABLE "ReadingLogEntry" ADD CONSTRAINT "ReadingLogEntry_values_check"
CHECK ("book" BETWEEN 1 AND 66 AND "chapter" BETWEEN 1 AND 150 AND "revision" > 0
  AND "activeSeconds" >= 0 AND "source" IN ('reader', 'physical', 'legacy')
  AND "precision" IN ('exact', 'day', 'morning', 'afternoon', 'evening', 'legacy')
  AND jsonb_typeof("verseRanges") = 'array');
ALTER TABLE "ReadingLogTotals" ADD CONSTRAINT "ReadingLogTotals_nonnegative_check"
CHECK ("sessions" >= 0 AND "chapterReadings" >= 0 AND "partialReadings" >= 0 AND "uniqueChapters" >= 0 AND "activeDays" >= 0);

-- All hot-path mutation work runs beside the data: one client/database round
-- trip per batch, independent of its chapter count. These functions are
-- invoker-security, and every call locks the existing account row first.
CREATE FUNCTION sureword_reading_verse_delta(counts INTEGER[], ranges JSONB, delta INTEGER)
RETURNS INTEGER[] LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE r JSONB; v INTEGER; needed INTEGER; result INTEGER[] := COALESCE(counts, ARRAY[]::INTEGER[]);
BEGIN
  FOR r IN SELECT * FROM jsonb_array_elements(ranges) LOOP
    needed := (r->>'end')::INTEGER;
    IF needed > COALESCE(array_length(result, 1), 0) THEN
      result := result || array_fill(0, ARRAY[needed - COALESCE(array_length(result, 1), 0)]);
    END IF;
    FOR v IN (r->>'start')::INTEGER..needed LOOP
      result[v] := result[v] + delta;
      IF result[v] < 0 THEN RAISE EXCEPTION 'Reading verse summary underflow'; END IF;
    END LOOP;
  END LOOP;
  RETURN result;
END $$;

CREATE FUNCTION sureword_reading_delta(e JSONB, delta INTEGER) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  uid TEXT := e->>'userId'; bid INTEGER := (e->>'book')::INTEGER; ch INTEGER := (e->>'chapter')::INTEGER;
  sid TEXT := e->>'sessionId'; day TEXT := e->>'localDate'; done BOOLEAN := (e->>'completed')::BOOLEAN;
  prior "ReadingLogChapter"%ROWTYPE; daily "ReadingLogChapterDay"%ROWTYPE;
  new_chapters INTEGER; new_day_entries INTEGER; new_session_entries INTEGER;
  last_at TIMESTAMP(3); complete_at TIMESTAMP(3); complete_day TEXT;
  previous_interval "ReadingLogStreak"%ROWTYPE; next_interval "ReadingLogStreak"%ROWTYPE; containing "ReadingLogStreak"%ROWTYPE;
  yesterday TEXT := to_char(day::date - 1, 'YYYY-MM-DD'); tomorrow TEXT := to_char(day::date + 1, 'YYYY-MM-DD');
BEGIN
  SELECT * INTO prior FROM "ReadingLogChapter" WHERE "userId" = uid AND book = bid AND chapter = ch;
  new_chapters := COALESCE(prior."chapterReadings", 0) + CASE WHEN done THEN delta ELSE 0 END;
  SELECT "occurredAt" INTO last_at FROM "ReadingLogEntry" WHERE "userId" = uid AND book = bid AND chapter = ch AND "deletedAt" IS NULL ORDER BY "occurredAt" DESC, "eventId" DESC LIMIT 1;
  SELECT "occurredAt", CASE WHEN precision NOT IN ('exact', 'legacy') THEN "localDate" ELSE NULL END INTO complete_at, complete_day FROM "ReadingLogEntry" WHERE "userId" = uid AND book = bid AND chapter = ch AND "deletedAt" IS NULL AND completed ORDER BY "occurredAt" DESC LIMIT 1;
  INSERT INTO "ReadingLogChapter" ("userId", book, chapter, entries, "chapterReadings", "partialReadings", "verseCounts", "lastReadAt", "lastCompletedAt", "lastCompletedDate")
  VALUES (uid, bid, ch, COALESCE(prior.entries, 0) + delta, new_chapters, COALESCE(prior."partialReadings", 0) + CASE WHEN done THEN 0 ELSE delta END,
    sureword_reading_verse_delta(prior."verseCounts", e->'verseRanges', delta), last_at, complete_at, complete_day)
  ON CONFLICT ("userId", book, chapter) DO UPDATE SET entries = EXCLUDED.entries, "chapterReadings" = EXCLUDED."chapterReadings", "partialReadings" = EXCLUDED."partialReadings", "verseCounts" = EXCLUDED."verseCounts", "lastReadAt" = EXCLUDED."lastReadAt", "lastCompletedAt" = EXCLUDED."lastCompletedAt", "lastCompletedDate" = EXCLUDED."lastCompletedDate";

  SELECT * INTO daily FROM "ReadingLogChapterDay" WHERE "userId" = uid AND "localDate" = day AND book = bid AND chapter = ch;
  INSERT INTO "ReadingLogChapterDay" ("userId", "localDate", book, chapter, entries, "chapterReadings", "partialReadings", "verseCounts")
  VALUES (uid, day, bid, ch, COALESCE(daily.entries, 0) + delta, COALESCE(daily."chapterReadings", 0) + CASE WHEN done THEN delta ELSE 0 END,
    COALESCE(daily."partialReadings", 0) + CASE WHEN done THEN 0 ELSE delta END, sureword_reading_verse_delta(daily."verseCounts", e->'verseRanges', delta))
  ON CONFLICT ("userId", "localDate", book, chapter) DO UPDATE SET entries = EXCLUDED.entries, "chapterReadings" = EXCLUDED."chapterReadings", "partialReadings" = EXCLUDED."partialReadings", "verseCounts" = EXCLUDED."verseCounts";

  INSERT INTO "ReadingLogDay" ("userId", "localDate", entries, "chapterReadings", "partialReadings") VALUES (uid, day, delta, CASE WHEN done THEN delta ELSE 0 END, CASE WHEN done THEN 0 ELSE delta END)
  ON CONFLICT ("userId", "localDate") DO UPDATE SET entries = "ReadingLogDay".entries + delta,
    "chapterReadings" = "ReadingLogDay"."chapterReadings" + CASE WHEN done THEN delta ELSE 0 END,
    "partialReadings" = "ReadingLogDay"."partialReadings" + CASE WHEN done THEN 0 ELSE delta END
  RETURNING entries INTO new_day_entries;

  IF new_day_entries = 1 AND delta = 1 THEN
    SELECT * INTO previous_interval FROM "ReadingLogStreak" WHERE "userId" = uid AND "endDate" = yesterday LIMIT 1;
    SELECT * INTO next_interval FROM "ReadingLogStreak" WHERE "userId" = uid AND "startDate" = tomorrow;
    IF previous_interval."startDate" IS NOT NULL AND next_interval."startDate" IS NOT NULL THEN
      DELETE FROM "ReadingLogStreak" WHERE "userId" = uid AND "startDate" = next_interval."startDate";
      UPDATE "ReadingLogStreak" SET "endDate" = next_interval."endDate" WHERE "userId" = uid AND "startDate" = previous_interval."startDate";
    ELSIF previous_interval."startDate" IS NOT NULL THEN
      UPDATE "ReadingLogStreak" SET "endDate" = day WHERE "userId" = uid AND "startDate" = previous_interval."startDate";
    ELSIF next_interval."startDate" IS NOT NULL THEN
      UPDATE "ReadingLogStreak" SET "startDate" = day WHERE "userId" = uid AND "startDate" = next_interval."startDate";
    ELSE INSERT INTO "ReadingLogStreak" ("userId", "startDate", "endDate") VALUES (uid, day, day);
    END IF;
  ELSIF new_day_entries = 0 AND delta = -1 THEN
    SELECT * INTO containing FROM "ReadingLogStreak" WHERE "userId" = uid AND "startDate" <= day AND "endDate" >= day ORDER BY "startDate" DESC LIMIT 1;
    IF containing."startDate" = day AND containing."endDate" = day THEN
      DELETE FROM "ReadingLogStreak" WHERE "userId" = uid AND "startDate" = day;
    ELSIF containing."startDate" = day THEN
      UPDATE "ReadingLogStreak" SET "startDate" = tomorrow WHERE "userId" = uid AND "startDate" = day;
    ELSIF containing."startDate" IS NOT NULL THEN
      UPDATE "ReadingLogStreak" SET "endDate" = yesterday WHERE "userId" = uid AND "startDate" = containing."startDate";
      IF containing."endDate" <> day THEN INSERT INTO "ReadingLogStreak" ("userId", "startDate", "endDate") VALUES (uid, tomorrow, containing."endDate"); END IF;
    END IF;
  END IF;

  INSERT INTO "ReadingLogSession" ("userId", "sessionId", entries) VALUES (uid, sid, delta)
  ON CONFLICT ("userId", "sessionId") DO UPDATE SET entries = "ReadingLogSession".entries + delta RETURNING entries INTO new_session_entries;
  UPDATE "ReadingLogTotals" SET
    "chapterReadings" = "chapterReadings" + CASE WHEN done THEN delta ELSE 0 END,
    "partialReadings" = "partialReadings" + CASE WHEN done THEN 0 ELSE delta END,
    "uniqueChapters" = "uniqueChapters" + (new_chapters > 0)::integer - (COALESCE(prior."chapterReadings", 0) > 0)::integer,
    "activeDays" = "activeDays" + (new_day_entries > 0)::integer - (new_day_entries - delta > 0)::integer,
    sessions = sessions + (new_session_entries > 0)::integer - (new_session_entries - delta > 0)::integer
  WHERE "userId" = uid;
END $$;

CREATE FUNCTION sureword_write_readings(uid TEXT, items JSONB) RETURNS JSONB LANGUAGE plpgsql AS $$
DECLARE v JSONB; previous "ReadingLogEntry"%ROWTYPE; saved "ReadingLogEntry"%ROWTYPE; sid TEXT;
  expected TEXT[]; existing TEXT[]; result JSONB := '[]'::jsonb; identity JSONB;
BEGIN
  IF jsonb_typeof(items) <> 'array' OR jsonb_array_length(items) NOT BETWEEN 1 AND 150 THEN RAISE EXCEPTION 'READING_LOG_400:Invalid batch size'; END IF;
  PERFORM id FROM "User" WHERE id = uid FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'READING_LOG_404:Account not found'; END IF;
  INSERT INTO "ReadingLogTotals" ("userId", "legacyBackfilled") VALUES (uid, NOT EXISTS (SELECT 1 FROM "ReadingEvent" WHERE "userId" = uid LIMIT 1)) ON CONFLICT DO NOTHING;
  FOR sid IN SELECT DISTINCT item->>'sessionId' FROM jsonb_array_elements(items) item WHERE item->>'source' = 'physical' LOOP
    SELECT array_agg("eventId" ORDER BY "eventId") INTO existing FROM "ReadingLogEntry" WHERE "userId" = uid AND "sessionId" = sid;
    SELECT array_agg(item->>'eventId' ORDER BY item->>'eventId') INTO expected FROM jsonb_array_elements(items) item WHERE item->>'sessionId' = sid;
    IF existing IS NOT NULL AND existing <> expected THEN RAISE EXCEPTION 'READING_LOG_409:That physical reading was already logged with different passages. Use correction.'; END IF;
  END LOOP;
  FOR v IN SELECT * FROM jsonb_array_elements(items) LOOP
    SELECT * INTO previous FROM "ReadingLogEntry" WHERE "userId" = uid AND "eventId" = v->>'eventId';
    IF previous."eventId" IS NOT NULL THEN
      IF previous."deletedAt" IS NOT NULL OR previous."correctedAt" IS NOT NULL OR previous.revision > (v->>'revision')::INTEGER THEN
        result := result || jsonb_build_array(jsonb_build_object('recorded', false, 'entry', to_jsonb(previous))); CONTINUE;
      END IF;
      IF previous.revision = (v->>'revision')::INTEGER THEN
        identity := to_jsonb(previous);
        IF EXISTS (SELECT 1 FROM unnest(ARRAY['sessionId','source','book','chapter','verseRanges','translation','precision','timezone','completed','evidence','activeSeconds']) field WHERE identity->field IS DISTINCT FROM v->field)
          OR (COALESCE((v->>'strictTime')::BOOLEAN, true) AND (previous."occurredAt" <> (v->>'occurredAt')::TIMESTAMP OR previous."localDate" <> v->>'localDate')) THEN
          RAISE EXCEPTION 'READING_LOG_409:This eventId and revision were already saved with different content.';
        END IF;
        result := result || jsonb_build_array(jsonb_build_object('recorded', false, 'entry', to_jsonb(previous))); CONTINUE;
      END IF;
      IF previous."sessionId" <> v->>'sessionId' OR previous.book <> (v->>'book')::INTEGER OR previous.chapter <> (v->>'chapter')::INTEGER OR previous.source <> v->>'source' THEN
        RAISE EXCEPTION 'READING_LOG_409:A retry cannot change a reading identity; use correction.';
      END IF;
    END IF;
    IF EXISTS (SELECT 1 FROM "ReadingLogEntry" WHERE "userId" = uid AND "sessionId" = v->>'sessionId' AND book = (v->>'book')::INTEGER AND chapter = (v->>'chapter')::INTEGER AND "eventId" <> v->>'eventId') THEN
      RAISE EXCEPTION 'READING_LOG_409:This session already has that chapter. Update its existing eventId and revision.';
    END IF;
    INSERT INTO "ReadingLogEntry" ("userId","eventId","sessionId",revision,source,book,chapter,"verseRanges",translation,"occurredAt","localDate",timezone,precision,completed,evidence,"activeSeconds","updatedAt")
    VALUES (uid,v->>'eventId',v->>'sessionId',(v->>'revision')::INTEGER,v->>'source',(v->>'book')::INTEGER,(v->>'chapter')::INTEGER,v->'verseRanges',v->>'translation',(v->>'occurredAt')::TIMESTAMP,v->>'localDate',v->>'timezone',v->>'precision',(v->>'completed')::BOOLEAN,v->>'evidence',(v->>'activeSeconds')::INTEGER,CURRENT_TIMESTAMP)
    ON CONFLICT ("userId","eventId") DO UPDATE SET revision = EXCLUDED.revision,"verseRanges" = EXCLUDED."verseRanges",translation = EXCLUDED.translation,"occurredAt" = EXCLUDED."occurredAt","localDate" = EXCLUDED."localDate",timezone = EXCLUDED.timezone,precision = EXCLUDED.precision,completed = EXCLUDED.completed,evidence = EXCLUDED.evidence,"activeSeconds" = EXCLUDED."activeSeconds","updatedAt" = CURRENT_TIMESTAMP
    RETURNING * INTO saved;
    IF previous."eventId" IS NOT NULL THEN PERFORM sureword_reading_delta(to_jsonb(previous), -1); END IF;
    PERFORM sureword_reading_delta(to_jsonb(saved), 1);
    result := result || jsonb_build_array(jsonb_build_object('recorded', true, 'entry', to_jsonb(saved)));
  END LOOP;
  UPDATE "ReadingLogTotals" SET "lastReadAt" = (SELECT "occurredAt" FROM "ReadingLogEntry" WHERE "userId" = uid AND "deletedAt" IS NULL ORDER BY "occurredAt" DESC,"eventId" DESC LIMIT 1) WHERE "userId" = uid;
  RETURN result;
END $$;
-- IS NULL on an index's leading key does not reliably satisfy ORDER BY
-- pathkeys. Live-row partial indexes make latest-page work proportional to
-- the page size even after decades of history and deleted-entry tombstones.
CREATE INDEX "ReadingLogEntry_live_timeline" ON "ReadingLogEntry" ("userId", "occurredAt" DESC, "eventId" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "ReadingLogEntry_live_passage" ON "ReadingLogEntry" ("userId", book, chapter, "occurredAt" DESC, "eventId" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "ReadingLogEntry_live_source" ON "ReadingLogEntry" ("userId", source, "occurredAt" DESC, "eventId" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "ReadingLogEntry_live_passage_source" ON "ReadingLogEntry" ("userId", book, chapter, source, "occurredAt" DESC, "eventId" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "ReadingLogEntry_live_calendar" ON "ReadingLogEntry" ("userId", "localDate" DESC, "occurredAt" DESC, "eventId" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "ReadingLogEntry_live_passage_calendar" ON "ReadingLogEntry" ("userId", book, chapter, "localDate" DESC, "occurredAt" DESC, "eventId" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "ReadingLogEntry_live_source_calendar" ON "ReadingLogEntry" ("userId", source, "localDate" DESC, "occurredAt" DESC, "eventId" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "ReadingLogEntry_live_book" ON "ReadingLogEntry" ("userId", book, "occurredAt" DESC, "eventId" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "ReadingLogEntry_live_book_calendar" ON "ReadingLogEntry" ("userId", book, "localDate" DESC, "occurredAt" DESC, "eventId" DESC) WHERE "deletedAt" IS NULL;
CREATE INDEX "ReadingLogEntry_live_completed" ON "ReadingLogEntry" ("userId", book, chapter, "occurredAt" DESC) WHERE "deletedAt" IS NULL AND completed;
