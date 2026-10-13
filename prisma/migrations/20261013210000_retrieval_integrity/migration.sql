-- Additive metadata identifies the vector space without changing existing vectors or HNSW indexes.
ALTER TABLE "VerseEmbedding" ADD COLUMN "modelId" TEXT NOT NULL DEFAULT 'text-embedding-3-large',
    ADD COLUMN "dimensions" INTEGER NOT NULL DEFAULT 3072;
ALTER TABLE "NoteEmbedding" ADD COLUMN "modelId" TEXT NOT NULL DEFAULT 'text-embedding-3-large',
    ADD COLUMN "dimensions" INTEGER NOT NULL DEFAULT 3072;
ALTER TABLE "Note" ADD COLUMN "embeddingSourceHash" TEXT;
CREATE INDEX "UserMemory_userId_updatedAt_idx" ON "UserMemory"("userId", "updatedAt");

-- New defaulted metadata columns need statistics before filtered ANN queries run.
ANALYZE "VerseEmbedding" ("modelId", "dimensions");
ANALYZE "NoteEmbedding" ("modelId", "dimensions");
