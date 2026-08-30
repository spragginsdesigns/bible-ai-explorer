-- Obsidian-style note wikilinks and note properties.
--
-- "NoteLink" is derived data, rebuilt from a note's plainText on every write
-- (src/lib/note-links.ts). An unresolved link (targetNoteId NULL) points at a
-- note that does not exist yet; creating or renaming a note claims it. The
-- unique key on (sourceNoteId, targetKey) is what makes the rebuild idempotent
-- under the ~1.5s autosave, which routinely overlaps two syncs of one note.

-- AlterTable
ALTER TABLE "Note" ADD COLUMN     "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "properties" JSONB;

-- CreateTable
CREATE TABLE "NoteLink" (
    "id" TEXT NOT NULL,
    "sourceNoteId" TEXT NOT NULL,
    "targetNoteId" TEXT,
    "targetKey" TEXT NOT NULL,
    "targetTitle" TEXT NOT NULL,
    "snippet" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoteLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteLink_targetNoteId_idx" ON "NoteLink"("targetNoteId");

-- CreateIndex
CREATE INDEX "NoteLink_userId_targetKey_idx" ON "NoteLink"("userId", "targetKey");

-- CreateIndex
CREATE UNIQUE INDEX "NoteLink_sourceNoteId_targetKey_key" ON "NoteLink"("sourceNoteId", "targetKey");

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_sourceNoteId_fkey" FOREIGN KEY ("sourceNoteId") REFERENCES "Note"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoteLink" ADD CONSTRAINT "NoteLink_targetNoteId_fkey" FOREIGN KEY ("targetNoteId") REFERENCES "Note"("id") ON DELETE SET NULL ON UPDATE CASCADE;
