-- SureWord Beta, Knowledge Vault (LC-17645, docs/beta/vault.md): the vectors
-- behind meaning search over chats, memories, sermon studies and beta items.
-- One new table; the only lock on an existing table is the brief one the User
-- foreign key takes.
--
-- Written by hand, keeping only the VaultEmbedding statements: `prisma migrate
-- diff` also proposes dropping the hand-made pgvector and full-text indexes
-- (VerseEmbedding, NoteEmbedding, KjvVerse, OriginalVerse), which the Prisma
-- schema does not describe and which must never be dropped.
--
-- No vector index: every query is scoped to one owner by the primary key's
-- leading userId and scans only that person's few hundred rows exactly.

SET lock_timeout = '5s';

CREATE TABLE "VaultEmbedding" (
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "chunk" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "embedding" halfvec(3072) NOT NULL,
    "modelId" TEXT NOT NULL DEFAULT 'text-embedding-3-large',
    "dimensions" INTEGER NOT NULL DEFAULT 3072,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VaultEmbedding_pkey" PRIMARY KEY ("userId", "kind", "sourceId", "chunk")
);

ALTER TABLE "VaultEmbedding" ADD CONSTRAINT "VaultEmbedding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
