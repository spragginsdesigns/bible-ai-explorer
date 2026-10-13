-- AI consent is asked once per account, ever (docs/ios/ai-consent.md). A
-- confirmed "Turn off AI" is recorded here so the sheet never shows again;
-- agreeing clears it. Nullable: every existing account reads as undecided.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "aiConsentDeclinedAt" TIMESTAMP(3);
