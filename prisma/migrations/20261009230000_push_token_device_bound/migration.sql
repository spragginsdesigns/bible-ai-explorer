-- Security scan 2026-10-09: an Expo push token moved to whichever account
-- registered it last. PushToken.deviceBound marks rows whose device holds the
-- server-issued proof; those move only when the proof comes with them.

-- AlterTable
ALTER TABLE "PushToken" ADD COLUMN     "deviceBound" BOOLEAN NOT NULL DEFAULT false;

-- Per-row random input to the proof, rotated when an unbound row changes owner
-- without a proof, so an earlier holder's proof stops working.
ALTER TABLE "PushToken" ADD COLUMN     "proofNonce" TEXT;
