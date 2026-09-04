-- Account-level reading preferences, synced across every client through
-- /api/preferences: the Bible translation the reader is set to, whether the
-- parchment page style is on, and the Listen card's playback speed. They were
-- device-local until now, which meant a reader who chose NKJV on their phone
-- was still on KJV on the web.
--
-- Every column is NOT NULL with a default so existing rows need no backfill,
-- and each value is validated on read (src/lib/preferences-contract.ts): an
-- unrecognised translation or speed degrades to the default rather than
-- erroring, the same rule the chat picker's columns already follow.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "translation" TEXT NOT NULL DEFAULT 'KJV';
ALTER TABLE "User" ADD COLUMN     "parchment" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN     "listenRate" DOUBLE PRECISION NOT NULL DEFAULT 1;
