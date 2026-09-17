-- Tap-a-verse word study cache, shared across accounts (see the VerseWordStudy
-- model comment in prisma/schema.prisma). The study is built from the verse's
-- own original-language words and the KJV text, so one row serves every
-- reader of that verse; the key is the verse plus the prompt version.

-- CreateTable
CREATE TABLE "VerseWordStudy" (
    "id" TEXT NOT NULL,
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "data" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerseWordStudy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerseWordStudy_book_chapter_verse_promptVersion_key" ON "VerseWordStudy"("book", "chapter", "verse", "promptVersion");
