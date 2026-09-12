-- Learn a verse: one card per verse per user, with the spaced-repetition
-- schedule the ladder in src/lib/learn-schedule.ts moves.

-- CreateTable
CREATE TABLE "VerseMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "book" INTEGER NOT NULL,
    "chapter" INTEGER NOT NULL,
    "verse" INTEGER NOT NULL,
    "translation" TEXT NOT NULL DEFAULT 'KJV',
    "source" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "intervalDays" INTEGER NOT NULL DEFAULT 0,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "lastReviewedAt" TIMESTAMP(3),
    "knownAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VerseMemory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerseMemory_userId_dueAt_idx" ON "VerseMemory"("userId", "dueAt");

-- CreateIndex
CREATE UNIQUE INDEX "VerseMemory_userId_book_chapter_verse_key" ON "VerseMemory"("userId", "book", "chapter", "verse");

-- AddForeignKey
ALTER TABLE "VerseMemory" ADD CONSTRAINT "VerseMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
