-- SureWord Pro. Every existing row is a free account until it is flagged, so
-- the default carries the whole backfill and no data migration is needed.
ALTER TABLE "User" ADD COLUMN "plan" TEXT NOT NULL DEFAULT 'free';
