-- "Listen" - the spoken devotional for a day's "Pick Up Your Cross".
-- All nullable: every existing row predates the feature, and audio is only
-- generated when a user actually taps play, never by the morning cron.
ALTER TABLE "VerseOfDay" ADD COLUMN "audioUrl" TEXT;
ALTER TABLE "VerseOfDay" ADD COLUMN "audioPathname" TEXT;
ALTER TABLE "VerseOfDay" ADD COLUMN "audioScript" TEXT;
ALTER TABLE "VerseOfDay" ADD COLUMN "audioTitle" TEXT;
ALTER TABLE "VerseOfDay" ADD COLUMN "audioDurationSec" INTEGER;
ALTER TABLE "VerseOfDay" ADD COLUMN "audioStatus" TEXT;
ALTER TABLE "VerseOfDay" ADD COLUMN "audioGeneratedAt" TIMESTAMP(3);
