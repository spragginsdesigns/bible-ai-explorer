-- Opt-in public shared answers and try-before-sign-up guest turns
-- (docs/FEATURES.md, "Share an answer" and "Try before you sign up").

-- AlterTable
ALTER TABLE "SharedAnswer" ADD COLUMN     "listedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "SharedAnswer_listedAt_idx" ON "SharedAnswer"("listedAt");

-- CreateTable
CREATE TABLE "GuestTurn" (
    "id" TEXT NOT NULL,
    "guestId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "question" VARCHAR(2000) NOT NULL,
    "answer" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimedAt" TIMESTAMP(3),
    "claimedByUserId" TEXT,

    CONSTRAINT "GuestTurn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuestTurn_guestId_createdAt_idx" ON "GuestTurn"("guestId", "createdAt");

-- CreateIndex
CREATE INDEX "GuestTurn_ipHash_createdAt_idx" ON "GuestTurn"("ipHash", "createdAt");

-- CreateIndex
CREATE INDEX "GuestTurn_createdAt_idx" ON "GuestTurn"("createdAt");
