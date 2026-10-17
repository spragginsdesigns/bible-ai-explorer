-- Personal share cards (docs/FEATURES.md, "Share cards"): "send a word" to
-- someone by name, and the sender's own signed line. A capability id like
-- SharedAnswer; the recipient's situation is never stored.

-- CreateTable
CREATE TABLE "SharedCard" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "translation" TEXT NOT NULL DEFAULT 'KJV',
    "recipient" VARCHAR(40),
    "message" VARCHAR(400),
    "personalLine" VARCHAR(200),
    "signature" VARCHAR(40),
    "publishedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SharedCard_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SharedCard_userId_createdAt_idx" ON "SharedCard"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "SharedCard" ADD CONSTRAINT "SharedCard_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
