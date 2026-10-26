-- The language SureWord answers in (docs/languages/PLAN.md). "auto" follows
-- the device; existing accounts keep English answers until their app sends
-- another language.
ALTER TABLE "User" ADD COLUMN "answerLanguage" TEXT NOT NULL DEFAULT 'auto';
