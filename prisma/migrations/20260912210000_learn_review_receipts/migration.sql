ALTER TABLE "VerseMemory" ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "LearnReviewReceipt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "appliedRevision" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LearnReviewReceipt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LearnReviewReceipt_userId_operationId_key" ON "LearnReviewReceipt"("userId", "operationId");
CREATE INDEX "LearnReviewReceipt_userId_cardId_idx" ON "LearnReviewReceipt"("userId", "cardId");
ALTER TABLE "LearnReviewReceipt" ADD CONSTRAINT "LearnReviewReceipt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
