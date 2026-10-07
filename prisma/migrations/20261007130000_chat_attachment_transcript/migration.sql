-- Voice messages: an audio attachment is transcribed once when its upload
-- completes, and the model reads the transcript instead of the audio. The
-- duration is read from the file first and summed per user for the free daily
-- cap. Both nullable: every existing attachment reads exactly as before.

-- AlterTable
ALTER TABLE "ChatAttachment" ADD COLUMN "transcript" TEXT,
ADD COLUMN "durationSeconds" DOUBLE PRECISION;
