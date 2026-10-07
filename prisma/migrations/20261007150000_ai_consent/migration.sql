-- AI data-sharing consent (docs/ios/ai-consent.md, PRD A4): the copy version
-- a person agreed to on the one-time "How SureWord answers you" sheet, and when
-- the server recorded it. Both nullable: every existing account reads as "not
-- yet agreed" and sees the sheet once on its next AI action. Columns on User,
-- so DELETE /api/account removes them with the row.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "aiConsentVersion" INTEGER,
ADD COLUMN "aiConsentAt" TIMESTAMP(3);
