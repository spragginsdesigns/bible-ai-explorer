-- Security scan 2026-10-09 (docs/SECURITY-SCAN-2026-10-09.md).
--
-- 1. AudioTranscriptionUsage: the voice-message allowance used to be summed
--    from live ChatAttachment rows, so deleting an attachment (or the
--    conversation holding it) handed the minutes back. The ledger is kept
--    apart from attachments and survives their deletion.
-- 2. ChatAttachment.processingToken/processingAt: one /complete request
--    claims an upload before any paid work, so parallel requests cannot each
--    pay to transcribe it.
-- 3. Note (folderId, userId) -> Folder (id, userId): a note can only be filed
--    in a folder its own account owns.

-- AlterTable
ALTER TABLE "ChatAttachment" ADD COLUMN     "processingAt" TIMESTAMP(3),
ADD COLUMN     "processingToken" TEXT;

-- CreateTable
CREATE TABLE "AudioTranscriptionUsage" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "seconds" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AudioTranscriptionUsage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AudioTranscriptionUsage_attachmentId_key" ON "AudioTranscriptionUsage"("attachmentId");

-- CreateIndex
CREATE INDEX "AudioTranscriptionUsage_userId_createdAt_idx" ON "AudioTranscriptionUsage"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "AudioTranscriptionUsage" ADD CONSTRAINT "AudioTranscriptionUsage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry the last 24 hours of voice messages into the ledger, so nobody's
-- allowance resets on deploy.
INSERT INTO "AudioTranscriptionUsage" ("id", "userId", "attachmentId", "seconds", "createdAt")
SELECT 'backfill_' || "id", "userId", "id", "durationSeconds", "readyAt"
FROM "ChatAttachment"
WHERE "status" = 'READY' AND "durationSeconds" IS NOT NULL
  AND "readyAt" > CURRENT_TIMESTAMP - INTERVAL '24 hours';

-- Unfile any note already pointing at another account's folder (production
-- had none on 2026-10-09), so the composite key below can be created.
UPDATE "Note" AS n SET "folderId" = NULL
FROM "Folder" AS f
WHERE f."id" = n."folderId" AND f."userId" <> n."userId";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_folderId_fkey";

-- CreateIndex
CREATE UNIQUE INDEX "Folder_id_userId_key" ON "Folder"("id", "userId");

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_folderId_userId_fkey" FOREIGN KEY ("folderId", "userId") REFERENCES "Folder"("id", "userId") ON DELETE NO ACTION ON UPDATE CASCADE;
