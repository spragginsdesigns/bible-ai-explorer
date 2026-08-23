-- NOTE: the HNSW indexes on "VerseEmbedding"/"NoteEmbedding" ("..._embedding_idx")
-- are created by raw SQL in 20260819230000_vector_embeddings and are not
-- representable in schema.prisma. The generated diff wanted to drop them;
-- those DROPs were removed by hand so semantic search keeps its ANN indexes.

-- CreateTable
CREATE TABLE "VerseHighlight" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "translation" TEXT NOT NULL DEFAULT 'KJV',
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "color" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerseHighlight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerseHighlight_userId_translation_book_chapter_idx" ON "VerseHighlight"("userId", "translation", "book", "chapter");

-- CreateIndex
CREATE UNIQUE INDEX "VerseHighlight_userId_translation_book_chapter_verse_key" ON "VerseHighlight"("userId", "translation", "book", "chapter", "verse");

-- AddForeignKey
ALTER TABLE "VerseHighlight" ADD CONSTRAINT "VerseHighlight_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
