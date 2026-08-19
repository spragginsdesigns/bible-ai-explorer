-- pgvector-backed semantic indexes: KJV verse embeddings and note-chunk
-- embeddings (replacing the external AstraDB store, which hibernated on the
-- free tier and silently broke Scripture retrieval).
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "VerseEmbedding" (
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "embedding" halfvec(3072) NOT NULL,

    CONSTRAINT "VerseEmbedding_pkey" PRIMARY KEY ("book", "chapter", "verse")
);

-- CreateTable
CREATE TABLE "NoteEmbedding" (
    "noteId" TEXT NOT NULL,
    "chunk" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" halfvec(3072) NOT NULL,

    CONSTRAINT "NoteEmbedding_pkey" PRIMARY KEY ("noteId", "chunk")
);

-- CreateIndex
CREATE INDEX "NoteEmbedding_userId_idx" ON "NoteEmbedding"("userId");

-- AddForeignKey
ALTER TABLE "NoteEmbedding" ADD CONSTRAINT "NoteEmbedding_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Approximate-nearest-neighbour indexes (HNSW, cosine). Not representable in
-- schema.prisma; do not let a future `migrate dev` drop them.
CREATE INDEX "VerseEmbedding_embedding_idx" ON "VerseEmbedding" USING hnsw ("embedding" halfvec_cosine_ops);
CREATE INDEX "NoteEmbedding_embedding_idx" ON "NoteEmbedding" USING hnsw ("embedding" halfvec_cosine_ops);
