-- Share cards (docs/FEATURES.md): one line of encouragement per passage,
-- shared across accounts like VerseInsight. Written only on a signed-in
-- reader's request; the public card route only reads it.

-- CreateTable
CREATE TABLE "VerseEncouragement" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "promptVersion" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "model" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerseEncouragement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerseEncouragement_reference_promptVersion_key" ON "VerseEncouragement"("reference", "promptVersion");
