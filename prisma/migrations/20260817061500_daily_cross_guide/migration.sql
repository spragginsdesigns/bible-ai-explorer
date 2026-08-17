-- "Pick Up Your Cross" guided-day content on the daily verse (all nullable:
-- pre-guide rows and fallback picks may carry the verse alone).
ALTER TABLE "VerseOfDay" ADD COLUMN "whyToday" TEXT;
ALTER TABLE "VerseOfDay" ADD COLUMN "application" TEXT;
ALTER TABLE "VerseOfDay" ADD COLUMN "studyPath" TEXT;
ALTER TABLE "VerseOfDay" ADD COLUMN "question" TEXT;
