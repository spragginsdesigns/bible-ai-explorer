-- Security scan 2026-10-09: church saves trigger paid Places and enrichment
-- work. ChurchSaveEvent counts them per user so the hourly limit holds across
-- server instances, not just within one.

-- CreateTable
CREATE TABLE "ChurchSaveEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChurchSaveEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChurchSaveEvent_userId_createdAt_idx" ON "ChurchSaveEvent"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "ChurchSaveEvent" ADD CONSTRAINT "ChurchSaveEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reuse of a recent enrichment keys on placeId and is bounded by when the
-- enrichment really ran, not by updatedAt (which every reuse would refresh).

-- AlterTable
ALTER TABLE "UserChurch" ADD COLUMN     "enrichedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "UserChurch_placeId_idx" ON "UserChurch"("placeId");
