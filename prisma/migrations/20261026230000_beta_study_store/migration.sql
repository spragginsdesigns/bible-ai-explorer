-- SureWord Beta's shared study store (LC-17631, docs/beta/README.md): every
-- beta module's objects, with the passages and topics they touch, and the
-- connections between them. Two new tables; the only lock on an existing table
-- is the brief one the User foreign keys take.
--
-- Written by hand from `prisma migrate diff`, keeping only the Beta* statements:
-- the diff also proposes dropping the hand-made pgvector and full-text indexes
-- (VerseEmbedding, NoteEmbedding, KjvVerse, OriginalVerse), which the Prisma
-- schema does not describe and which must never be dropped.

-- The User foreign keys briefly block writes to "User" while they are added.
-- Give up after 5 s rather than queue every sign-in behind a long transaction.
SET lock_timeout = '5s';

CREATE TABLE "BetaItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "parentId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "data" JSONB NOT NULL DEFAULT '{}',
    "refs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "topics" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BetaItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BetaLink" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "reason" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'user',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BetaItem_userId_module_kind_updatedAt_idx" ON "BetaItem"("userId", "module", "kind", "updatedAt");

CREATE INDEX "BetaItem_parentId_idx" ON "BetaItem"("parentId");

CREATE INDEX "BetaItem_refs_idx" ON "BetaItem" USING GIN ("refs");

CREATE INDEX "BetaItem_topics_idx" ON "BetaItem" USING GIN ("topics");

CREATE INDEX "BetaLink_userId_idx" ON "BetaLink"("userId");

CREATE INDEX "BetaLink_toId_idx" ON "BetaLink"("toId");

CREATE UNIQUE INDEX "BetaLink_fromId_toId_kind_key" ON "BetaLink"("fromId", "toId", "kind");

ALTER TABLE "BetaItem" ADD CONSTRAINT "BetaItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaItem" ADD CONSTRAINT "BetaItem_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BetaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaLink" ADD CONSTRAINT "BetaLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaLink" ADD CONSTRAINT "BetaLink_fromId_fkey" FOREIGN KEY ("fromId") REFERENCES "BetaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BetaLink" ADD CONSTRAINT "BetaLink_toId_fkey" FOREIGN KEY ("toId") REFERENCES "BetaItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
