-- Prayer requests that come back to you (docs/FEATURES.md, "Contracts for the
-- 2026-09-12 plan"). Three nullable columns on UserMemory, meaningful only
-- for category = 'prayer'; existing prayer rows are backfilled as open with a
-- follow-up due three days after they were saved.

ALTER TABLE "UserMemory"
    ADD COLUMN "status" TEXT,
    ADD COLUMN "askedAt" TIMESTAMP(3),
    ADD COLUMN "followUpAfter" TIMESTAMP(3);

UPDATE "UserMemory"
SET "status" = 'open',
    "askedAt" = "createdAt",
    "followUpAfter" = "createdAt" + INTERVAL '3 days'
WHERE "category" = 'prayer';

CREATE INDEX "UserMemory_userId_category_status_followUpAfter_idx"
    ON "UserMemory"("userId", "category", "status", "followUpAfter");
