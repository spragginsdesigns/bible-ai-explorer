-- Share an answer (docs/FEATURES.md, "Share an answer: a public page, and a
-- card image"): a snapshot of one assistant answer behind a random slug. The
-- public page reads only this table, never Message.

CREATE TABLE "SharedAnswer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "question" VARCHAR(500) NOT NULL,
    "answer" TEXT NOT NULL,
    "references" JSONB NOT NULL,
    "translation" TEXT NOT NULL DEFAULT 'KJV',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "SharedAnswer_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SharedAnswer_messageId_key" ON "SharedAnswer"("messageId");
CREATE INDEX "SharedAnswer_userId_createdAt_idx" ON "SharedAnswer"("userId", "createdAt");

ALTER TABLE "SharedAnswer" ADD CONSTRAINT "SharedAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
