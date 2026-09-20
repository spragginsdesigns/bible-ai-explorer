-- A guided study built from one of a church's recorded services (see the
-- SermonStudy model comment in prisma/schema.prisma). Keyed by the YouTube
-- video rather than by a user, because the sermon is the same sermon for
-- everyone; `channelId` is what scopes it to a congregation.

-- AlterTable
ALTER TABLE "UserChurch" ADD COLUMN     "youtubeChannelId" TEXT;

-- CreateTable
CREATE TABLE "SermonStudy" (
    "id" TEXT NOT NULL,
    "videoId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "serviceTitle" TEXT NOT NULL,
    "serviceDate" TIMESTAMP(3),
    "preacher" TEXT,
    "preachingText" TEXT,
    "title" TEXT NOT NULL,
    "bigIdea" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "application" TEXT NOT NULL,
    "prayer" TEXT NOT NULL,
    "sections" JSONB NOT NULL,
    "sermonStartMs" INTEGER,
    "sermonEndMs" INTEGER,
    "durationSec" INTEGER,
    "writerModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SermonStudy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SermonStudy_videoId_key" ON "SermonStudy"("videoId");

-- CreateIndex
CREATE INDEX "SermonStudy_channelId_serviceDate_idx" ON "SermonStudy"("channelId", "serviceDate");
