-- Tap-a-verse explanation cache, shared across accounts (see the VerseInsight
-- model comment in prisma/schema.prisma). The prompt carries only the verse,
-- so one explanation serves every reader of that verse; the unique key covers
-- the translation, the reference, a hash of the verse text the client sent,
-- and the prompt version.

-- CreateTable
CREATE TABLE "VerseInsight" (
    "id" TEXT NOT NULL,
    "translation" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "textHash" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerseInsight_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerseInsight_translation_reference_textHash_promptVersion_key" ON "VerseInsight"("translation", "reference", "textHash", "promptVersion");
